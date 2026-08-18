alter table public.time_blocks
  add column status_reason text
  check (status_reason is null or status_reason in ('user_skipped', 'carried_over'));

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'calendar_event_write_succeeded',
  'calendar_event_write_failed',
  'calendar_event_update_succeeded',
  'calendar_event_update_failed',
  'calendar_event_delete_succeeded',
  'calendar_event_delete_failed',
  'time_block_completed',
  'time_block_skipped'
));

create function public.skip_planning_time_block(
  p_session_id uuid,
  p_block_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  session_status text;
  execution_record public.time_blocks%rowtype;
begin
  if current_user_id is null then
    return pg_catalog.jsonb_build_object('result', 'NOT_FOUND');
  end if;
  if p_reason not in ('user_skipped', 'carried_over') then
    raise exception 'invalid skip reason' using errcode = '22023';
  end if;

  select status into session_status
  from public.planning_sessions
  where id = p_session_id and user_id = current_user_id
  for update;

  if not found then return pg_catalog.jsonb_build_object('result', 'NOT_FOUND'); end if;
  if session_status not in ('approved', 'superseded') then
    return pg_catalog.jsonb_build_object('result', 'SESSION_NOT_EXECUTABLE');
  end if;

  select * into execution_record
  from public.time_blocks
  where planning_session_id = p_session_id
    and planning_block_id = p_block_id
    and user_id = current_user_id
    and calendar_write_status = 'succeeded'
  for update;

  if not found then return pg_catalog.jsonb_build_object('result', 'NOT_FOUND'); end if;
  if execution_record.task_id is null then
    return pg_catalog.jsonb_build_object('result', 'NOT_TASK_BLOCK');
  end if;

  if execution_record.status = 'skipped' then
    return pg_catalog.jsonb_build_object('result', 'ALREADY_SKIPPED', 'status_reason', execution_record.status_reason);
  end if;
  if execution_record.status = 'completed' then
    return pg_catalog.jsonb_build_object('result', 'NOT_SKIPPABLE');
  end if;
  if execution_record.status not in ('approved', 'in_progress') then
    return pg_catalog.jsonb_build_object('result', 'NOT_SKIPPABLE');
  end if;
  if p_reason = 'carried_over' and pg_catalog.clock_timestamp() < execution_record.end_at then
    return pg_catalog.jsonb_build_object('result', 'NOT_YET_ENDED');
  end if;

  update public.time_blocks
  set status = 'skipped',
      status_reason = p_reason
  where id = execution_record.id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, before_data, after_data)
  values (
    current_user_id,
    'time_block_skipped',
    'time_block',
    execution_record.id,
    pg_catalog.jsonb_build_object('status', execution_record.status),
    pg_catalog.jsonb_build_object('status', 'skipped', 'statusReason', p_reason)
  );

  return pg_catalog.jsonb_build_object('result', 'SKIPPED', 'status_reason', p_reason);
end;
$$;

revoke all on function public.skip_planning_time_block(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.skip_planning_time_block(uuid, uuid, text) to authenticated;
