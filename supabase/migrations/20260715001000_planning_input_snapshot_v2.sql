alter table public.planning_sessions
  add column input_snapshot_version text null,
  add column input_snapshot jsonb null,
  add constraint planning_sessions_input_snapshot_pair_check check (
    (input_snapshot_version is null and input_snapshot is null)
    or (input_snapshot_version is not null and input_snapshot is not null)
  ),
  add constraint planning_sessions_input_snapshot_version_check check (
    input_snapshot_version is null or input_snapshot_version = 'planning-input-v2'
  ),
  add constraint planning_sessions_input_snapshot_object_check check (
    input_snapshot is null or jsonb_typeof(input_snapshot) = 'object'
  ),
  add constraint planning_sessions_input_snapshot_schema_check check (
    input_snapshot is null or input_snapshot ->> 'schemaVersion' = input_snapshot_version
  ),
  add constraint planning_sessions_input_snapshot_size_check check (
    input_snapshot is null or octet_length(input_snapshot::text) <= 1000000
  );

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

create function public.create_planning_session_v2(
  p_idempotency_key uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_input_now timestamptz,
  p_input_hash text,
  p_input_snapshot_version text,
  p_input_snapshot jsonb,
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
  existing_snapshot_version text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_input_snapshot_version <> 'planning-input-v2'
    or p_input_snapshot is null
    or jsonb_typeof(p_input_snapshot) <> 'object'
    or p_input_snapshot ->> 'schemaVersion' <> p_input_snapshot_version
    or octet_length(p_input_snapshot::text) > 1000000 then
    raise exception 'invalid planning input snapshot' using errcode = '22023';
  end if;
  if p_engine_version not in ('deterministic-v2', 'deterministic-v2+openai-advice-v1')
    or p_input_snapshot ->> 'engineVersion' <> 'deterministic-v2' then
    raise exception 'invalid planning engine version' using errcode = '22023';
  end if;
  if p_input_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid planning input hash' using errcode = '22023';
  end if;
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'blocks must be an array' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select id, input_snapshot_version into session_id, existing_snapshot_version
    from public.planning_sessions
    where user_id = current_user_id and idempotency_key = p_idempotency_key;
    if session_id is not null then
      if existing_snapshot_version is distinct from 'planning-input-v2' then
        raise exception 'idempotency key belongs to a legacy planning session' using errcode = '55000';
      end if;
      return session_id;
    end if;
  end if;

  insert into public.planning_sessions (
    user_id, status, window_start, window_end, input_now, input_hash,
    input_snapshot_version, input_snapshot, engine_version, warning_codes,
    result_summary, idempotency_key
  ) values (
    current_user_id, 'draft', p_window_start, p_window_end, p_input_now, p_input_hash,
    p_input_snapshot_version, p_input_snapshot, p_engine_version, p_warning_codes,
    p_result_summary, p_idempotency_key
  )
  on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into session_id;

  if session_id is null then
    select id, input_snapshot_version into session_id, existing_snapshot_version
    from public.planning_sessions
    where user_id = current_user_id and idempotency_key = p_idempotency_key;
    if session_id is null or existing_snapshot_version is distinct from 'planning-input-v2' then
      raise exception 'planning session idempotency conflict' using errcode = '55000';
    end if;
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

revoke all on function public.create_planning_session_v2(uuid, timestamptz, timestamptz, timestamptz, text, text, jsonb, text, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_planning_session_v2(uuid, timestamptz, timestamptz, timestamptz, text, text, jsonb, text, text[], jsonb, jsonb) to authenticated;
