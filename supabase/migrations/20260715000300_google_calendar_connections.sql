create table public.calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  token_format_version smallint not null default 1 check (token_format_version = 1),
  granted_scopes text[] not null default '{}',
  selected_calendar_ids text[] not null default '{}',
  needs_reconnect boolean not null default false,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger calendar_connections_set_updated_at
before update on public.calendar_connections
for each row execute function public.set_updated_at();

alter table public.calendar_connections enable row level security;

create policy calendar_connections_select_own on public.calendar_connections
for select to authenticated using ((select auth.uid()) = user_id);
create policy calendar_connections_insert_own on public.calendar_connections
for insert to authenticated with check ((select auth.uid()) = user_id);
create policy calendar_connections_update_own on public.calendar_connections
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy calendar_connections_delete_own on public.calendar_connections
for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.calendar_connections to authenticated;
revoke all on public.calendar_connections from anon;
