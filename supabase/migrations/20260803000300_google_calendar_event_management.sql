alter table public.time_blocks
  add column calendar_event_state text,
  add column calendar_mutation_status text not null default 'idle',
  add column calendar_mutation_attempt_token uuid,
  add column calendar_mutation_lease_until timestamptz,
  add column calendar_mutation_attempt_count integer not null default 0,
  add column calendar_mutation_error_code text,
  add column calendar_updated_at timestamptz,
  add column calendar_deleted_at timestamptz;

update public.time_blocks
set calendar_event_state = case when calendar_write_status = 'succeeded' then 'active' else 'pending' end;

alter table public.time_blocks
  alter column calendar_event_state set not null,
  alter column calendar_event_state set default 'pending',
  add constraint time_blocks_calendar_event_state_check
    check (calendar_event_state in ('pending','active','deleted')),
  add constraint time_blocks_calendar_mutation_status_check
    check (calendar_mutation_status in ('idle','updating','deleting','update_failed','delete_failed')),
  add constraint time_blocks_calendar_mutation_attempt_count_check
    check (calendar_mutation_attempt_count >= 0),
  add constraint time_blocks_calendar_mutation_error_code_check
    check (calendar_mutation_error_code is null or length(calendar_mutation_error_code) between 1 and 100),
  add constraint time_blocks_calendar_mutation_lease_check
    check (
      (calendar_mutation_status in ('updating','deleting') and calendar_mutation_attempt_token is not null and calendar_mutation_lease_until is not null)
      or (calendar_mutation_status not in ('updating','deleting') and calendar_mutation_attempt_token is null and calendar_mutation_lease_until is null)
    ),
  add constraint time_blocks_calendar_mutation_error_check
    check ((calendar_mutation_status in ('update_failed','delete_failed')) = (calendar_mutation_error_code is not null)),
  add constraint time_blocks_calendar_event_deleted_at_check
    check ((calendar_event_state = 'deleted') = (calendar_deleted_at is not null)),
  add constraint time_blocks_calendar_event_active_check
    check (calendar_event_state <> 'active' or calendar_write_status = 'succeeded');

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'calendar_event_write_succeeded',
  'calendar_event_write_failed',
  'calendar_event_update_succeeded',
  'calendar_event_update_failed',
  'calendar_event_delete_succeeded',
  'calendar_event_delete_failed'
));

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
      if write_record.calendar_event_state = 'deleted' then
        return pg_catalog.jsonb_build_object('result', 'EVENT_DELETED', 'time_block_id', write_record.id);
      end if;
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
        written_at = null,
        calendar_event_state = 'pending'
    where id = write_record.id;
    return pg_catalog.jsonb_build_object('result', 'RESERVED', 'time_block_id', write_record.id, 'attempt_token', new_attempt_token);
  end if;

  new_attempt_token := extensions.gen_random_uuid();
  insert into public.time_blocks (
    user_id, task_id, routine_id, planning_session_id, planning_block_id,
    start_at, end_at, status, source, google_calendar_id, google_event_id,
    calendar_write_status, calendar_write_attempt_token, calendar_write_lease_until,
    calendar_write_attempt_count, calendar_event_state
  ) values (
    current_user_id,
    case when block_record.source_type = 'task' and block_record.source_entity_id ~* uuid_pattern then block_record.source_entity_id::uuid else null end,
    case when block_record.source_type = 'routine' and block_record.source_entity_id ~* uuid_pattern then block_record.source_entity_id::uuid else null end,
    p_session_id, p_block_id, block_record.start_at, block_record.end_at,
    'approved', 'ai', p_calendar_id, p_google_event_id,
    'writing', new_attempt_token, pg_catalog.clock_timestamp() + interval '2 minutes', 1, 'pending'
  )
  returning * into write_record;

  return pg_catalog.jsonb_build_object('result', 'RESERVED', 'time_block_id', write_record.id, 'attempt_token', new_attempt_token);
end;
$$;

