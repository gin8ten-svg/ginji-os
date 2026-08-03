alter table public.time_blocks
  drop constraint if exists time_blocks_google_event_id_check;

alter table public.time_blocks
  add constraint time_blocks_google_event_id_check
  check (
    length(google_event_id) between 5 and 1024
    and google_event_id ~ '^[0-9a-v]+$'
  );

create or replace function public.reserve_calendar_event_write(
  p_session_id uuid,
  p_block_id uuid,
  p_input_hash text,
  p_blocks_revision bigint,
  p_calendar_id text,
  p_google_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  session_status text;
  session_hash text;
  session_revision bigint;
  block_record public.planning_blocks%rowtype;
  write_record public.time_blocks%rowtype;
  established_calendar_id text;
  new_attempt_token uuid;
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if current_user_id is null then
    return pg_catalog.jsonb_build_object('result', 'NOT_FOUND');
  end if;
  if p_calendar_id is null or length(p_calendar_id) not between 1 and 512
    or p_google_event_id is null
    or length(p_google_event_id) not between 5 and 1024
    or p_google_event_id !~ '^[0-9a-v]+$' then
    raise exception 'invalid calendar write reservation' using errcode = '22023';
  end if;

  select status, input_hash, blocks_revision
    into session_status, session_hash, session_revision
  from public.planning_sessions
  where id = p_session_id and user_id = current_user_id
  for update;

  if not found then return pg_catalog.jsonb_build_object('result', 'NOT_FOUND'); end if;
  if session_status <> 'approved' then return pg_catalog.jsonb_build_object('result', 'NOT_APPROVED'); end if;
  if session_hash is distinct from p_input_hash then return pg_catalog.jsonb_build_object('result', 'INPUT_CHANGED'); end if;
  if session_revision is distinct from p_blocks_revision then return pg_catalog.jsonb_build_object('result', 'BLOCKS_CHANGED'); end if;

  select * into block_record
  from public.planning_blocks
  where id = p_block_id
    and planning_session_id = p_session_id
    and user_id = current_user_id
  for update;
  if not found then return pg_catalog.jsonb_build_object('result', 'BLOCK_NOT_FOUND'); end if;

  select google_calendar_id into established_calendar_id
  from public.time_blocks
  where planning_session_id = p_session_id and user_id = current_user_id
  order by created_at, id
  limit 1;
  if found and established_calendar_id <> p_calendar_id then
    return pg_catalog.jsonb_build_object('result', 'CALENDAR_MISMATCH');
  end if;

  select * into write_record
  from public.time_blocks
  where planning_block_id = p_block_id and user_id = current_user_id
  for update;

  if found then
    if write_record.google_calendar_id <> p_calendar_id or write_record.google_event_id <> p_google_event_id then
      return pg_catalog.jsonb_build_object('result', 'CALENDAR_MISMATCH');
    end if;
    if write_record.calendar_write_status = 'succeeded' then
      return pg_catalog.jsonb_build_object(
        'result', 'ALREADY_SUCCEEDED',
        'time_block_id', write_record.id,
        'google_event_id', write_record.google_event_id
      );
    end if;
    if write_record.calendar_write_status = 'writing'
      and write_record.calendar_write_lease_until > pg_catalog.clock_timestamp() then
      return pg_catalog.jsonb_build_object('result', 'IN_PROGRESS', 'time_block_id', write_record.id);
    end if;

    new_attempt_token := extensions.gen_random_uuid();
    update public.time_blocks
    set calendar_write_status = 'writing',
        calendar_write_attempt_token = new_attempt_token,
        calendar_write_lease_until = pg_catalog.clock_timestamp() + interval '2 minutes',
        calendar_write_attempt_count = calendar_write_attempt_count + 1,
        calendar_write_error_code = null,
        written_at = null
    where id = write_record.id;
    return pg_catalog.jsonb_build_object('result', 'RESERVED', 'time_block_id', write_record.id, 'attempt_token', new_attempt_token);
  end if;

  new_attempt_token := extensions.gen_random_uuid();
  insert into public.time_blocks (
    user_id, task_id, routine_id, planning_session_id, planning_block_id,
    start_at, end_at, status, source, google_calendar_id, google_event_id,
    calendar_write_status, calendar_write_attempt_token, calendar_write_lease_until,
    calendar_write_attempt_count
  ) values (
    current_user_id,
    case when block_record.source_type = 'task' and block_record.source_entity_id ~* uuid_pattern then block_record.source_entity_id::uuid else null end,
    case when block_record.source_type = 'routine' and block_record.source_entity_id ~* uuid_pattern then block_record.source_entity_id::uuid else null end,
    p_session_id, p_block_id, block_record.start_at, block_record.end_at,
    'approved', 'ai', p_calendar_id, p_google_event_id,
    'writing', new_attempt_token, pg_catalog.clock_timestamp() + interval '2 minutes', 1
  )
  returning * into write_record;

  return pg_catalog.jsonb_build_object('result', 'RESERVED', 'time_block_id', write_record.id, 'attempt_token', new_attempt_token);
end;
$$;

revoke all on function public.reserve_calendar_event_write(uuid, uuid, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.reserve_calendar_event_write(uuid, uuid, text, bigint, text, text) to authenticated;
