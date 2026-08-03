alter table public.planning_blocks
  add constraint planning_blocks_id_session_user_key
  unique (id, planning_session_id, user_id);

create table public.time_blocks (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid,
  routine_id uuid,
  planning_session_id uuid not null,
  planning_block_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'approved' check (status in ('proposed','approved','in_progress','completed','skipped')),
  source text not null default 'ai' check (source in ('manual','ai','google')),
  google_calendar_id text not null check (length(google_calendar_id) between 1 and 512),
  google_event_id text not null check (google_event_id ~ '^[0-9a-v]{5,1024}$'),
  calendar_write_status text not null check (calendar_write_status in ('writing','succeeded','failed')),
  calendar_write_attempt_token uuid,
  calendar_write_lease_until timestamptz,
  calendar_write_attempt_count integer not null default 0 check (calendar_write_attempt_count > 0),
  calendar_write_error_code text check (calendar_write_error_code is null or length(calendar_write_error_code) between 1 and 100),
  written_at timestamptz,
  actual_minutes integer check (actual_minutes is null or actual_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (planning_block_id, planning_session_id, user_id)
    references public.planning_blocks(id, planning_session_id, user_id) on delete cascade,
  foreign key (task_id, user_id) references public.tasks(id, user_id) on delete set null (task_id),
  foreign key (routine_id, user_id) references public.routines(id, user_id) on delete set null (routine_id),
  unique (planning_block_id),
  unique (user_id, google_calendar_id, google_event_id),
  check (start_at < end_at),
  check (
    (calendar_write_status = 'writing' and calendar_write_attempt_token is not null and calendar_write_lease_until is not null)
    or (calendar_write_status <> 'writing' and calendar_write_attempt_token is null and calendar_write_lease_until is null)
  ),
  check ((calendar_write_status = 'succeeded') = (written_at is not null)),
  check ((calendar_write_status = 'failed') = (calendar_write_error_code is not null))
);

create index time_blocks_user_session_idx on public.time_blocks(user_id, planning_session_id);
create index time_blocks_user_start_idx on public.time_blocks(user_id, start_at);

create trigger time_blocks_set_updated_at
before update on public.time_blocks
for each row execute function public.set_updated_at();

create table public.audit_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('calendar_event_write_succeeded','calendar_event_write_failed')),
  entity_type text not null check (entity_type = 'time_block'),
  entity_id uuid not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_user_created_idx on public.audit_logs(user_id, created_at desc);
create index audit_logs_user_entity_idx on public.audit_logs(user_id, entity_type, entity_id);

alter table public.time_blocks enable row level security;
alter table public.audit_logs enable row level security;

create policy time_blocks_select_own on public.time_blocks
for select to authenticated using ((select auth.uid()) = user_id);

create policy audit_logs_select_own on public.audit_logs
for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.time_blocks, public.audit_logs from public, anon, authenticated;
grant select on public.time_blocks, public.audit_logs to authenticated;

create function public.reserve_calendar_event_write(
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
    or p_google_event_id is null or p_google_event_id !~ '^[0-9a-v]{5,1024}$' then
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

create function public.complete_calendar_event_write(
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
      written_at = case when p_success then pg_catalog.clock_timestamp() else null end
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

revoke all on function public.reserve_calendar_event_write(uuid, uuid, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.reserve_calendar_event_write(uuid, uuid, text, bigint, text, text) to authenticated;
revoke all on function public.complete_calendar_event_write(uuid, uuid, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_calendar_event_write(uuid, uuid, boolean, text, jsonb) to authenticated;
