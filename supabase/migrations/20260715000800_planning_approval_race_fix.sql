alter table public.planning_sessions
  add column blocks_revision bigint not null default 0,
  add constraint planning_sessions_blocks_revision_check check (blocks_revision >= 0);

drop trigger planning_sessions_guard_immutability on public.planning_sessions;

create or replace function public.guard_planning_session_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    raise exception 'terminal planning sessions are immutable' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.window_start is distinct from old.window_start
    or new.window_end is distinct from old.window_end
    or new.input_now is distinct from old.input_now
    or new.input_hash is distinct from old.input_hash
    or new.engine_version is distinct from old.engine_version
    or new.warning_codes is distinct from old.warning_codes
    or new.result_summary is distinct from old.result_summary
    or new.created_at is distinct from old.created_at
    or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'planning session snapshot fields are immutable' using errcode = '55000';
  end if;

  if new.status not in ('draft', 'approved', 'rejected', 'superseded') then
    raise exception 'invalid planning session transition' using errcode = '55000';
  end if;

  if new.status = 'draft' then
    if new.blocks_revision < old.blocks_revision then
      raise exception 'blocks revision must be monotonic' using errcode = '55000';
    end if;
    if new.approved_at is distinct from old.approved_at or new.rejected_at is distinct from old.rejected_at then
      raise exception 'draft transition timestamps are immutable' using errcode = '55000';
    end if;
  else
    if new.blocks_revision is distinct from old.blocks_revision then
      raise exception 'blocks revision must not change during status transition' using errcode = '55000';
    end if;
    if new.status = 'approved' then
      new.approved_at := transaction_timestamp();
      new.rejected_at := null;
    elsif new.status = 'rejected' then
      new.approved_at := null;
      new.rejected_at := transaction_timestamp();
    else
      new.approved_at := null;
      new.rejected_at := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger planning_sessions_guard_immutability
before update on public.planning_sessions
for each row execute function public.guard_planning_session_immutability();

drop trigger planning_blocks_guard_parent_status on public.planning_blocks;

create or replace function public.guard_planning_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  changed_revision bigint;
begin
  if tg_op = 'UPDATE' and (
    old.planning_session_id is distinct from new.planning_session_id
    or old.user_id is distinct from new.user_id
  ) then
    raise exception 'planning block ownership cannot change' using errcode = '55000';
  end if;

  update public.planning_sessions
  set blocks_revision = blocks_revision + 1
  where id = new.planning_session_id
    and user_id = new.user_id
    and status = 'draft'
  returning blocks_revision into changed_revision;

  if changed_revision is null then
    raise exception 'blocks are mutable only while the parent is draft' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger planning_blocks_guard_parent_status
before insert or update on public.planning_blocks
for each row execute function public.guard_planning_block_mutation();

create or replace function public.reserve_planning_block_delete(p_session_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_revision bigint;
begin
  if p_user_id is distinct from (select auth.uid()) then return false; end if;
  update public.planning_sessions
  set blocks_revision = blocks_revision + 1
  where id = p_session_id and user_id = p_user_id and status = 'draft'
  returning blocks_revision into changed_revision;
  return changed_revision is not null;
end;
$$;

drop policy planning_blocks_delete_own_draft on public.planning_blocks;
create policy planning_blocks_delete_own_draft on public.planning_blocks
for delete to authenticated using (
  (select auth.uid()) = user_id
  and public.reserve_planning_block_delete(planning_session_id, user_id)
);

drop policy if exists planning_sessions_insert_own on public.planning_sessions;
drop policy if exists planning_sessions_update_own on public.planning_sessions;
drop policy if exists planning_sessions_delete_own on public.planning_sessions;

revoke all on function public.approve_planning_session(uuid, text) from public, anon, authenticated;
drop function public.approve_planning_session(uuid, text);

create function public.approve_planning_session(p_session_id uuid, p_input_hash text, p_blocks_revision bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  session_status text;
  session_hash text;
  session_revision bigint;
begin
  if current_user_id is null then return 'NOT_UPDATED'; end if;
  select status, input_hash, blocks_revision
    into session_status, session_hash, session_revision
  from public.planning_sessions
  where id = p_session_id and user_id = current_user_id
  for update;

  if session_status is null or session_status <> 'draft' or session_hash <> p_input_hash then
    return 'NOT_UPDATED';
  end if;
  if session_revision <> p_blocks_revision then return 'BLOCKS_CHANGED'; end if;

  update public.planning_sessions set status = 'approved'
  where id = p_session_id and user_id = current_user_id and status = 'draft';
  update public.planning_sessions set status = 'superseded'
  where user_id = current_user_id and status = 'draft' and id <> p_session_id;
  return 'APPROVED';
end;
$$;

create or replace function public.reject_planning_session(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  session_status text;
begin
  if current_user_id is null then return 'NOT_UPDATED'; end if;
  select status into session_status
  from public.planning_sessions
  where id = p_session_id and user_id = current_user_id
  for update;
  if session_status is null or session_status <> 'draft' then return 'NOT_UPDATED'; end if;
  update public.planning_sessions set status = 'rejected'
  where id = p_session_id and user_id = current_user_id and status = 'draft';
  return 'REJECTED';
end;
$$;

revoke all on function public.approve_planning_session(uuid, text, bigint) from public, anon;
grant execute on function public.approve_planning_session(uuid, text, bigint) to authenticated;
revoke all on function public.reject_planning_session(uuid) from public, anon;
grant execute on function public.reject_planning_session(uuid) to authenticated;
revoke all on function public.reserve_planning_block_delete(uuid, uuid) from public, anon;
grant execute on function public.reserve_planning_block_delete(uuid, uuid) to authenticated;