create or replace function public.complete_calendar_event_write(
  p_block_id uuid,
  p_attempt_token uuid,
  p_success boolean,
  p_error_code text,
  p_after_data jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  write_record public.time_blocks%rowtype;
  next_status text;
  safe_after_data jsonb := coalesce(p_after_data, '{}'::jsonb);
begin
  if current_user_id is null then return 'NOT_FINISHED'; end if;
  if p_success is null then raise exception 'success flag is required' using errcode = '22023'; end if;
  if pg_catalog.jsonb_typeof(safe_after_data) <> 'object' or pg_catalog.pg_column_size(safe_after_data) > 4096 then
    raise exception 'invalid audit data' using errcode = '22023';
  end if;
  if not p_success and (p_error_code is null or length(p_error_code) not between 1 and 100) then
    raise exception 'failure code is required' using errcode = '22023';
  end if;

  select * into write_record
  from public.time_blocks
  where planning_block_id = p_block_id
    and user_id = current_user_id
    and calendar_write_status = 'writing'
    and calendar_write_attempt_token = p_attempt_token
  for update;
  if not found then return 'NOT_FINISHED'; end if;

  next_status := case when p_success then 'succeeded' else 'failed' end;
  update public.time_blocks
  set calendar_write_status = next_status,
      calendar_write_attempt_token = null,
      calendar_write_lease_until = null,
      calendar_write_error_code = case when p_success then null else p_error_code end,
      written_at = case when p_success then pg_catalog.clock_timestamp() else null end,
      calendar_event_state = case when p_success then 'active' else 'pending' end
  where id = write_record.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, before_data, after_data)
  values (
    current_user_id,
    case when p_success then 'calendar_event_write_succeeded' else 'calendar_event_write_failed' end,
    'time_block',
    write_record.id,
    pg_catalog.jsonb_build_object(
      'calendarWriteStatus', 'writing',
      'attemptCount', write_record.calendar_write_attempt_count
    ),
    safe_after_data || pg_catalog.jsonb_build_object(
      'calendarWriteStatus', next_status,
      'calendarId', write_record.google_calendar_id,
      'googleEventId', write_record.google_event_id,
      'errorCode', case when p_success then null else p_error_code end
    )
  );

  return 'FINISHED';
end;
$$;

