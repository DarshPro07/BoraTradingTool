# 03 — Architecture

## Fit

Everything stays inside the existing scheduled cycle and its durable queue. There is no new
process, table, dependency or provider.

```
cycle (every 15 min, lease 10 min)
  produce()                                  unchanged
  resolveUniverseDataGaps({quota: 100})      NEW: every cycle, was only on outage
  runWorker(id, 100, {budgetMs: 4 min})      was 10 jobs, no budget
  extendDerivedCalendar()                    NEW: derived-only, quorum-gated
  rehearsal ... outage branch                reuses the gap summary above
```

## Decisions

**D1. Freshness is judged against the latest expected session, not the store's newest bar.**
`latestExpectedSession(now)` means: today in IST if it is past 16:30 IST (close plus the provider's
publication lag), otherwise yesterday. Walk back to the nearest date `isPlausibleSessionDate`
accepts. An instrument is current if the IST date of its last bar is at least that session. This
is a single predicate in `universe-coverage.ts`, used by planner, executor and resolver.

This handles the relative rule's concern. Weekends and calendar holidays are never expected
sessions, so they raise no false alarm. A paused ingest now reads as stale, which is the point.

The residual risk is a holiday missing from the calendar. The whole universe looks stale that
evening and the 6-hour refresh cooldown bounds it to about 3 extra passes. All 2026 NSE holidays are
already declared.

**D2. Resolve gaps every cycle, not only on outage.** The call moves before `runWorker`, so work
found in a pass is drained in the same pass. The outage branch reuses its summary.

**D3. Time-budget the worker.** `runWorker` gains an optional `{ budgetMs }` and stops claiming
new jobs once the budget is spent. A running job is never interrupted. The cycle passes 4 minutes
and max 100 jobs, which keeps the cycle well inside the 10-minute lease. The supervisor path is
unchanged.

**D4. Extend the calendar automatically, derived-only, never rewriting the past.**
`extendDerivedCalendar()` judges only dates after `CALENDAR_DERIVED_THROUGH`, using reference
instruments (at least 750 daily bars). For each date in order:

- *covering* = reference instruments whose last bar is at or after this date.
- Too few covering (fewer than 50% of reference or fewer than 10): stop. There are not enough
  observers yet.
- *participation* = covering instruments with a bar on this date, as a share of covering.
- Weekday: at least 0.5 means session; 0 means holiday. Anything in between is ambiguous: stop.
- Weekend: at least 0.5 means weekend session; 0 means a normal weekend. In between: stop.
- A date already declared a holiday must show 0 participation. Anything else is a contradiction:
  stop.

The new derived-through date is the last date judged. The file is re-rendered by the same renderer
the manual script uses, so the two cannot drift. Existing holidays, weekend sessions and
exchange-declared dates are kept and only ever added to.

"Stop" fails closed: the date stays `SESSION_UNVERIFIED` and research keeps withholding it.
Nothing ambiguous is ever written as a holiday, so the write guard cannot be turned against real
bars.

## Alternatives rejected

- **Runtime calendar from the DB inside `session-calendar.ts`.** That makes a pure module used by
  the write guard, fixtures and client code impure, and would need per-bar caching.
- **A calendar table.** It needs a migration for what is one file of data.
- **A bigger worker count with no budget.** Yahoo latency varies from 1 to 6 seconds per job, so a
  count alone can overrun the lease.

## Risks

- The regenerated calendar file changes in git once per session day. That is accepted, because the
  data is local state already committed.
- A Yahoo-wide missing day during the window stops the extension rather than declaring a holiday.
  It is visible in the cycle report, and a manual sync resolves it.
