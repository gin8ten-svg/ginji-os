revoke all on function public.reserve_planning_block_delete(uuid, uuid) from public, anon, authenticated;

drop policy if exists planning_blocks_delete_own_draft on public.planning_blocks;
drop function public.reserve_planning_block_delete(uuid, uuid);

revoke delete on table public.planning_blocks from authenticated;

create function public.delete_planning_block(p_block_id uuid)
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
  set blocks_revision = blocks_revision + 1
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
