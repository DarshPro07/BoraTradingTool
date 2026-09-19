# 05 — Slices

| # | Slice | Proof it failed first | Status |
|---|---|---|---|
| 1 | Freshness is judged against the latest expected session (`latestExpectedSession`, `isCurrentThroughLatestSession`). One predicate is used by the planner, executor and resolver | "reads a universe that stopped TOGETHER as stale": `expected true to be false` on the old code | done |
| 2 | The cycle resolves data gaps every pass, before the worker. The worker is budgeted at 100 jobs / 4 min | "queues and drains a deep-but-stale instrument": `expected undefined to be defined` on the old code | done |
| 3 | The calendar extends itself, derived-only and fail-closed (`calendar-extension.ts`). The sync script shares the renderer | 9 unit cases, including stops at an ambiguous weekday, at a contradicting holiday and on stray weekend bars. The renderer reproduces the committed file's 416 data lines exactly | done |

Fixtures that encoded the old relative rule were given pinned clocks. No assertion was weakened.
- `ingest.test.ts` and `dependency-resolver.test.ts`: the test-mode provider serves bars ending
  2025-09-17.
- `universe-coverage.test.ts`: the "ready" fixture's last bar is 2024-02-22.
- `freshness-planning.invariant.test.ts`: the clock is pinned to its own NOW.

One test expectation was mine and wrong: a contradiction stop lands after the empty weekend
before it, 09-13, not 09-11. The implementation is right, so the test was corrected.
