# Gate 1 — Product

## User problem

The P0 Final Proof review found the autonomy story is "PARTIALLY_VERIFIED — architecture largely
established; Level-9/runtime autonomy is not yet proven." Eight concrete gaps remain, and the
product owner needs a single, evidence-based verdict that either closes the P0 or names each
remaining gap precisely.

## User

The product owner (authenticated session via `MARKETPULSE_AGENT_TOKEN` / loopback). The review
verdict is the input; the owner's acceptance criteria are the target.

## Current behavior

1. `tsc --noEmit` was blocked by TS1308 in `e2e/crash-recovery.spec.ts:112` (async `await` in a
   synchronous `test.skip` predicate). **Fixed** — `tsc` is clean.
2. The 30-stock matrix already enforces `>= 30`. **Done** — no fix needed.
3. The unit suite was 1,622/0. **Done** — no fix needed.
4. `golden-journey.spec.ts` covers authoring → backtest → trade inspection but is NOT the full
   15-step lifecycle and still bears the "golden journey" name. **Partial** — needs rename.
5. `golden-journey-full-lifecycle.spec.ts` does not exist. **Missing.**
6. `app/api/golden-journey/route.ts` covers 3 of 15 steps. **Partial.**
7. `paper-lifecycle.spec.ts` is complete. **Done.**
8. `crash-recovery.spec.ts` is complete in logic but was blocked by TS1308. **Fixed, pending
   verification.**
9. `auto-mode-concurrency.spec.ts` exists and honestly documents sequential execution. **Done** —
   but the review demands concurrency. This is a finding, not a bug.

## Desired outcome

A verified verdict `VERIFIED_FOR_DEFINED_SCOPE` covering all 8 closure items, with:

- A renamed partial Golden Journey (no longer called "golden journey").
- A real 15-step `golden-journey-full-lifecycle.spec.ts` that proves the chain end-to-end through
  real HTTP surfaces, asserting honestly on every step (including refusals where data/providers
  are absent).
- An expanded `app/api/golden-journey/route.ts` covering all 15 steps.
- A clean `tsc --noEmit` (0 errors), `vitest run` (0 failures), and an honest concurrency
  verification.

## Success evidence

1. `npx tsc --noEmit` exits 0. ✅ (already fixed)
2. `npx vitest run` → 0 failed. ✅
3. `e2e/nse-30-stock-matrix.spec.ts` asserts `>= 30` and `.toBe(30)`. ✅ (already correct)
4. `e2e/crash-recovery.spec.ts` compiles and runs (kill+restart+resume+audit). ⏳
5. `e2e/paper-lifecycle.spec.ts` passes. ✅
6. `e2e/auto-mode-concurrency.spec.ts` verifies lane behavior (honest: sequential by design). ✅
7. `e2e/golden-journey-full-lifecycle.spec.ts` — new file, 15 steps verified. ⏳
8. `app/api/golden-journey/route.ts` — 15 steps, not 3. ⏳
9. `golden-journey.spec.ts` renamed and re-described. ⏳

## Failure conditions

- tsc reports any error → blocker.
- Any unit test failure → blocker.
- The full-lifecycle Golden Journey spec does not exist → not verified.
- The concurrency spec hides/fakes overlap → dishonest, rejected.
- Any step claims success when the product actually refuses → fabrication.

## User journeys (15-step Golden Journey)

| Step | Name | Through | Expected honest behavior |
|------|------|---------|------------------------|
| 1 | NSE Identity | `GET /api/system/identity` | Returns buildId, pid, schema, db fingerprint |
| 2 | Data Snapshot | `GET /api/research-data/bars` or `/api/candles` | Returns stored bars or NO_DATA with remedy |
| 3 | Research | `POST /api/research/stock` | SOURCE_VERIFIED envelope or honest refusal (no provider) |
| 4 | Evidence | (from research response) | Evidence fingerprint + verification status |
| 5 | Hypothesis | `POST /api/research/hypotheses` | EXPRESSIBLE or named refusal |
| 6 | Strategy IR | `POST /api/strategy/author` | 201 CREATED with spec id |
| 7 | Backtest | `POST /api/strategy/trades` | Trades or NO_DATA |
| 8 | Trades | (from backtest) | Trade ledger entries |
| 9 | Selection Trial | `POST /api/strategy/gauntlet` | 428 (confirmation required) |
| 10 | Validation | `POST /api/strategy/gauntlet` (confirmed) | 412/503/422 with named reason |
| 11 | Holdout | (from validation response) | Holdout budget untouched assertion |
| 12 | Forward | `POST /api/forward/run` | Shadow + paper pass with evaluatedAsOf |
| 13 | Paper | `POST /api/paper/orders` / `GET /api/paper/portfolio` | Fill or honest refusal |
| 14 | Alpha Health | `POST /api/quant/analytics` | Analytics or NO_EXPERIMENT refusal |
| 15 | Memory | `GET /api/memory/trace` + `GET /api/brain` | Knowledge trace + brain state |

## Non-goals

- No broker integration (CLAUDE.md: "This system has no broker adapter and places no orders").
- No live research provider credentials (the /api/research/stock step must refuse honestly when
  no provider is configured).
- No runtime scheduler refactoring for true concurrency (engine lane owns the scheduler per
  WORK_QUEUE.md; the machine is sequential by design).
