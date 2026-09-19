# 01 — Reality

2026-09-19. Owner: "your task is to do it automated and make the system better."

## The autonomous driver

- Windows task **MarketPulse Cycle** runs `node scripts/cycle.mjs` every 15 minutes. It re-bundles
  `scripts/cycle-entry.ts` each run, so a source change is live at the next cycle. STATICALLY_CONFIRMED
- No Next.js server is running. The scheduled task is the only thing that runs unattended. OBSERVED
- Last run 15:26 IST, result `2147943467` (0x800710E0). Not yet diagnosed. OBSERVED
- The cycle lease (`lib/learning/lease.ts`) expires after `LEASE_TTL_MS` = 10 minutes. A cycle
  longer than that can be overlapped by the next one. STATICALLY_CONFIRMED

## Why daily data stopped. Six layers, one wrong model

The wrong model: an instrument is "done" if it has enough history and is not far behind the store's
own newest bar.

| # | Layer | Defect | State |
|---|---|---|---|
| 1 | `planUniverseIngestion` | depth only | fixed 2026-08-17 |
| 2 | `ingestInstrumentHistory` | `ALREADY_READY` on depth | fixed `4d02a29` |
| 3 | `resolveDataRequirement` | `SATISFIED` on depth | fixed `b5f9bae` |
| 4 | `enqueue` | deduped against an old `succeeded` row forever | fixed `b5f9bae` |
| 5 | `runLearningCycle` | calls `resolveUniverseDataGaps` only when `outageSkipped > 0`, meaning a strategy's universe has NO bars. A stale-but-present universe never triggers it. | **open** (STATICALLY_CONFIRMED: the only enqueuer of `ingest_history` is the resolver, and its only scheduled call site is inside that branch) |
| 6 | `isFreshAgainstUniverse` | "fresh" is judged against the store's newest bar, not the latest session. If ingestion pauses for everyone, nothing looks stale and nothing refreshes. Refresh starts only after 4 days behind. | **open** (STATICALLY_CONFIRMED. OBSERVED: the frontier moved only because one instrument, AASTHA, kept failing and being revived) |

Throughput: `runWorker(workerId, 10)` drains 10 jobs per cycle, about 960 a day. The universe
needs about 2,122 refreshes per trading day. Even with layers 5 and 6 fixed, the backlog can only
grow. STATICALLY_CONFIRMED

Priorities: refresh jobs enqueue at 140/150, and other kinds default to 100. `claimNextJob` orders
ascending, so a refresh backlog cannot starve other work. STATICALLY_CONFIRMED

## Why research has seen nothing since 2026-08-14

`verifySessionDate` returns `SESSION_UNVERIFIED` for any weekday after `CALENDAR_DERIVED_THROUGH`
(2026-08-14). `research-data/snapshot.ts` withholds those bars. The snapshot feeds rehearsal,
gauntlet, **forward shadow**, **paper**, statarb and the holdout evaluator. STATICALLY_CONFIRMED

So the forward-evidence clock, the only unbiased evidence this system produces, has been
starved for five weeks. It will stay that way until someone manually runs
`scripts/sync-nse-calendar.mts`. INFERRED from the above; consistent with 0 new shadow outcomes.

The sync script also calls the unauthenticated Upstox holidays API. The owner stopped
unauthenticated Upstox use on 2026-08-17, so any automated sync must be derived-only.

## Data right now (15:30 IST)

2,321,065+ daily bars. The catch-up process (PID 24024, orphaned from its killed shell, still
running) has brought about 650 of 2,122 instruments current through 2026-09-18. OBSERVED
