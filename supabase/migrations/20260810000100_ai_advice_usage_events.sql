create table public.ai_advice_usage_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  planning_session_id uuid references public.planning_sessions(id) on delete set null,
  model text not null check (length(model) between 1 and 100),
  candidate_count integer not null check (candidate_count >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  success boolean not null,
  error_code text check (error_code is null or length(error_code) between 1 and 100),
  created_at timestamptz not null default now()
);

create index ai_advice_usage_events_user_created_idx on public.ai_advice_usage_events(user_id, created_at desc);

alter table public.ai_advice_usage_events enable row level security;

create policy ai_advice_usage_events_select_own on public.ai_advice_usage_events
for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.ai_advice_usage_events from public, anon, authenticated;
grant select on public.ai_advice_usage_events to authenticated;

create function public.record_ai_advice_usage(
  p_planning_session_id uuid,
  p_model text,
  p_candidate_count integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_success boolean,
  p_error_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  owned_session_id uuid := null;
  new_id uuid;
begin
  if current_user_id is null then return null; end if;
  if p_model is null or length(p_model) not between 1 and 100 then
    raise exception 'invalid AI advice usage model' using errcode = '22023';
  end if;
  if p_candidate_count is null or p_candidate_count < 0 then
    raise exception 'invalid AI advice usage candidate count' using errcode = '22023';
  end if;

  if p_planning_session_id is not null then
    select id into owned_session_id
    from public.planning_sessions
    where id = p_planning_session_id and user_id = current_user_id;
  end if;

  insert into public.ai_advice_usage_events (
    user_id, planning_session_id, model, candidate_count, input_tokens, output_tokens, success, error_code
  ) values (
    current_user_id, owned_session_id, p_model, p_candidate_count, p_input_tokens, p_output_tokens, p_success, p_error_code
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.record_ai_advice_usage(uuid, text, integer, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.record_ai_advice_usage(uuid, text, integer, integer, integer, boolean, text) to authenticated;
