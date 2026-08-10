# Gate 2 — Architecture + program design (combined; one-component feature)

`components/research/HypothesisInbox.tsx` (client) → existing `GET /api/research/hypotheses` →
render held-first. Mounted in a HYPOTHESIS INBOX panel on `/strategies` under the composer.

No new API, no new schema, no state beyond the fetch. Errors are stated
(`hypothesis-inbox-error`); loading is stated; empty is stated. Refresh refetches on demand —
no polling, no cross-component event bus (the composer already shows its own outcome inline;
a manual refresh after composing is an acceptable cost for zero plumbing).

Files: the component, the `/strategies` mount, `e2e/hypothesis-inbox.spec.ts`.
Rollback: remove the panel; nothing else references the component.
