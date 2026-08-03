# Google Calendar Event Preview

Planning Input Snapshot V2 was migrated and verified in production on 2026/07/31 (draft creation and approval both
confirmed working end-to-end with `deterministic-v2`). The overlap-prevention migration below was applied and verified
in production on 2026/08/03: two approvals in immediate succession for the same user left exactly one `approved`
session (the newer one) with the earlier overlapping session correctly moved to `superseded`. Implementation may now
proceed. Legacy hashes did not directly bind Task and Routine titles, so using current titles for an approved Session
could misrepresent what was approved.

## Resolved blocker before implementation

Claude Code audit (2026/07/31): `approve_planning_session` (`supabase/migrations/20260715000800_planning_approval_race_fix.sql`)
only supersedes the same user's other `draft` sessions on approval. Existing `approved` sessions with an overlapping
`window` are left untouched, so a user can end up with two `approved` sessions covering overlapping time. If Calendar
write later treats "any approved session" as valid input, this can create duplicate Calendar events for the same
block.

Resolved in `20260731000100_prevent_overlapping_approved_planning_sessions.sql`. Approval now serializes the same user's
approval transactions, supersedes existing `approved` Sessions whose half-open windows overlap, and then approves the selected
draft in one transaction. The migration preserves historical blocks and the original `approved_at`, reconciles any
pre-existing overlap by retaining the newest approval, and adds a partial GiST exclusion constraint as a database-level
backstop. `src/lib/planning/server.ts` requires no overlap pre-check because it already uses only this atomic RPC; a
server-side read followed by a write would not close the database race. The migration must be applied and exercised in
the target environment before Preview is deployed.

The future read-only preview will accept only an approved V2 Session, verify the stored snapshot and current input hash, rerun the
deterministic engine, and compare canonical blocks. Display titles will come from the immutable stored snapshot, not client input.
A stale plan requires explicit replanning and approval.

No preview endpoint or UI exists yet. No title is sent to Google, OAuth scopes remain read-only, and no Calendar write API exists.
Future write work must independently revalidate rather than trusting preview output, and must add idempotency and audit logs.
OpenAI remains unconfigured and no external AI call is required for this snapshot foundation.
