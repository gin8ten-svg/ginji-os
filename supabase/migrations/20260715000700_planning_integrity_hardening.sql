alter table public.planning_sessions
  add column idempotency_key uuid;

create unique index planning_sessions_user_idempotency_idx
  on public.planning_sessions(user_id, idempotency_key)
  where idempotency_key is not null;

alter table public.planning_blocks
  add constraint planning_blocks_minute_aligned_check check (
    date_trunc('minute', start_at) = start_at
    and date_trunc('minute', end_at) = end_at
  ),
  add constraint planning_blocks_duration_matches_check check (
    duration_minutes::numeric = extract(epoch from (end_at - start_at)) / 60
  );

create or replace function public.guard_planning_session_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'terminal planning sessions are immutable' using errcode = '55000';
    end if;
    return old;
  end if;

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
    if new.approved_at is distinct from old.approved_at or new.rejected_at is distinct from old.rejected_at then
      raise exception 'draft transition timestamps are immutable' using errcode = '55000';
    end if;
  elsif new.status = 'approved' then
    new.approved_at := transaction_timestamp();
    new.rejected_at := null;
  elsif new.status = 'rejected' then
    new.approved_at := null;
    new.rejected_at := transaction_timestamp();
  else
    new.approved_at := null;
    new.rejected_at := null;
  end if;

  return new;
end;
$$;

create trigger planning_sessions_guard_immutability
before update or delete on public.planning_sessions
for each row execute function public.guard_planning_session_immutability();

create or replace function public.guard_planning_block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_parent_status text;
  new_parent_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into old_parent_status
    from public.planning_sessions
    where id = old.planning_session_id and user_id = old.user_id;
    if old_parent_status is distinct from 'draft' then
      raise exception 'blocks are mutable only while the parent is draft' using errcode = '55000';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select status into new_parent_status
    from public.planning_sessions
    where id = new.planning_session_id and user_id = new.user_id;
    if new_parent_status is distinct from 'draft' then
      raise exception 'blocks are mutable only while the parent is draft' using errcode = '55000';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger planning_blocks_guard_parent_status
before insert or update or delete on public.planning_blocks
for each row execute function public.guard_planning_block_mutation();

drop policy planning_blocks_insert_own on public.planning_blocks;
drop policy planning_blocks_update_own on public.planning_blocks;
drop policy planning_blocks_delete_own on public.planning_blocks;

create policy planning_blocks_insert_own_draft on public.planning_blocks
for insert to authenticated with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.planning_sessions session
    where session.id = planning_session_id
      and session.user_id = (select auth.uid())
      and session.status = 'draft'
  )
);

create policy planning_blocks_update_own_draft on public.planning_blocks
for update to authenticated using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.planning_sessions session
    where session.id = planning_session_id
      and session.user_id = (select auth.uid())
      and session.status = 'draft'
  )
) with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.planning_sessions session
    where session.id = planning_session_id
      and session.user_id = (select auth.uid())
      and session.status = 'draft'
  )
);

create policy planning_blocks_delete_own_draft on public.planning_blocks
for delete to authenticated using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.planning_sessions session
    where session.id = planning_session_id
      and session.user_id = (select auth.uid())
      and session.status = 'draft'
  )
);

create or replace function public.create_planning_session(
  p_idempotency_key uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_input_now timestamptz,
  p_input_hash text,
  p_engine_version text,
  p_warning_codes text[],
  p_result_summary jsonb,
  p_blocks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  session_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'blocks must be an array' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select id into session_id
    from public.planning_sessions
    where user_id = current_user_id and idempotency_key = p_idempotency_key;
    if session_id is not null then return session_id; end if;
  end if;

  insert into public.planning_sessions (
    user_id, status, window_start, window_end, input_now, input_hash,
    engine_version, warning_codes, result_summary, idempotency_key
  ) values (
    current_user_id, 'draft', p_window_start, p_window_end, p_input_now, p_input_hash,
    p_engine_version, p_warning_codes, p_result_summary, p_idempotency_key
  )
  on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into session_id;

  if session_id is null then
    select id into session_id
    from public.planning_sessions
    where user_id = current_user_id and idempotency_key = p_idempotency_key;
    return session_id;
  end if;

  insert into public.planning_blocks (
    planning_session_id, user_id, source_type, source_entity_id, title,
    start_at, end_at, block_index, duration_minutes, metadata
  )
  select session_id, current_user_id, block.source_type, block.source_entity_id, block.title,
    block.start_at, block.end_at, block.block_index, block.duration_minutes, coalesce(block.metadata, '{}'::jsonb)
  from jsonb_to_recordset(p_blocks) as block(
    source_type text, source_entity_id text, title text, start_at timestamptz,
    end_at timestamptz, block_index integer, duration_minutes integer, metadata jsonb
  );

  return session_id;
end;
$$;

create or replace function public.approve_planning_session(p_session_id uuid, p_input_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if (select auth.uid()) is null then return 'NOT_UPDATED'; end if;
  update public.planning_sessions
  set status = 'approved'
  where id = p_session_id and user_id = (select auth.uid()) and status = 'draft' and input_hash = p_input_hash;
  get diagnostics changed = row_count;
  if changed = 0 then return 'NOT_UPDATED'; end if;
  update public.planning_sessions set status = 'superseded'
  where user_id = (select auth.uid()) and status = 'draft' and id <> p_session_id;
  return 'APPROVED';
end;
$$;

create or replace function public.reject_planning_session(p_session_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if (select auth.uid()) is null then return 'NOT_UPDATED'; end if;
  update public.planning_sessions set status = 'rejected'
  where id = p_session_id and user_id = (select auth.uid()) and status = 'draft';
  get diagnostics changed = row_count;
  if changed = 0 then return 'NOT_UPDATED'; end if;
  return 'REJECTED';
end;
$$;

revoke all on function public.create_planning_session(uuid, timestamptz, timestamptz, timestamptz, text, text, text[], jsonb, jsonb) from public, anon;
grant execute on function public.create_planning_session(uuid, timestamptz, timestamptz, timestamptz, text, text, text[], jsonb, jsonb) to authenticated;
revoke all on function public.approve_planning_session(uuid, text), public.reject_planning_session(uuid) from public, anon;
grant execute on function public.approve_planning_session(uuid, text), public.reject_planning_session(uuid) to authenticated;
revoke insert, update, delete on public.planning_sessions from authenticated;
