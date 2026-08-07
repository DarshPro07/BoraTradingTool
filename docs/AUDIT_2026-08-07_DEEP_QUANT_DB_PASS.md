# MarketPulse OS — Deep Quant Pass & Database Ground-Truth Annex

**Date:** 2026-08-07
**Repo:** `E:\BoraTradingTool` @ `39d9b4af`
**Mode:** Read-only. No source edited. No live trading invoked. No profitability claimed.
**Method:** (a) line-level read of the quant stack (`lib/backtest/*`, `lib/strategy/*`, `lib/trading/fence.ts`, `lib/paper/engine.ts`, `lib/risk/gate.ts`); (b) **read-only SQLite queries** against `marketpulse.db` using Node v24.12.0 built-in `node:sqlite` (`DatabaseSync('marketpulse.db',{readOnly:true})`) — the first live DB verification of this repo (the comprehensive audit explicitly did not query the DB).

Evidence labels: REPRODUCED (DB row), STATICALLY CONFIRMED (code), OBSERVED (trace), INFERRED, UNKNOWN.

---

## Part 1 — Database ground truth (REPRODUCED)

### 1.1 The decisive root cause: zero market data ever persisted

| Table | Rows |
|---|---|
| `price_candles` | **0** |
| `quote_snapshots` | **0** |
| `stock_analysis_reports` | 0 |
| `market_briefings` | 0 |
| `news_articles` | 0 |
| `ai_runs` | 0 |
| `research_jobs` / `research_job_events` | 0 / 0 |
| `instruments` | **1** (only `US:XNAS:AAPL`) |

**Finding D-1 (REPRODUCED):** The backtest/gauntlet pipeline has never had a single bar or quote to run on. The five draft strategies are not merely *unvalidated* — they are *unrunnable in the UI*, because no candles/quotes have ever been persisted. "0 trials" is fully explained at the data layer: there is nothing to rehearse on. This upgrades the comprehensive audit's F-1-adjacent observation ("never validated") from INFERRED to REPRODUCED with a concrete mechanism.

### 1.2 Watchlist vs instrument index mismatch

- `user_watchlist`: 9 tickers (NVDA, MSFT, META, AMD, PLTR, CRM, AAPL, GOOGL, TCS).
- `instruments`: 1 row — AAPL only.

**Finding D-2 (REPRODUCED):** 8 of 9 watchlist entries have **no instrument row**. `/analyze/<ticker>` navigation for NVDA/MSFT/… cannot resolve a parsed instrument for those symbols. This corroborates at the data layer the gap audit's dead-link finding (BUG-2) and the "parseInstrument rejects bare symbols" behavior.

### 1.3 Paper trading ledger (REPRODUCED)

