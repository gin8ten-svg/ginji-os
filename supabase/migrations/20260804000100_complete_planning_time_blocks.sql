alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'calendar_event_write_succeeded',
  'calendar_event_write_failed',
  'calendar_event_update_succeeded',
  'calendar_event_update_failed',
  'calendar_event_delete_succeeded',
  'calendar_event_delete_failed',
  'time_block_completed'
));

create function public.complete_planning_time_block(
  p_session_id uuid,
  p_block_id uuid,
  p_actual_minutes integer
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
  task_record public.tasks%rowtype;
  planned_minutes integer;
  next_remaining integer;
  task_completed boolean := false;
begin
  if current_user_id is null then
    return pg_catalog.jsonb_build_object('result', 'NOT_FOUND');
  end if;
  if p_actual_minutes is not null and p_actual_minutes < 0 then
    raise exception 'actual minutes must be zero or greater' using errcode = '22023';
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
    return pg_catalog.jsonb_build_object('result', 'NOT_COMPLETABLE');
  end if;

  if execution_record.status = 'completed' then
    if execution_record.actual_minutes is null and p_actual_minutes is not null then
      update public.time_blocks
      set actual_minutes = p_actual_minutes
      where id = execution_record.id;
      insert into public.audit_logs (user_id, action, entity_type, entity_id, before_data, after_data)
      values (
        current_user_id,
        'time_block_completed',
        'time_block',
        execution_record.id,
        pg_catalog.jsonb_build_object('status', 'completed', 'actualMinutes', execution_record.actual_minutes),
        pg_catalog.jsonb_build_object('status', 'completed', 'actualMinutes', p_actual_minutes)
      );
      return pg_catalog.jsonb_build_object(
        'result', 'ACTUAL_RECORDED',
        'status', 'completed',
        'actual_minutes', p_actual_minutes,
        'task_completed', false
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'result', 'ALREADY_COMPLETED',
      'status', 'completed',
      'actual_minutes', execution_record.actual_minutes,
      'task_completed', false
    );
  end if;

  if execution_record.status not in ('approved', 'in_progress') then
    return pg_catalog.jsonb_build_object('result', 'NOT_COMPLETABLE');
  end if;

  update public.time_blocks
  set status = 'completed',
      actual_minutes = p_actual_minutes
  where id = execution_record.id;

  select * into task_record
  from public.tasks
  where id = execution_record.task_id and user_id = current_user_id
  for update;

  if found then
    if task_record.completed_at is not null or task_record.status = 'completed' then
      task_completed := true;
    elsif task_record.status <> 'cancelled' then
      planned_minutes := pg_catalog.round(extract(epoch from (execution_record.end_at - execution_record.start_at)) / 60)::integer;
      next_remaining := greatest(0, coalesce(task_record.remaining_minutes, task_record.estimated_minutes) - planned_minutes);
      task_completed := next_remaining = 0;
      update public.tasks
      set remaining_minutes = next_remaining,
          status = case when task_completed then 'completed' else status end,
          completed_at = case when task_completed then pg_catalog.clock_timestamp() else completed_at end
      where id = task_record.id;
    end if;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, before_data, after_data)
  values (
    current_user_id,
    'time_block_completed',
    'time_block',
    execution_record.id,
    pg_catalog.jsonb_build_object('status', execution_record.status, 'actualMinutes', execution_record.actual_minutes),
    pg_catalog.jsonb_build_object('status', 'completed', 'actualMinutes', p_actual_minutes, 'taskCompleted', task_completed)
  );

  return pg_catalog.jsonb_build_object(
    'result', 'COMPLETED',
    'status', 'completed',
    'actual_minutes', p_actual_minutes,
    'task_completed', task_completed
  );
end;
$$;

revoke all on function public.complete_planning_time_block(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.complete_planning_time_block(uuid, uuid, integer) to authenticated;
