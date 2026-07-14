alter table public.planning_sessions
  add column input_now timestamptz not null,
  add column result_summary jsonb not null default '{}';
