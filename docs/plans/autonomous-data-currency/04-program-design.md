# 04 — Program design

## Files

| File | Change |
|---|---|
| `lib/market/universe-coverage.ts` | replace `isFreshAgainstUniverse` / `STALE_AFTER_SECONDS` with `latestExpectedSession(nowMs)` + `isCurrentThroughLatestSession(lastBar, nowMs)`; `universeCoverage()` uses it |
| `lib/market/ingest.ts` | executor + `instrumentReadiness` use the new predicate; delete `universeNewestBar`; field `freshAgainstUniverse` → `currentThroughLatestSession` |
| `lib/brain/dependency-resolver.ts` | read the renamed field |
| `lib/research/worker.ts` | `runWorker(workerId, maxJobs, { budgetMs }?)` |
| `lib/learning/cycle.ts` | gap resolution every cycle before the worker; worker budget; calendar extension after the worker |
| `lib/market/calendar-extension.ts` (new) | `judgeCalendarExtension` (pure), `extendDerivedCalendar` (reads DB, writes file), `renderCalendarFile` |
| `scripts/sync-nse-calendar.mts` | render through `renderCalendarFile` |

## Contracts

```ts
export const DAILY_BAR_AVAILABLE_AFTER_IST_MINUTES: number;       // 16:30
export function latestExpectedSession(nowMs?: number): string;     // ISO date, IST
export function isCurrentThroughLatestSession(lastDailyBar: number | null, nowMs?: number): boolean;

export function runWorker(workerId?: string, maxJobs?: number,
  options?: { budgetMs?: number }): Promise<WorkerResult>;

export interface CalendarState { holidays: string[]; weekendSessions: string[];
  declared: string[]; derivedThrough: string; provenance: string }
export interface ExtensionJudgement { derivedThrough: string; addedHolidays: string[];
  addedWeekendSessions: string[]; stoppedAt: string | null; stopReason: string | null }
export function judgeCalendarExtension(input: {
  derivedThrough: string; holidays: ReadonlySet<string>; referenceLastDate: string[];
  participation: ReadonlyMap<string, number>; throughDate: string }): ExtensionJudgement;
export function extendDerivedCalendar(): { advanced: boolean; summary: string };
export function renderCalendarFile(state: CalendarState): string;
```

## Tests. Each must fail against the current code

1. `tests/invariants/ingestion-refresh.invariant.test.ts`, new case: **uniform staleness is still
   staleness**. Every instrument stops at the same session, and the clock is two sessions later.
   The planner must queue them. It fails today because the relative rule calls them fresh.
2. The same file, new case: **the cycle queues AND drains a stale instrument without any
   outage**. This drives `runLearningCycle`. It fails today because layer 5 never calls the
   resolver.
3. `lib/market/calendar-extension.test.ts`: advances across unambiguous dates; declares a
   zero-participation weekday a holiday; stops at a half-observed date; stops at a declared holiday
   that has bars; never removes an existing entry.
4. `lib/research/worker.test.ts`: the budget stops new claims and never interrupts a running job.

Existing invariants that depend on the wall clock get a pinned clock, `vi.setSystemTime`, and no
assertion is weakened.

## Least-confident decisions

- **The 16:30 IST availability.** If Yahoo publishes the daily bar later, the first pass after
  16:30 fetches nothing new, and the 6-hour cooldown then delays the retry to about 22:30. Tunable
  constant.
- **Whether `runLearningCycle` is drivable in a test with the provider mocked.** If not, test 2
  drops to the composition just below it, and that is recorded.

## Rollback

Revert the commit. There is no schema or data migration. A regenerated calendar file is a normal
diff and can be reverted like one.