create function public.reserve_calendar_event_mutation(
  p_session_id uuid,
  p_block_id uuid,
  p_input_hash text,
  p_blocks_revision bigint,
  p_operation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  session_record public.planning_sessions%rowtype;
  write_record public.time_blocks%rowtype;
  new_attempt_token uuid;
  next_status text;
begin
  if current_user_id is null then return pg_catalog.jsonb_build_object('result', 'NOT_FOUND'); end if;
  if p_operation not in ('update','delete') then
    raise exception 'invalid calendar event operation' using errcode = '22023';
  end if;

  select * into session_record
  from public.planning_sessions
  where id = p_session_id and user_id = current_user_id
  for update;
  if not found then return pg_catalog.jsonb_build_object('result', 'NOT_FOUND'); end if;
  if p_operation = 'update' and session_record.status <> 'approved' then
    return pg_catalog.jsonb_build_object('result', 'NOT_APPROVED');
  end if;
  if p_operation = 'delete' and session_record.status not in ('approved','superseded') then
    return pg_catalog.jsonb_build_object('result', 'NOT_MANAGEABLE');
  end if;
  if session_record.input_hash is distinct from p_input_hash then
    return pg_catalog.jsonb_build_object('result', 'INPUT_CHANGED');
  end if;
  if session_record.blocks_revision is distinct from p_blocks_revision then
    return pg_catalog.jsonb_build_object('result', 'BLOCKS_CHANGED');
  end if;

  perform 1 from public.planning_blocks
  where id = p_block_id and planning_session_id = p_session_id and user_id = current_user_id
  for update;
  if not found then return pg_catalog.jsonb_build_object('result', 'BLOCK_NOT_FOUND'); end if;

  select * into write_record
  from public.time_blocks
  where planning_block_id = p_block_id
    and planning_session_id = p_session_id
    and user_id = current_user_id
    and calendar_write_status = 'succeeded'
  for update;
  if not found then return pg_catalog.jsonb_build_object('result', 'EVENT_NOT_FOUND'); end if;

  if p_operation = 'delete' and write_record.calendar_event_state = 'deleted' then
    return pg_catalog.jsonb_build_object('result', 'ALREADY_DELETED');
  end if;
  if p_operation = 'update' and write_record.calendar_event_state = 'deleted' then
    return pg_catalog.jsonb_build_object('result', 'EVENT_DELETED');
  end if;
  if write_record.calendar_mutation_status in ('updating','deleting')
    and write_record.calendar_mutation_lease_until > pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('result', 'IN_PROGRESS');
  end if;

  new_attempt_token := extensions.gen_random_uuid();
  next_status := case when p_operation = 'update' then 'updating' else 'deleting' end;
  update public.time_blocks
  set calendar_mutation_status = next_status,
      calendar_mutation_attempt_token = new_attempt_token,
      calendar_mutation_lease_until = pg_catalog.clock_timestamp() + interval '2 minutes',
      calendar_mutation_attempt_count = calendar_mutation_attempt_count + 1,
      calendar_mutation_error_code = null
  where id = write_record.id;

  return pg_catalog.jsonb_build_object('result', 'RESERVED', 'attempt_token', new_attempt_token);
end;
$$;

create function public.complete_calendar_event_mutation(
  p_block_id uuid,
  p_attempt_token uuid,
  p_success boolean,
  p_error_code text,
  p_after_data jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  write_record public.time_blocks%rowtype;
  operation_name text;
  next_status text;
  safe_after_data jsonb := coalesce(p_after_data, '{}'::jsonb);
begin
  if current_user_id is null then return 'NOT_FINISHED'; end if;
  if p_success is null then raise exception 'success flag is required' using errcode = '22023'; end if;
  if pg_catalog.jsonb_typeof(safe_after_data) <> 'object' or pg_catalog.pg_column_size(safe_after_data) > 4096 then
    raise exception 'invalid audit data' using errcode = '22023';
  end if;
  if not p_success and (p_error_code is null or length(p_error_code) not between 1 and 100) then
    raise exception 'failure code is required' using errcode = '22023';
  end if;

  select * into write_record
  from public.time_blocks
  where planning_block_id = p_block_id
    and user_id = current_user_id
    and calendar_mutation_status in ('updating','deleting')
    and calendar_mutation_attempt_token = p_attempt_token
  for update;
  if not found then return 'NOT_FINISHED'; end if;

  operation_name := case when write_record.calendar_mutation_status = 'updating' then 'update' else 'delete' end;
  next_status := case
    when p_success then 'idle'
    when operation_name = 'update' then 'update_failed'
    else 'delete_failed'
  end;

  update public.time_blocks
  set calendar_event_state = case when p_success and operation_name = 'delete' then 'deleted' else calendar_event_state end,
      calendar_mutation_status = next_status,
      calendar_mutation_attempt_token = null,
      calendar_mutation_lease_until = null,
      calendar_mutation_error_code = case when p_success then null else p_error_code end,
      calendar_updated_at = case when p_success and operation_name = 'update' then pg_catalog.clock_timestamp() else calendar_updated_at end,
      calendar_deleted_at = case when p_success and operation_name = 'delete' then pg_catalog.clock_timestamp() else calendar_deleted_at end
  where id = write_record.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, before_data, after_data)
  values (
    current_user_id,
    'calendar_event_' || operation_name || case when p_success then '_succeeded' else '_failed' end,
    'time_block',
    write_record.id,
    pg_catalog.jsonb_build_object(
      'calendarEventState', write_record.calendar_event_state,
      'calendarMutationStatus', write_record.calendar_mutation_status,
      'attemptCount', write_record.calendar_mutation_attempt_count
    ),
    safe_after_data || pg_catalog.jsonb_build_object(
      'calendarEventState', case when p_success and operation_name = 'delete' then 'deleted' else write_record.calendar_event_state end,
      'calendarMutationStatus', next_status,
      'calendarId', write_record.google_calendar_id,
      'googleEventId', write_record.google_event_id,
      'errorCode', case when p_success then null else p_error_code end
    )
  );

  return 'FINISHED';
end;
$$;

revoke all on function public.reserve_calendar_event_mutation(uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.reserve_calendar_event_mutation(uuid, uuid, text, bigint, text) to authenticated;
revoke all on function public.complete_calendar_event_mutation(uuid, uuid, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_calendar_event_mutation(uuid, uuid, boolean, text, jsonb) to authenticated;
