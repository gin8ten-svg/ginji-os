create table public.calendar_connection_secrets (
  user_id uuid primary key references public.calendar_connections(user_id) on delete cascade,
  encrypted_refresh_token text not null,
  token_format_version smallint not null default 1 check (token_format_version = 1)
);

insert into public.calendar_connection_secrets (user_id, encrypted_refresh_token, token_format_version)
select user_id, encrypted_refresh_token, token_format_version from public.calendar_connections;

alter table public.calendar_connections
  drop column encrypted_refresh_token,
  drop column token_format_version;

alter table public.calendar_connection_secrets enable row level security;
revoke all on public.calendar_connection_secrets from public, anon, authenticated;

create function public.save_calendar_connection(p_encrypted_refresh_token text, p_granted_scopes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_encrypted_refresh_token is null or length(p_encrypted_refresh_token) = 0 then
    raise exception 'encrypted refresh token is required' using errcode = '22023';
  end if;

  insert into public.calendar_connections (user_id, granted_scopes, needs_reconnect, connected_at)
  values (current_user_id, coalesce(p_granted_scopes, '{}'), false, now())
  on conflict (user_id) do update set
    granted_scopes = excluded.granted_scopes,
    needs_reconnect = false,
    connected_at = now();

  insert into public.calendar_connection_secrets (user_id, encrypted_refresh_token, token_format_version)
  values (current_user_id, p_encrypted_refresh_token, 1)
  on conflict (user_id) do update set
    encrypted_refresh_token = excluded.encrypted_refresh_token,
    token_format_version = 1;
end;
$$;

create function public.get_calendar_connection_token()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select encrypted_refresh_token
  from public.calendar_connection_secrets
  where user_id = (select auth.uid());
$$;

revoke all on function public.save_calendar_connection(text, text[]) from public, anon, authenticated;
grant execute on function public.save_calendar_connection(text, text[]) to authenticated;
revoke all on function public.get_calendar_connection_token() from public, anon, authenticated;
grant execute on function public.get_calendar_connection_token() to authenticated;
