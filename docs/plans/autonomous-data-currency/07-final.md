# 07 — Final

## Objective

Daily data and the research calendar stay current with only the scheduled Windows task running:
no human, no Claude session and no browser.

## What changed

- **Freshness is now judged against the latest session the calendar says should exist.** It was
  judged against the store's own newest bar. That rule had a deadlock: if everything paused at once,
  nothing ever looked stale. It also refreshed each instrument only every 4 or 5 days.
- **The cycle queues refresh work on every pass.** It used to do so only when a strategy's
  universe had no bars at all.
- **The worker is budgeted at 100 jobs or 4 minutes per cycle**, inside the 10-minute lease. It was
  10 jobs a cycle, about 960 a day against about 2,100 needed.
- **The calendar extends itself** from price data, with no network. It stops, rather than guesses, at
  any date the data leaves ambiguous.

## Evidence

- `npm run check` exit 0:
  - unit: 201 files, 2,214 passed, 2 skipped;
  - invariants: 8 files, 35 passed;
  - mcp: 4 passed;
  - build: compiled.
- Both regression invariants failed against the unfixed code, with the messages recorded in
  `05-slices.md`.
- The calendar renderer reproduces the committed calendar's data sections exactly.

## Not yet verified

- **Production drain.** The next scheduled cycles must show `Data gaps: enqueued …` and a
  falling stale count. The code is live at the next cycle, because `cycle.mjs` re-bundles.
- **Calendar extension on the real store.** It holds until at least half of the reference
  instruments are current, which the running catch-up is producing.
- **The last scheduled run's `0x800710E0` result is undiagnosed.** It may be the Task Scheduler
  refusing an overlapping instance.
- **Independent verification (Gate 5) is still to run.**

## Rollback

Revert the commit. There is no schema or data change.

## Verdict: PARTIALLY_VERIFIED
