alter table public.planning_sessions
  add column manually_edited boolean not null default false;

-- 手動削除は決定論的Engineの再計算結果と保存blocksの完全一致を崩すため、
-- 以後の承認・Calendar書き込み検証はvalidateProposedBlocksAgainstConstraints
-- （hard constraintのみの再検証）へ切り替える必要がある。
create or replace function public.delete_planning_block(p_block_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  block_session_id uuid;
  changed_revision bigint;
  deleted_count bigint;
begin
  if current_user_id is null then
    return 'NOT_DELETED';
  end if;

  select planning_session_id
    into block_session_id
  from public.planning_blocks
  where id = p_block_id
    and user_id = current_user_id
  for update;

  if block_session_id is null then
    return 'NOT_DELETED';
  end if;

  update public.planning_sessions
  set blocks_revision = blocks_revision + 1,
      manually_edited = true
  where id = block_session_id
    and user_id = current_user_id
    and status = 'draft'
  returning blocks_revision into changed_revision;

  if changed_revision is null then
    return 'NOT_DELETED';
  end if;

  delete from public.planning_blocks
  where id = p_block_id
    and user_id = current_user_id
    and planning_session_id = block_session_id;

  get diagnostics deleted_count = row_count;
  if deleted_count <> 1 then
    raise exception 'planning block deletion failed' using errcode = '40001';
  end if;

  return 'DELETED';
end;
$$;

revoke all on function public.delete_planning_block(uuid) from public, anon, authenticated;
grant execute on function public.delete_planning_block(uuid) to authenticated;

create function public.update_planning_block_time(
  p_block_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  block_record public.planning_blocks%rowtype;
  session_status text;
  new_duration integer;
  overlap_count integer;
begin
  if current_user_id is null then return 'NOT_UPDATED'; end if;
  if p_start_at is null or p_end_at is null or p_start_at >= p_end_at then
    raise exception 'invalid block time range' using errcode = '22023';
  end if;
  if date_trunc('minute', p_start_at) <> p_start_at or date_trunc('minute', p_end_at) <> p_end_at then
    raise exception 'block time must be minute-aligned' using errcode = '22023';
  end if;
  new_duration := round(extract(epoch from (p_end_at - p_start_at)) / 60)::integer;
  if new_duration <= 0 then
    raise exception 'block duration must be positive' using errcode = '22023';
  end if;

  select * into block_record
  from public.planning_blocks
  where id = p_block_id and user_id = current_user_id
  for update;
  if not found then return 'NOT_UPDATED'; end if;

  select status into session_status
  from public.planning_sessions
  where id = block_record.planning_session_id and user_id = current_user_id and status = 'draft'
  for update;
  if session_status is null then return 'NOT_UPDATED'; end if;

  select count(*) into overlap_count
  from public.planning_blocks
  where planning_session_id = block_record.planning_session_id
    and user_id = current_user_id
    and id <> p_block_id
    and tstzrange(start_at, end_at) && tstzrange(p_start_at, p_end_at);
  if overlap_count > 0 then return 'OVERLAPS'; end if;

  update public.planning_blocks
  set start_at = p_start_at, end_at = p_end_at, duration_minutes = new_duration
  where id = p_block_id;

  update public.planning_sessions
  set blocks_revision = blocks_revision + 1, manually_edited = true
  where id = block_record.planning_session_id;

  return 'UPDATED';
end;
$$;

revoke all on function public.update_planning_block_time(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.update_planning_block_time(uuid, timestamptz, timestamptz) to authenticated;

create function public.update_planning_block_task(
  p_block_id uuid,
  p_task_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  block_record public.planning_blocks%rowtype;
  session_status text;
  task_title text;
begin
  if current_user_id is null then return 'NOT_UPDATED'; end if;
  if p_task_id is null then
    raise exception 'task id is required' using errcode = '22023';
  end if;

  select * into block_record
  from public.planning_blocks
  where id = p_block_id and user_id = current_user_id
  for update;
  if not found then return 'NOT_UPDATED'; end if;
  if block_record.source_type <> 'task' then return 'NOT_TASK_BLOCK'; end if;

  select status into session_status
  from public.planning_sessions
  where id = block_record.planning_session_id and user_id = current_user_id and status = 'draft'
  for update;
  if session_status is null then return 'NOT_UPDATED'; end if;

  select title into task_title
  from public.tasks
  where id = p_task_id and user_id = current_user_id and status <> 'cancelled' and status <> 'completed'
  for update;
  if task_title is null then return 'TASK_NOT_FOUND'; end if;

  update public.planning_blocks
  set source_entity_id = p_task_id::text, title = task_title
  where id = p_block_id;

  update public.planning_sessions
  set blocks_revision = blocks_revision + 1, manually_edited = true
  where id = block_record.planning_session_id;

  return 'UPDATED';
end;
$$;

revoke all on function public.update_planning_block_task(uuid, uuid) from public, anon, authenticated;
grant execute on function public.update_planning_block_task(uuid, uuid) to authenticated;
