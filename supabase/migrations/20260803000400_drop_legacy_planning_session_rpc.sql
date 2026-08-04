-- The application has completed its V2 rollout. Remove the legacy creation
-- surface so authenticated clients can no longer create snapshot-less sessions.
revoke all on function public.create_planning_session(
  uuid, timestamptz, timestamptz, timestamptz, text, text, text[], jsonb, jsonb
) from public, anon, authenticated;

drop function public.create_planning_session(
  uuid, timestamptz, timestamptz, timestamptz, text, text, text[], jsonb, jsonb
);
