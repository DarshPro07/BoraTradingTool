# Gate 3 — Program Design

## Files

### To create
1. `e2e/golden-journey-full-lifecycle.spec.ts` — 15-step sequential lifecycle through real HTTP + DB
2. `docs/plans/marketpulse-p0-final-proof/05-slices.md` — implementation slices
3. `docs/plans/marketpulse-p0-final-proof/06-verification.md` — independent verification plan
4. `docs/plans/marketpulse-p0-final-proof/07-final.md` — final verdict

### To modify
1. `e2e/golden-journey.spec.ts` → rename to `e2e/golden-journey-core.spec.ts`; update describe block name to
   `"golden journey (core) — author, rehearse, refuse"` (no longer claims to be the full lifecycle)
2. `app/api/golden-journey/route.ts` — expand from 3 steps to all 15, chaining through real lib functions
3. `docs/plans/marketpulse-p0-final-proof/00-status.md` — update progress

## Types and contracts

### GoldenJourneyResult (route response)
```ts
interface GoldenJourneyResult {
  instrumentId: string;
  steps: StepResult[];       // one per step, with stage + outcome
  complete: boolean;          // true only if all steps reached a terminal honest state
}
interface StepResult {
  step: number;
  name: string;
  status: "ok" | "refused" | "skipped" | "error";
  data: unknown;              // step-specific payload
  note?: string;             // honest explanation (e.g. "no provider configured")
}
```

### Step → lib function mapping
| Step | Calls | Honest refusal modes |
|------|-------|---------------------|
| 1 Identity | `systemIdentity()` | never refuses |
| 2 Data | `loadStoredCandles(ticker, "D")` | `NO_DATA` (0 bars) — remedy: ingest |
| 3 Research | `researchInstrument(instrumentId)` | `NO_STORED_DATA` / `INSUFFICIENT_EVIDENCE` (no provider) |
| 4 Evidence | (from step 3 result) | refused if step 3 failed |
| 5 Hypothesis | `recordHypothesis` + `hypothesisTriage` | `NOT_A_TRADING_RULE` / `NEEDS_FEATURE` |
| 6 Strategy IR | `recordStrategySpec` | `ALREADY_BURIED` (409) |
| 7 Backtest | `runPortfolioBacktest(dsl, dataset)` | `NO_DATA` / `DSL_INVALID` |
| 8 Trades | from step 7 | N/A — data from prior step |
| 9 Trial | `runGauntlet` (no confirm) | `428 CONFIRMATION_REQUIRED` |
| 10 Validation | `runGauntlet` (confirm=true) | `412 RESEARCH_IDENTITY_MISSING` / `503` / `422` |
| 11 Holdout | (assert from step 10 refusal) | holdout budget untouched |
| 12 Forward | `runShadowPass` + `runPaperPass` | never refuses (prospective) |
| 13 Paper | `placePaperOrder` + `getPaperPortfolio` | `REJECTED` (position cap / watchlist) |
| 14 Alpha Health | `analyzeReturns(returns, periodsPerYear)` | `412 NO_EXPERIMENT` |
| 15 Memory | `traceBack`/`traceForward` + `getBrainState` | `NODE_NOT_FOUND` / `SOURCE_NOT_FOUND` |

## Call flows

### Golden Journey API route (`app/api/golden-journey/route.ts`)
```
POST /api/golden-journey { instrumentId }
  1. systemIdentity() → buildId, pid, schemaVersion, dbFingerprint
  2. resolveInstrument(instrumentId) → Instrument { id, symbol, exchange, ... }
  3. loadStoredCandles(instrument.id, "D") → bars[] (or empty → NO_DATA note)
  4. researchInstrument(instrumentId) → envelope or refusal (NO_STORED_DATA / INSUFFICIENT_EVIDENCE)
     └─ on refusal: recordHypothesis() with a canned testable statement → hypothesisTriage()
  5. recordStrategySpec({ name, dsl, hypothesisId }) → specId (or 409 ALREADY_BURIED)
  6. runPortfolioBacktest(dsl, dataset) → trades[] or NO_DATA
  7. runGauntlet(specId, dsl, evidence, actor) — without confirm first → 428 (throws nothing)
     └─ with confirm=true → throws ResearchIdentityMissing (412) OR succeeds
  8. runShadowPass(now) + runPaperPass(now) → { signals, mode, evaluatedAsOf }
  9. placePaperOrder({ instrument, side: "BUY", quantity, orderType: "MARKET", idempotencyKey })
     → { order: { status } } (FILLED or REJECTED)
 10. analyzeReturns(returns, periodsPerYear) → { sharpe, sortino, maxDrawdown, ... }
     └─ if no experiment: returns null → NO_EXPERIMENT
 11. traceForward(sourceId) or traceBack(nodeId) → { root, nodes, edges }
 12. getBrainState() → { mode, runtimeRunning, lanes, capabilities, ... }
  ── RETURN: { instrumentId, steps: [...], complete: true }
```

### e2e spec (`golden-journey-full-lifecycle.spec.ts`)
- Spawns own server on port 3298 with isolated temp DB (pattern from crash-recovery.spec.ts)
- Seeds 300 daily bars for IN:XNSE:RELIANCE (pattern from auto-mode-concurrency.spec.ts)
- Walks each step through real HTTP, asserting honest behavior
- Uses `MARKETPULSE_E2E_DB_PATH` for DB cross-checks where HTTP is silent

## Error model

- **Refusal IS success** — steps 3, 5, 10, 13, 14 may honestly refuse on a fresh DB with no provider.
  The spec asserts the *named reason* for the refusal, not a 200 OK.
- **No provider** (`QUANT_CORE_URL=off`, `MARKETPULSE_TEST_MODE=1`) → research returns INSUFFICIENT_EVIDENCE,
  gauntlet returns 412 RESEARCH_IDENTITY_MISSING (no family from a research envelope).
- **No data** → step 2 returns NO_DATA with remedy; steps 4/7/14 handle gracefully.
- **Seeded data** → the spec seeds bars so step 2 and step 7 can succeed, proving the chain works
  when data IS present.

## Test design

### Regression: golden-journey-full-lifecycle.spec.ts
- **Known failure mode**: A step that claims success when the product actually refuses → fabrication.
  The spec asserts on refusal codes/messages for every step that can refuse.
- **Known failure mode**: Missing steps → the spec steps through all 15, asserting a result
  (ok / refused-with-reason / data-present) at each.

### Regression: golden-journey-core renamed
- The partial spec is renamed and its describe block updated. No behavioral change.

## Least-confident decisions

1. **Canned hypothesis for step 5**: When research refuses (no provider), I seed a testable hypothesis
   directly into the hypotheses table via `recordHypothesis` + `authorFromHypotheses`. This is an honest
   substitution — the research step refused, so we demonstrate the remaining chain with a real
   hypothesis authored by the owner's surface. The route records this as `substitution: "canned_hypothesis"`
   with the reason.

2. **Paper order direction**: The Golden Journey uses a BUY on RELIANCE (the TEST_FIXTURE instrument).
   In test mode, the quote is deterministic (₹2,985.50). The position cap (15% of ₹1,00,00,000 = ₹15,00,000)
   is ~5,015 shares at the test fixture price — a small order fits.

3. **Memory trace node**: Step 15 traces backward from the strategy spec created in step 6, proving
   the knowledge graph connects hypothesis → strategy.

4. **Forward pass**: `runShadowPass`/`runPaperPass` are synchronous and need no DB seed — they iterate
   over `strategy_specs` entries and evaluate against stored bars. With seeded bars, they produce signals.
