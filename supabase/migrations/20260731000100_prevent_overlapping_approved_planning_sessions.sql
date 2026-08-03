create extension if not exists btree_gist with schema extensions;

create or replace function public.guard_planning_session_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft'
    and not (old.status = 'approved' and new.status = 'superseded') then
    raise exception 'terminal planning sessions are immutable' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.window_start is distinct from old.window_start
    or new.window_end is distinct from old.window_end
    or new.input_now is distinct from old.input_now
    or new.input_hash is distinct from old.input_hash
    or new.input_snapshot_version is distinct from old.input_snapshot_version
    or new.input_snapshot is distinct from old.input_snapshot
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

  if old.status = 'approved' then
    if new.status <> 'superseded'
      or new.blocks_revision is distinct from old.blocks_revision then
      raise exception 'invalid approved planning session transition' using errcode = '55000';
    end if;
    new.approved_at := old.approved_at;
    new.rejected_at := old.rejected_at;
    return new;
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

-- Keep the newest approved member of every overlapping pair before installing
-- the database invariant. Superseded rows and their blocks remain for audit.
update public.planning_sessions as older
set status = 'superseded'
where older.status = 'approved'
  and exists (
    select 1
    from public.planning_sessions as newer
    where newer.user_id = older.user_id
      and newer.status = 'approved'
      and newer.id <> older.id
      and older.window_start < newer.window_end
      and newer.window_start < older.window_end
      and (
        coalesce(newer.approved_at, newer.created_at),
        newer.created_at,
        newer.id
      ) > (
        coalesce(older.approved_at, older.created_at),
        older.created_at,
        older.id
      )
  );

alter table public.planning_sessions
  add constraint planning_sessions_no_overlapping_approved_windows
  exclude using gist (
    user_id with =,
    tstzrange(window_start, window_end, '[)') with &&
  )
  where (status = 'approved');

create or replace function public.approve_planning_session(
  p_session_id uuid,
  p_input_hash text,
  p_blocks_revision bigint
)
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
  session_window_start timestamptz;
  session_window_end timestamptz;
begin
  if current_user_id is null then return 'NOT_UPDATED'; end if;

  -- Serialize every approval for one user, including approvals racing with a
  -- newly inserted draft that was not visible to an earlier row-lock query.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('planning-approval:' || current_user_id::text, 0)
  );

  select status, input_hash, blocks_revision, window_start, window_end
    into session_status, session_hash, session_revision, session_window_start, session_window_end
  from public.planning_sessions
  where id = p_session_id and user_id = current_user_id
  for update;

  if session_status is null or session_status <> 'draft' or session_hash <> p_input_hash then
    return 'NOT_UPDATED';
  end if;
  if session_revision <> p_blocks_revision then return 'BLOCKS_CHANGED'; end if;

  -- Supersede overlapping approved rows before approving the target so the
  -- exclusion constraint is maintained throughout the transaction.
  update public.planning_sessions
  set status = 'superseded'
  where user_id = current_user_id
    and status = 'approved'
    and id <> p_session_id
    and window_start < session_window_end
    and session_window_start < window_end;

  update public.planning_sessions
  set status = 'approved'
  where id = p_session_id and user_id = current_user_id and status = 'draft';

  update public.planning_sessions
  set status = 'superseded'
  where user_id = current_user_id and status = 'draft' and id <> p_session_id;

  return 'APPROVED';
end;
$$;

revoke all on function public.approve_planning_session(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.approve_planning_session(uuid, text, bigint) to authenticated;
