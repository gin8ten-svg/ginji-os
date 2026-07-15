# Google Calendar Event Preview

Implementation is paused until Planning Input Snapshot V2 is reviewed, migrated, and deployed. Legacy hashes did not directly
bind Task and Routine titles, so using current titles for an approved Session could misrepresent what was approved.

The future read-only preview will accept only an approved V2 Session, verify the stored snapshot and current input hash, rerun the
deterministic engine, and compare canonical blocks. Display titles will come from the immutable stored snapshot, not client input.
A stale plan requires explicit replanning and approval.

No preview endpoint or UI exists yet. No title is sent to Google, OAuth scopes remain read-only, and no Calendar write API exists.
Future write work must independently revalidate rather than trusting preview output, and must add idempotency and audit logs.
OpenAI remains unconfigured and no external AI call is required for this snapshot foundation.
