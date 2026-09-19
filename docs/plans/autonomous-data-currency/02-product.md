# 02 — Product

## User problem

The owner runs the system to research while away. Twice in five weeks it silently stopped
receiving market data while reporting success, and research went blind to every session after
2026-08-14. Recovery each time needed a manual script the owner does not know exists.

## Desired outcome

With only the scheduled task running, and no human, no Claude session and no browser:

1. Every main-board instrument receives the latest session's daily bar on the same evening.
2. Research, forward shadow and paper see new sessions once the data establishes them.
3. When either step cannot proceed, the cycle report says why. It does not go quiet.

## Success evidence

- A test that drives the real cycle composition shows stale instruments queued AND drained in one
  pass, and fails against the current code.
- A test that stops ingestion for the whole universe shows everything is then reported stale. This
  is the deadlock case, and it must fail against the universe-relative rule.
- Calendar extension: the derived-through date advances when enough instruments agree, and does
  NOT advance across a date the data leaves ambiguous.
- Production: the 15:26+ scheduled cycles show `Data gaps: enqueued N` and a falling stale count.

## Failure conditions

- A public holiday in the calendar makes the universe look stale. That is a false alarm, and the
  reason the relative rule existed.
- A provider hiccup permanently records a false holiday. That is data loss: the write guard would
  then reject that day's bars.
- The cycle exceeds the 10-minute lease.

## Non-goals

- No new provider and no Upstox calls. Holidays past the derived window still come only from the
  last manual sync.
- No change to the Next.js server path. It picks up a regenerated calendar on restart or rebuild.
- No broker and no orders. Unchanged.
