-- src/lib/planning/input-snapshot-v2.ts bumped PLANNING_ENGINE_VERSION from
-- 'deterministic-v2' to 'deterministic-v3' in commit 3fd4244 (2026-08-12), but
-- create_planning_session_v2's hardcoded version check was never updated to
-- match. Every plan create/regenerate has been rejected with "invalid
-- planning engine version" (sqlstate 22023) since that app code shipped to
-- production on 2026-08-18 (PR #7). This migration updates the check to the
-- current app version. Existing rows created under 'deterministic-v2' are
-- untouched; this only affects the acceptance check for newly inserted rows.

create or replace function public.create_planning_session_v2(
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
  if p_engine_version not in ('deterministic-v3', 'deterministic-v3+openai-advice-v1')
    or p_input_snapshot ->> 'engineVersion' <> 'deterministic-v3' then
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
