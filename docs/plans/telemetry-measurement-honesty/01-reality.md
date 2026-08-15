# Gate 0 — reality (all STATICALLY_CONFIRMED by direct read, 2026-08-15)

## Defect (a): tokens=0 written and read as "measured" when nothing was measured

**Write path** — `lib/agents/team-runtime.ts:488-506`:
```ts
const totalTokens = outcomes.reduce((sum, o) => sum + (o.tokens ?? 0), 0);
...
completeTeamRun({ ..., tokens: totalTokens, cost: totalCost > 0 ? totalCost : null, ... });
```
An all-unmeasured COMPLETED team (every member `tokens: null`) writes `tokens: 0` to the team
row. Cost already collapses to null (`> 0` guard); tokens does not. The deterministic
chief-of-staff run is recorded with `tokens: null` BY DESIGN (`team-runtime.ts` recordAgentRun
call: provider `"deterministic"`) — it is not a model call, so it is not "unmeasured".

**Read model** — `lib/brain/execution-trace.ts:248`: `tokens: row.tokens ?? childTokens` — a row
holding the fake 0 wins over the children's honest null, so `totals.tokens === 0`.

**Render** — `app/brain/executions/[id]/page.tsx:252-254`: the cost line branches on
`trace.totals.tokens !== null`, printing "COST UNAVAILABLE (tokens measured; no pricing source)"
over a total nothing measured. These are the only two composition sites of the totals-level COST
UNAVAILABLE strings in the repo (repo-wide grep); the member-row bare "COST UNAVAILABLE"
(page.tsx:165) is per-run raw display and out of scope.

**Stale comment** — `execution-trace.ts:71`: "Null = COST UNAVAILABLE (tokens still measured)" —
describes the pre-fix world where tokens were assumed measured.

**Existing test pins the dishonest behavior** — `lib/brain/execution-trace.test.ts:309-359`
seeds the all-unmeasured COMPLETED team through the runtime's own writers, passes `tokens: 0`
with the comment "The runtime sums member tokens with `?? 0`", and asserts
`trace?.totals.tokens).toBe(0)`. `reconciled` is already honest (null / NOT COMPARABLE).

**Partial measurement is also conflated**: `childTokens` sums only the measured members
(`:238-239`), so a 2-of-4-measured team renders its partial sum indistinguishably from a fully
measured one. Same honesty class, fixed in the same pass.

**Consumers of `team_runs.tokens`** (repo-wide grep for `schema.teamRuns`): only
`execution-trace.ts` reads it back. `completeTeamRun` already accepts `tokens: number | null`
(`team-runs.ts:111`) and the column is nullable (`schema.ts:1049`, no `.notNull()`). The /brain
RECENT WORK panel (`app/brain/page.tsx:210`) renders `execution.tokens ?? "—"` from the raw row.
No Model Router code reads team token totals today (the owner's concern is prospective).

## Defect (b): the two acceptance skips carry a reason but no typed classification

`e2e/app.spec.ts:79-95`: both deliberate skips share one reason constant (`fixtureOnly` =
"requires MARKETPULSE_TEST_MODE fixtures; the external server under test does not run in test
mode") with a good doc comment. The acceptance summary shows only "2 skipped"; nothing marks the
set as EXPECTED, and nothing would flag a third silent skip joining them. Mobile-policy skips
are excluded at the runner (`--grep-invert "mobile"`) or self-skip on project name and do not
contribute to the desktop pair's "2 skipped"; stage-2's per-stock runtime skips are legitimately
conditional and fired zero times in runs 13/14.

## Label

Every statement above: STATICALLY_CONFIRMED. The run-13/14 "2 skipped" identity (these two
tests): OBSERVED in `.tmp/master-run13.log` / `.tmp/master-run14.log`.