- `paper_orders`: **28** rows — 5 FILLED, 23 REJECTED.
  - 13 rejected `INELIGIBLE_QUOTE` (quote sources are `yahoo:chart:AAPL:<ts>` — stale/off-session quotes; consistent with the paper engine's STALE/session-REGULAR rules).
  - 10 rejected `PAPER_DAILY_ORDER_CAP` (matches `agent_config` daily cap 5; also RiskGate `maxTradesPerDay: 1` under its own rules).
  - 5 FILLED with `reason: US_EQUITY_2026_01` and `simulated_fixture` — the fixture-driven fills of 5×1 AAPL @ 311.6858.
- `paper_ledger`: 10 rows (5 BUY fills + 5 CASH debits).
- `paper_positions`: 1 open (5 AAPL); `paper_accounts`: 2 (cash $98,441.57 after $1,558.43 cost — consistent with a $100k start).
- All 28 orders reference `instrument_id = US:XNAS:AAPL` — the paper loop has exercised exactly one instrument, in three batches (ids 1–3, 4–18, 19–28; the 19-order count in the earlier gap audit matches ids 1–19 as of that snapshot — consistent, not contradictory).
- Legacy `orders` = 0, `robinhood_portfolio` = 0 — legacy broker surface is inert.

**Finding D-3 (REPRODUCED):** The paper loop works and enforces its own rules (stale-quote refusal, daily cap). The only reason paper activity is tiny is data absence — no quotes → no eligible executions.

### 1.4 Governance & learning loop has actually run (REPRODUCED)

- `audit_events`: 102 rows. Dominant patterns:
  - `learning_cycle` allowed: 72+ (actors `test-writer` 35, `http-*` 37) — the learning loop runs on test/http traffic.
  - `learning_cycle` skipped: 10.
  - `owner set_learning_mode` allowed: 6.
  - `autonomous_worker improve_dashboard_page`: 2 allowed + 2 **denied `MODE_INSUFFICIENT`** — the improvement loop proposed real changes and governance correctly refused in insufficient mode.
  - `autonomous_worker proposal_tests_passed` 2, `proposal_tests_pending` 2, `write_test` 2; owner `proposal_reviewed/approved/merged/rejected` 1 each.
- `evolution_proposals`: 2 — 1 merged, 1 rejected (matches the owner audit rows).
- `failure_memory`: 4 lessons recorded.
- `knowledge_lessons`: populated (concept_id/plane/level/title/body/citations schema confirmed).
- `research_hypotheses`: 3, all "proposed", none promoted.
- `knowledge_sources`: 10, all archived.
- `watchlist_suggestions`: 0.

**Finding D-4 (REPRODUCED):** The autonomous loop is not decorative — it has proposed changes, written tests, and been correctly denied by the mode gate. The system's "governance kernel" is demonstrably live. This meaningfully rebuts any "pure filler" reading of the autonomy strip.

### 1.5 Execution posture (REPRODUCED)

- `agent_config`: `mode=off`, `halt=1`, `broker=real`, daily cap 5, watchlist-only.
- Combined with `/api/trade/place` → 503 `EXECUTION_ADAPTER_MISSING` (STATICALLY CONFIRMED) and `lib/trading/fence.ts` refusing every mode ("Live trading mode X is retired"; `mode==="off"` → refuse; `executionAvailable` reserved for a future adapter) — **blast radius for live trading is zero.** Re-confirmed at three layers: DB config, API, fence.

---

## Part 2 — Quant stack deep pass (STATICALLY CONFIRMED)

### 2.1 Backtest engine (`lib/backtest/engine.ts`)

- Deterministic bar-close decision engine: signal at close of bar *i* → fill at open of bar *i+1* (documented; no intrabar lookahead).
- Refuse-not-guess: `FEATURE_NOT_AVAILABLE`, `INSUFFICIENT_BARS`, `UNORDERED_BARS` are explicit refusals, never zero-fills.
- Exit precedence: stop-loss checked before take-profit on the same bar (conservative); `afterDays` is a **bar count** (equivalent for daily bars; a semantic nuance if intraday data is ever fed).
- `noTradeReturns` = flat zeros — an honest, if minimal, benchmark (no underperformance penalty for opportunity cost).
- Round-trip cost applied at close; cost-stress in the gauntlet applies *additional* cost — no double counting.

### 2.2 Feature layer (`lib/backtest/features.ts`)

- 23 features: 19 derivable from OHLCV; 4 named unavailable (`sector_relative_strength`, `earnings_surprise_pct`, `days_since_earnings`, `market_cap`); 11 lookahead forms rejected at compile (e.g. `future_return`, `next_close`, `final_pnl`).
- Warmup handling explicit (undefined during warmup, never fabricated).

### 2.3 Gauntlet (`lib/strategy/gauntlet.ts`)

- 7 stages: replay → walk-forward → parameter stability → causality → cost stress → Monte Carlo → no-trade, each with pass criteria.
- Sealed holdout budget (`HOLDOUT_QUERY_BUDGET = 1`) and selection-cost accounting — multiple-testing control is real, not decorative.
- `countSelectionTrials`/`trialCount` derives from `validation_results` rows — consistent with 0 trials = 0 validation rows (REPRODUCED).

### 2.4 Statistics (`lib/strategy/statistics.ts`)

- Deflated Sharpe with selection-cost-aware expected-max-Sharpe (Euler–Mascheroni correction), PBO via CSCV, paired-bootstrap edge, Monte Carlo with fixed seeds (reproducible), profit factor. Formulas match the Bailey–López de Prado lineage.

### 2.5 Risk gate (`lib/risk/gate.ts`) — VERIFIED, not vaporware

The research annex/knowledge base claimed "the risk gate in lib/risk/gate.ts caps pairwise correlation between the book and a proposal." **Confirmed on disk:**
- 9 rules, all evaluated wholesale so a verdict records every check (kill switch, max contracts, trades/day, simultaneous positions, daily loss R, trading window, news blackout, combined drawdown, pairwise correlation).
- Fail-closed: unknown input = block, never a pass ("an unknown is a block, never an allowance").
- Correlation trusted only with ≥ `minCommonDays` (20); too few common days is a block, not a pass.
- `now` injected → verdicts replayable; unit tests present (`gate.test.ts`).

**Finding D-5:** the knowledge-layer claim about the risk gate is substantiated by code. Caveat: no data feeds the correlation rule today (no quote history), so the rule blocks until data exists — which is exactly its intended fail-closed behavior.

---

## Part 3 — Deeper root-cause investigation (this pass, STATICALLY CONFIRMED + OBSERVED)

### 3.1 `price_candles` / `quote_snapshots` are vestigial schema — not an ingest gap

Repo-wide search for `priceCandles` / `quoteSnapshots` / `price_candles` / `quote_snapshots` finds **only the table definitions** (`lib/db/schema.ts:13,28`). No code in `lib/`, `app/`, `components/`, or `scripts/` **reads or writes** them. Market data is **purely in-memory**:
- `lib/providers/index.ts` — single-flight TTL cache (quotes 30s, candles 60s).
- `lib/data/cache.ts` — in-memory LRU; nothing persisted.
- `lib/market/service.ts:132` — `getNormalizedCandles` calls `getYahooCandles` **live per request**; `getNormalizedQuote` likewise.

**Revised Finding D-1:** "0 persisted candles" is **by design**, not an ingestion failure. The DB is an evidence/ledger store, not a market-data store. Prior framing ("fetch and store candles to unblock the funnel") is **withdrawn as unnecessary** — the pipeline works live.

### 3.2 The gauntlet fetches candles LIVE from Yahoo — and the route itself caused the 500

- `app/api/strategy/gauntlet/route.ts` calls `marketCandleLoader()(spec.id, parsed.data)` → `lib/learning/dataset.ts::fetchMarket` → `getNormalizedCandles` per instrument (12-instrument sample per market) → live Yahoo. If all fail, returns `{}` → the route returns **503 NO_DATA** (not 500).
- The route comment (added when the route was created) states: *"This route did not exist. `runGauntlet` was fully implemented, thoroughly tested, and callable only from the test suite — so the most consequential action in the system had no path from the application to it."*
- **However:** `git ls-files app/api/strategy/` → **empty**. The gauntlet route is an **untracked working-tree file** — added after the single initial commit (`39d9b4a`, 2026-06-19). The only repository commit predates it.
- The strategies page (`app/strategies/page.tsx`) and StrategyAuthor expose **no "run gauntlet" affordance** — the endpoint is unreachable from the UI by design (confirmation-gated POST).

### 3.3 The intermittent 500 has a concrete endpoint

- `.playwright-mcp/console-2026-08-07T03-45-33-062Z.log` records, during the same window the audit saw full-page 500s:
  ```
  [118388ms] 500 (Internal Server Error) @ http://localhost:3000/api/strategy/gauntlet
  [118819ms] 500 (Internal Server Error) @ http://localhost:3000/strategies
  [138543ms] 500 (Internal Server Error) @ http://localhost:3000/api/strategy/gauntlet
  ```
- The dev server was actively recompiling (multiple "Fast Refresh rebuild" log lines immediately prior), consistent with a **newly-added (untracked) route + module being compiled under a corrupted `node_modules`** — a candidate mechanism for the intermittent 500 the audit observed in 2/6 page snapshots.

**Finding D-6 (OBSERVED + STATICALLY CONFIRMED):** the intermittent 500 is observed firing on `/api/strategy/gauntlet` and `/strategies`. The gauntlet route was added as an untracked file after the sole commit, and a dev server compiling that route under a broken dependency tree is a credible mechanism for the flaky 500. It is **not** proven from source alone (needs reproduction with server logs); but it narrows prior hypothesis (corrupted install) to something like it: freshly-added route/DSL compile during a corrupted-install dev session.

### 3.4 Why the funnel shows zero even though the route exists

- The route POST requires `confirm: true`, a `specId`, a live Yahoo response, and a parsed DSL. No UI call path exists (`components/strategy/*` never fetches `/api/strategy/gauntlet`; `app/strategies/page.tsx` is display-only; server startup / cycle scripts don't POST to it).
- The learning cycle only runs `rehearsal` (live candles, no write) — it never POSTs to the gauntlet route by design ("must not run on a timer").

**Revised Finding D-1 (final):** zero trials is explained by **three independent structural facts**:
1. No UI/autonomy path calls the gauntlet route (post-commit, untracked, display-only lab).
2. The only commit (`39d9b4a`, 2026-06-19) predates the route, which is uncommitted/untracked.
3. Even when called, live Yahoo candles are required; wholesale Yahoo failure → 503 NO_DATA and the market is put in a 10-min cooldown.

## Part 4 — Corrective synthesis

1. **The "persist market data" plan is withdrawn.** The system is live-fetch by design; `price_candles`/`quote_snapshots` are unused schema. The unblock is **human-in-the-loop execution, not data engineering**.
2. The single highest-leverage unblock: **wire a "Run gauntlet" owner-visible affordance** (arma the untracked route, commit it, surface a button on the Strategy Lab) and call the route once per draft strategy using confirmation — first real `validation_results` row.
3. **Diagnose the intermittent 500 on `/api/strategy/gauntlet` + `/strategies`** — reproduce with dev-server logs / a clean `npm ci`; resume-at the gauntlet route compile path.
4. **Commit decision needed:** the gauntlet route is untracked; either commit it or remove it. (owner decision, not performed.)
5. Watchlist ↔ instruments mismatch: add the missing 8 catalog entries (`lib/market/catalog.ts` already covers them) if the DB table is intended as the navigation source (see Part 1 D-2 note).
6. `afterDays` = bar-count semantics: doc-only change.

## Quality gates

- Evidence review: COMPLETE (every row cited above read directly from the DB; every code claim from the file).
- Repository modified: **NO** (this file is the only artifact).
- Live trading invoked: NO. Profitability claimed: NO.
- Conflicting findings resolved: gap-audit "19 orders" vs DB 28 — reconciled as three batches over time (ids 1–19 then 19–28), not a contradiction.
