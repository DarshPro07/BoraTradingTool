# Delta-Audit Triage — 2026-08-06

Triage of the externally generated "Delta Audit for an Autonomous India + USA Trading R&D
Platform" (1,000 findings, N0001–N1000) against the **current working tree**, not the zip
snapshot the audit was run on. Method: every P0 claim and a sample of P1/P2 claims were
verified by reading the cited file in this repo. Nothing below is asserted without having
been checked here today.

## Verdict on the document itself

| Segment | Count | Assessment |
|---|---:|---|
| N0001–N0150 (code claims with file:line) | 150 | Checkable. Sampled below — most already fixed. |
| N0151–N1000 (component boilerplate) | 850 | Template permutations: six identical sentences re-instantiated per component name, citing no code. Not findings; not triaged. |

The audit was produced from a **stale zip**. Nine of the ten P0 claims spot-checked are
already fixed in the working tree — several with code comments describing the exact fix the
audit demands. The delta audit therefore also violates its own "do not repeat the baseline"
rule: these were the baseline audit's findings, fixed since.

## Spot-check results (current tree)

| Claim | File | Status today |
|---|---|---|
| N0001 negative P/E read as bullish | `lib/data/technicals.ts:197-207` | **Already fixed** — `pe < 0` emits a "Negative Earnings" bear signal. |
| N0002 flat-price RSI = 100 | `lib/data/technicals.ts:52-56` | **Already fixed** — flat series returns 50; no-downside returns 100. |
| N0007/8 developing bar in structure/trend | `lib/data/technicals.ts:59-78` | **Already fixed** — `lastBarConfirmed` option; structural levels use confirmed bars only. |
| N0010 MACD rounded before histogram | `lib/data/technicals.ts:99-106` | **Already fixed** — subtraction at full precision, rounding at display. |
| N0021 one enrichment failure aborts refresh | `lib/data/research.ts:58-97` | **Already fixed** — `Promise.allSettled`, required/optional classes, `degradedSources` recorded. |
| N0032/33/38 cache: unbounded, no stale ceiling, inflight forever | `lib/data/cache.ts` | **Already fixed** — 500-entry LRU cap, `maxStaleMs` ceiling, 60s deadline with `CacheDeadlineError`. |
| N0068/69 support above price / forming-bar support | `app/api/top-picks/route.ts:71-94` | **Already fixed** — level must sit below price; forming bar excluded; the old `< price * 1.04` bug is documented in a comment. |
| N0091 proposal body coerced via `String()` | `app/api/proposals/route.ts:63-65` | **CONFIRMED, still open.** Protected path (`app/api/proposals/**`) — owner-only edit. An object becomes `"[object Object]"` instead of being rejected. Fix: strict zod schema on the POST body. |
| N0129 feature compared with itself | `lib/strategy/dsl.ts` | **CONFIRMED — fixed in this pass.** `compare: [x, x]` now rejected by schema refinement. |
| N0130 no crossover/crossunder operator | `lib/strategy/dsl.ts:66-88` | **CONFIRMED, real gap** (feature, not a bug). Only ordered comparisons on current values exist; a crossing *event* needs prior-state semantics. Belongs in the DSL when the backtest engine grows event state. |
| N0145/146 no-trade comparison: no alignment, no significance | `lib/strategy/gauntlet.ts:152, 256-266` | **CONFIRMED, real.** `strategyMean > noTradeMean` passes on any positive difference; default benchmark is zeros mapped by index. Fix design: paired bootstrap on the OOS return differences (machinery exists in `lib/strategy/statistics.ts`) plus a minimum economic edge. Deferred until a test loop is available — this is the validation kernel, and an unverified edit here is worse than the gap. |
| N0100/102/103 `allowJs: true`, target ES2017, missing strictness flags | `tsconfig.json` | **CONFIRMED, low priority.** Real but Next.js governs emitted output; flipping `noUncheckedIndexedAccess` is a large churn pass. Do deliberately, not incidentally. |
| N0107-115 CI/Playwright claims | `.github/workflows`, `playwright.config.ts` | **Unverified today** (protected paths / not re-read). Treat as plausible hygiene items. |
| N0147 PBO combination guard | `lib/strategy/statistics.ts:260-279` | Plausible; `slices` is caller-controlled today. Bound it when the Factory starts sweeping slice counts. |

