# Daily ingestion refresh — final verdict

2026-09-19. Commits `4d02a29` (planner + executor) and `b5f9bae` (resolver + queue).

## Defect

One model error in four layers: "done" was judged on history DEPTH, never on FRESHNESS.

| layer | before | after |
|---|---|---|
| `planUniverseIngestion` | fixed 2026-08-26 | queues deep-but-stale as refresh |
| `ingestInstrumentHistory` | `ALREADY_READY` on depth | short-circuits only on deep AND fresh (`4d02a29`) |
| `resolveDataRequirement` | `SATISFIED` on depth | `SATISFIED` only on `ready && freshAgainstUniverse` |
| `enqueue()` | deduped against a past `succeeded` row forever | revives a `succeeded` row after `REFRESH_COOLDOWN_MS` (6h) when the caller says it is a refresh |

The 2026-08-26 fix was reported as "Bug fixed" after only the first two layers. That report was
wrong: the scheduled path runs through the resolver and the queue, and a manual catch-up that called
the executor directly was the only path exercised, which is what hid the other two.

Measured today before the fix: 2,077 of 2,122 instruments 22 calendar days behind the newest bar
(2026-09-17); `ingest_history` 2,089 succeeded, 30 dead; only AASTHA updating, because only a dead
row was revivable.

## Verification

- `tests/invariants/ingestion-refresh.invariant.test.ts` drives `resolveUniverseDataGaps`, the
  function the cycle calls. The stale case FAILED against the unfixed code
  (`expected 'succeeded' to be 'queued'`) and passes after.
- The deep-and-current and refreshed-moments-ago cases stay untouched (no provider hammering, no
  retry loop through the enqueue cadence).
- `npm run check`: unit 2200 passed / 2 skipped, invariants 31, mcp 4, build ok.

## Verdict: PARTIALLY_VERIFIED

Verified: the scheduled chain, in a temporary database, queues refresh work end to end.

Not verified: the production store draining. That needs the running app restarted on the new code
and at least one cycle observed moving the 2,077 count. At the resolver's default quota of 30 per
cycle the backlog takes ~70 cycles; `scripts/catch-up-daily.mts` drains it directly.

After data is current, `npx tsx scripts/sync-nse-calendar.mts` must run, or research keeps
withholding every session after `CALENDAR_DERIVED_THROUGH` (2026-08-14) as `SESSION_UNVERIFIED`.
