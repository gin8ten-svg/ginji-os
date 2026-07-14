create table public.planning_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','approved','rejected','superseded')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  engine_version text not null,
  warning_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  unique (id, user_id),
  check (window_start < window_end)
);

create table public.planning_blocks (
  id uuid primary key default extensions.gen_random_uuid(),
  planning_session_id uuid not null,
  user_id uuid not null,
  source_type text not null check (source_type in ('task','routine')),
  source_entity_id text not null check (length(source_entity_id) > 0),
  title text not null check (length(trim(title)) > 0),
  start_at timestamptz not null,
  end_at timestamptz not null,
  block_index integer not null default 1 check (block_index > 0),
  duration_minutes integer not null check (duration_minutes > 0),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (planning_session_id, user_id) references public.planning_sessions(id, user_id) on delete cascade,
  check (start_at < end_at)
);

create index planning_sessions_user_created_idx on public.planning_sessions(user_id, created_at desc);
create index planning_sessions_user_status_idx on public.planning_sessions(user_id, status);
create index planning_blocks_user_session_idx on public.planning_blocks(user_id, planning_session_id);
create index planning_blocks_user_start_idx on public.planning_blocks(user_id, start_at);
create index planning_blocks_session_start_idx on public.planning_blocks(planning_session_id, start_at);

create trigger planning_sessions_set_updated_at before update on public.planning_sessions
for each row execute function public.set_updated_at();

alter table public.planning_sessions enable row level security;
alter table public.planning_blocks enable row level security;

create policy planning_sessions_select_own on public.planning_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy planning_sessions_insert_own on public.planning_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy planning_sessions_update_own on public.planning_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy planning_sessions_delete_own on public.planning_sessions for delete to authenticated using ((select auth.uid()) = user_id);
create policy planning_blocks_select_own on public.planning_blocks for select to authenticated using ((select auth.uid()) = user_id);
create policy planning_blocks_insert_own on public.planning_blocks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy planning_blocks_update_own on public.planning_blocks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy planning_blocks_delete_own on public.planning_blocks for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.planning_sessions, public.planning_blocks to authenticated;
revoke all on public.planning_sessions, public.planning_blocks from anon;

create or replace function public.approve_planning_session(p_session_id uuid, p_input_hash text)
returns text language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  update public.planning_sessions
  set status = 'approved', approved_at = now(), rejected_at = null
  where id = p_session_id and user_id = (select auth.uid()) and status = 'draft' and input_hash = p_input_hash;
  get diagnostics changed = row_count;
  if changed = 0 then return 'NOT_UPDATED'; end if;
  update public.planning_sessions set status = 'superseded'
  where user_id = (select auth.uid()) and status = 'draft' and id <> p_session_id;
  return 'APPROVED';
end;
$$;

create or replace function public.reject_planning_session(p_session_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  update public.planning_sessions set status = 'rejected', rejected_at = now()
  where id = p_session_id and user_id = (select auth.uid()) and status = 'draft';
  get diagnostics changed = row_count;
  if changed = 0 then return 'NOT_UPDATED'; end if;
  return 'REJECTED';
end;
$$;

grant execute on function public.approve_planning_session(uuid, text) to authenticated;
grant execute on function public.reject_planning_session(uuid) to authenticated;
revoke all on function public.approve_planning_session(uuid, text), public.reject_planning_session(uuid) from anon;
