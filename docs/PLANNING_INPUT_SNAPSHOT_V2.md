# Planning Input Snapshot V2

Legacy `input_hash` did not directly include Task or Routine titles. A title-only change with the same `updatedAt` could therefore
produce the same hash, so an approved legacy Session cannot safely provide the title for a future Google Calendar preview.

V2 stores a server-generated canonical snapshot with `schemaVersion = planning-input-v2` and uses
`engineVersion = deterministic-v2`. The SHA-256 input hash is calculated from the complete canonical snapshot.

The snapshot contains the Planning window, the existing intentional planning time, normalized Task and Routine planning fields,
canonical titles, Routine completions, and merged Google busy start/end intervals. All collections are deterministically sorted.
It excludes descriptions, notes, categories, Google titles or identifiers, Calendar IDs, attendees, email addresses, connection
identifiers, OAuth tokens, OpenAI data, and the request Idempotency-Key.

Titles are NFC-normalized, stripped of control characters, trimmed, and limited to 200 Unicode code points. Empty titles use
`名称未設定のタスク` or `名称未設定のルーティン`. The future preview will use the same canonical title function.

Before Approval or AI Advice, the server validates the stored schema, field allowlist, limits, duplicate IDs, and stored hash. It
then rebuilds V2 from current server-owned inputs. A changed current hash is `PLAN_STALE`; an invalid stored snapshot is
`PLAN_INVALID`. Snapshot data and hashes are never returned by the public API.

Legacy Sessions keep null snapshot columns and are never backfilled. They remain readable, but legacy drafts cannot be approved,
sent for AI Advice, or used by Calendar Preview/write. The user must explicitly create a new V2 plan.

## Rollout status

1. Apply `20260715001000_planning_input_snapshot_v2.sql`, adding nullable columns and `create_planning_session_v2` while retaining the legacy RPC.
2. Deploy V2 server code and verify new normal and AI Sessions.
3. Verify Preview, Google Calendar creation, idempotent retry, canonical resync, and deletion with V2 Sessions.
4. Apply `20260803000400_drop_legacy_planning_session_rpc.sql`, revoking and removing the legacy creation RPC without `CASCADE`.

The V2 rollout and Calendar verification are complete. New legacy Sessions can no longer be created; existing legacy rows remain
readable but cannot be approved, sent for AI Advice, previewed, or written to Google Calendar.
