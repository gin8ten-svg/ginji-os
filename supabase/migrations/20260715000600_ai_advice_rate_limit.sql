create table public.ai_advice_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reserved_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.ai_advice_rate_limits enable row level security;

revoke all on public.ai_advice_rate_limits from anon, authenticated;

create or replace function public.reserve_ai_advice_request()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_succeeded boolean;
begin
  if (select auth.uid()) is null then
    return false;
  end if;

  with reservation as (
    insert into public.ai_advice_rate_limits (user_id, reserved_at, updated_at)
    values ((select auth.uid()), now(), now())
    on conflict (user_id) do update
      set reserved_at = excluded.reserved_at,
          updated_at = excluded.updated_at
      where public.ai_advice_rate_limits.reserved_at <= now() - interval '30 seconds'
    returning true
  )
  select coalesce(bool_or(true), false) into reservation_succeeded
  from reservation;

  return reservation_succeeded;
end;
$$;

revoke all on function public.reserve_ai_advice_request() from public, anon;
grant execute on function public.reserve_ai_advice_request() to authenticated;
