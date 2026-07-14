revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

create index tasks_category_owner_idx on public.tasks(category_id, user_id);
create index routines_category_owner_idx on public.routines(category_id, user_id);
create index routine_completions_routine_owner_idx on public.routine_completions(routine_id, user_id);