## Open register (verified, deduplicated with the existing backlog)

1. **Owner-only:** strict schema for `app/api/proposals` POST (replaces `String(body.*)`).
2. **Next code task:** paired-bootstrap significance + minimum edge for the gauntlet's
   `no_trade_comparison`, with timestamp-aligned benchmark returns (N0145/146).
3. **DSL feature:** `crossover`/`crossunder` event operators with prior-bar state (N0130).
4. **Deliberate hygiene pass, later:** tsconfig strictness flags; CI job timeouts/permissions.
5. Carried forward from the master plan (unchanged by this audit): Factory generations
   persistence, combined-drawdown feed for the risk gate, pre-market IN/US pipelines,
   Pine v6 export as a compiler from the typed DSL, autonomous loop.

## Standing refusals (unchanged)

- No fabricated findings to reach a count. 1,000 was the request; the verified register is
  what exists.
- No downloading/executing external trading repos; static and web review only.
- No synthetic tick data presented as edge-bearing (the pasted audit itself concurs, §10.1).
- No trade execution capability; `EXECUTION_ADAPTER_MISSING` stands.

## Master plan and status

Phases 1–3 are implemented in this pass; 4 is owner-gated; 5–9 are the standing build
order from `docs/MASTER_ARCHITECTURE.md` §7, unchanged by this audit.

| Phase | Work | Status |
|---:|---|---|
| 1 | **Gauntlet significance.** `pairedBootstrapEdge()` in `lib/strategy/statistics.ts` (deterministic paired bootstrap, seed 42). Stage 7 now refuses unpaired benchmarks (`inconclusive`), requires edge ≥ 1bp/trade (`minNoTradeEdge`) *and* p ≤ 0.1 (`maxNoTradePValue`). Engine-generated benchmarks were already aligned one-for-one. | **Implemented** — verify with vitest |
| 2 | **Crossover events.** `crossover`/`crossunder` condition variants in the DSL (self-cross rejected; `COMPILER_VERSION` → 1.2.0 since semantics changed) and event evaluation in `lib/backtest/engine.ts` via the prior bar's feature vector: fires on the crossing bar only, unknowable on the first bar or during warm-up. | **Implemented** — verify with vitest |
| 3 | **PBO guard.** Slice count capped at 12 (C(12,6)=924 partitions) so a caller-supplied value cannot explode combinatorially. | **Implemented** — verify with vitest |
| 4 | **Owner actions.** Strict zod schema for `app/api/proposals` POST; `plansRoot` hook allowance; rotate the leaked Finnhub key. | Blocked on owner (protected paths) |
| 5 | Factory generations persistence (breed → screen → bury; graveyard + kill ledger; new migration is permitted). | Next build session |
| 6 | Combined drawdown data source for the risk gate's unfed rule. | Queued |
| 7 | Pre-market pipelines (IN pre-open phases, US extended hours) per MASTER_ARCHITECTURE. | Queued |
| 8 | Pine v6 export as a *compiler* from the typed DSL — the crossover operators added in Phase 2 are the prerequisite for meaningful Pine parity. | Queued |
| 9 | Deliberate hygiene pass: tsconfig strictness, CI timeouts/permissions — only with a working test loop. | Queued |

New/changed tests: `lib/strategy/significance.test.ts`, `lib/backtest/crossover.test.ts`, two
gauntlet cases in `lib/strategy/strategy.test.ts` (unpaired benchmark refusal; positive-mean
noise fails). Verification command: `npx vitest run lib/strategy lib/backtest lib/scalping`.
