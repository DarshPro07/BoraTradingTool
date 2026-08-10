# Master research prompt — v3, repo-fitted, Kronos-integrated

Supersedes `RESEARCH_PROMPTS_V2.md`. Written 2026-08-08 after transcribing both videos and
re-auditing the repository.

This document is a **delta against your 147-section master prompt**, keyed to your section
numbers. Sections not listed here stand as you wrote them.

---

## 0. Three findings that move the answer since v2

### 0.1 `E:\Trading_BOT` does not exist

```
$ ls -d E:/Trading_BOT
TRADING_BOT ABSENT
```

My v2 routing sent Prompts 1, 2, 3 and 5 to "the OpenCode agent in `E:\Trading_BOT`". **That
repo is not on this machine.** ADR 0004 already recorded it ("`E:\Trading_BOT` is not present, so
`quantCoreRoot()` resolves to a missing directory"), and `lib/quantcore/filesystem.ts` has since
been changed to default to this repo's own `data/quantcore/` instead.

So the two-agent split is currently theoretical, and v2's routing was wrong on the facts.

### 0.2 Build mode removed the write boundary

`MARKETPULSE_BUILD_MODE=1` makes `lib/db/migrate.ts`, `package.json`, `mcp/**`,
`lib/quantcore/contract.ts` and the foreign tree all writable. The migration dead-end that forced
yesterday's trade board to derive-on-read instead of persisting is gone.

**Consequence for routing:** one agent, one repository, with a Python subtree.

```
E:\BoraTradingTool\
  app/  lib/  components/        TypeScript control plane — evidence, governance, gauntlet, UI
  quant/                          ← NEW: the Python quant core lives HERE, not in E:\Trading_BOT
    data/{raw,validated,normalized,continuous,contracts,calendars,manifests,holdout}/
    engine/  features/  research/
  data/quantcore/                 the seam both sides already read and write
```

Set `QUANT_CORE_ROOT=E:/BoraTradingTool/quant`. Contract v1 (`lib/quantcore/contract.ts`) stays
the interface unchanged — six resources, typed refusals, per-resource freshness budgets. This is
not a new architecture; it is the producer for a seam that was built and left empty.

Python is the right language for the parquet layer and is *required* for Kronos (PyTorch). The
TypeScript side keeps what it is already good at and already enforces.

### 0.3 The two videos are methodologically opposite — and that is the most useful thing in them

| | **Video 1** — `KML09tRtHM8`, Brendan | **Video 2** — `GC0e04eTeuw`, Sumedhhkumar |
|---|---|---|
| Method | 25,000 sampled configs from ~258M, 16y 1-min NQ/ES, ~10M trades | one AI agent iterating on MT5 for ~2 hours |
| Trial accounting | every config counted; explicit luck correction | none |
| Holdout | 2 years locked, run **once**, at the end | none |
| Cross-instrument | survivors re-run **cold on ES**, no retuning | none |
| Result reported | **1.7% survived** (420 / 25,000) | "total returns of **101%**, max drawdown **6.2%**" |
| Caveats stated | rising market = ceiling not expectation; paper fills keep every loser and miss winners | none |

Video 2 at [18:10] reports 101% return / 6.2% drawdown from a Donchian-breakout + EMA-regime +
Chandelier-exit strategy, found after roughly two hours of an agent tuning parameters, and
suggests it for prop accounts. Video 1's funnel says **6,190 of 25,000 configs "made money after
costs"** and only 420 survived the full stack.

Video 2's result is one of those 6,190. It is precisely the artefact your own §91
(`ABSURD BACKTEST = BUG FIRST`) and §104 (multiple testing) exist to catch — a search reported as
a discovery. Your master prompt is right and the video it partly came from is the counter-example.

Video 2 is still worth having for one line, at [16:05]: *"in the next video, maybe we will
introduce Kronos also with it."* That is the origin of your Kronos request. Section 8 below does
it properly.

---

## 1. Reuse matrix — your §2, answered

Your §2 demands this before implementation. Here it is, verified against the code today.

### REUSE — built, tested, do not rebuild

| Your section | Exists as | Evidence |
|---|---|---|
| §31–32 holdout firewall | `holdout_ledger`, `HOLDOUT_QUERY_BUDGET = 1`, append-only at DB level, `requestHoldout()` | `lib/strategy/gauntlet.ts`, `lib/strategy/holdout.ts` |
| §85–86 trial ledger | `trials` table, `recordTrial()`; selection cost from `validation_results` | `lib/knowledge/repository.ts` |
| §104 DSR | deflated Sharpe with Euler–Mascheroni expected-max correction | `lib/strategy/statistics.ts:136` |
| §104 PBO / CSCV | implemented | `lib/strategy/statistics.ts:290` |
| §98 walk-forward | gauntlet stage | `lib/strategy/gauntlet.ts` |
| §92 cost stress | gauntlet stage | same |
| §102 placebo | `no_trade_comparison`, `causality` stages | same |
| §101 **component ablation** | **built 2026-08-08** — incremental + leave-one-out, refuses to score under 30 OOS trades, returns `variantsEvaluated` for the trial denominator | `lib/research/ablation.ts` (12 tests) |
| §94/§142 promotion states | `Stage` ladder, **derived from evidence, never stored** | `lib/strategy/lifecycle.ts` |
| §77 event ledger | `forward_outcomes` + `audit_events` | — |
| §122 paper forward | `forward_outcomes`, `MIN_FORWARD_OBSERVATIONS = 20`, re-resolution refused | `lib/strategy/forward.ts` |
| §128 live safety | `/api/trade/place` → `EXECUTION_ADAPTER_MISSING`; `place_order` prohibited in **every** learning mode | `lib/governance/policy.ts` |
| §124 paper broker | trade board: eligible → signal → priced ticket → gate verdict | `lib/execution/board.ts` |
| §139 reproducibility | `dslHash` + `COMPILER_VERSION` folded into strategy identity | `lib/strategy/dsl.ts` |

### UPGRADE — partial, has the shape but not the substance

| Your section | Gap |
|---|---|
| §74 cost engine | `lib/paper/fees.ts` names policies `IN_EQUITY_INTRADAY_2026_01` — versioned in the *name* — but `feePolicyFor(market, product)` **never takes a date**, so a 2023 trade gets 2026 rates. And there is **no futures or options schedule at all**. |
| §20–21 calendar | `lib/market/calendar.ts` has `IN: { preOpen: 9*60, open: 9*60+15 }` — one `PRE_OPEN` label. No `PREOPEN_ORDER`/`MATCH`/`BUFFER` split, no `effective_from`, no source attribution. |
| §99 regime matrix | `classifyRegime()` gives `LOW_VOL`/`NORMAL`/`HIGH_VOL` by volatility percentile — one axis of the many you list. | 
| §38 FeatureStore | `lib/backtest/features.ts` computes features but does not persist them with `known_at`, `feature_version` or `config_hash`. |

### MISSING — build these

§7–11 PriceDomain · §6/§12–16 dual futures series, roll engine, roll ledger, alignment report ·
§17–18 point-in-time contract master · §33 causal loader with `as_of` · §36 NSE reconciliation ·
§37 dataset manifests · §40–49 swing / liquidity / sweep / FVG / displacement / MSS detectors ·
§50 **bias engine** (`classifyRegime` is volatility state, not direction) · §60 blind frequency
diagnostic · §57–58 prefix-invariance and future-mutation tests · §59 visual verification ·
§62–73 execution simulator · §106–117 portfolio and risk · §123 Upstox adapter

### The one that would silently corrupt everything

`lib/backtest/engine.ts` computes `(exit − entry) / entry` — a **ratio**. The day a
`CONTINUOUS_ADDITIVE` series reaches it, every return is wrong and nothing errors. §7–11 is not
housekeeping; it is the highest-priority missing piece.

---

## 2. §0 — replacement preamble (prepend to the master prompt)

```text
=====================================================================
REPOSITORY FACTS — VERIFIED 2026-08-08. DO NOT RE-DERIVE THESE.
=====================================================================

ONE REPOSITORY: E:\BoraTradingTool

  E:\Trading_BOT DOES NOT EXIST on this machine. Any instruction routing work
  there is void. quantCoreRoot() already defaults to this repo's own
  data/quantcore/, and lib/quantcore/generate.ts produces those artifacts
  locally.

TWO LANGUAGES, ONE SEAM:

  app/ lib/ components/   TypeScript. Control plane: governance kernel,
                          strategy DSL + compiler, 7-stage gauntlet, sealed
                          holdout ledger, promotion ladder, risk gate, trade
                          board, forward record, evidence store, UI.

  quant/                  Python. CREATE THIS. Parquet data layer, price
                          domains, roll engine, detectors, execution simulator,
                          Kronos. Set QUANT_CORE_ROOT=E:/BoraTradingTool/quant.

  data/quantcore/         The seam. lib/quantcore/contract.ts is Contract v1:
                          six resources (health, board, universe,
                          forwardOutcomes, regime, trials), typed error codes,
                          per-resource freshness budgets. Additive changes only.

  Anything Python produces reaches TypeScript through one of those six, or
  through a separate reader mirroring the same discipline — see
  lib/forecast/kronos.ts for the pattern: typed refusal on absence, Zod
  validation on presence, never a fabricated default.

DO NOT REBUILD (verified present and tested — 983 tests passing):

  holdout firewall (budget 1, append-only)  lib/strategy/holdout.ts
  trial ledger                              lib/knowledge/repository.ts
  deflated Sharpe, PBO/CSCV, bootstrap      lib/strategy/statistics.ts
  7-stage gauntlet incl. walk-forward       lib/strategy/gauntlet.ts
  component ablation                        lib/research/ablation.ts
  promotion ladder (stage DERIVED)          lib/strategy/lifecycle.ts
  forward record, R fixed at open           lib/strategy/forward.ts
  trade board / proposal path               lib/execution/board.ts
  Kronos reader + persistence scorer        lib/forecast/{kronos,score}.ts

  Building a second one of any of these violates your own §2.

THE EXECUTION BOUNDARY IS A RUNTIME PROPERTY, NOT A HOOK:

  /api/trade/place returns EXECUTION_ADAPTER_MISSING.
  lib/governance/policy.ts prohibits place_order in EVERY learning mode.
  Both are enforced by tests that fail the build.
  Build mode unblocks the EDITOR. It does not unblock the BROKER.

MISSING IS NOT ZERO:

  RESOURCE_NOT_PROVIDED, an empty result, and a value of zero are three
  different facts. Never render them alike.
=====================================================================
```

---

## 3. §11 — one clause your price-safety rule is missing

Your correction of the naive "never divide by price" rule is right. Add the case it omits:

```text
CONTINUOUS_ADDITIVE MAY ALSO NOT BE USED FOR:

  - comparing price LEVELS across two different instruments
  - comparing levels across two roll methodologies
  - comparing levels across two dataset versions with different roll anchors
  - any ranking whose sort key is a price level rather than a distance

Two additive series carry two different cumulative adjustments, so their
levels are not on the same axis. "NIFTY is above BANKNIFTY" is meaningless in
that domain even though both numbers are finite and plausible. Distances stay
comparable; levels do not.

This matters specifically for cross-sectional and top-list scanners, which are
exactly the strategies §80 asks for.
```

And state the precondition your `(price − low) / (high − low)` example assumes: it is
translation-invariant **only when `low`, `high` and `price` come from the same series**. Mixing a
raw price against an additive-adjusted range yields a number that looks normalised and is not.
The `PriceFrame` wrapper must enforce same-domain **operands**, not just same-domain outputs.

---

## 4. §53–54 — the named profiles now have measured outcomes

Video 1 tested your three named profiles **by these names**. Record the results as
preregistered prior expectations, not as assumptions:

```text
PRIOR EVIDENCE (US futures, NQ/ES, 16 years, 1-minute, 25,000 sampled configs).
These are HISTORICALLY OBSERVED on a different market. They are hypotheses for
India, not findings. Preregister them so that reproducing them is corroboration
and contradicting them is a result.

  as_taught_5m   traded, made a little money, DIED at the risk-adjusted bar
  as_taught_1m   reached the final stage, DIED on the cross-instrument cold run
  as_traded      survived every stage — the loose, high-frequency profile

  Overall survival: 420 of 25,000 = 1.7%

INCREMENTAL ABLATION (each rule added, everything else fixed):

  FVG entry alone, all day ................  33
  + liquidity sweep requirement ...........  69   <- the only additive rule
  + displacement filter ................... down
  + restrict to the named hours ........... down again
  + 15-minute bias filter .................  0.16

  Best-performing configurations ran NO bias or a very simple daily one.

TIME-OF-DAY: the three signature hours sat INSIDE the pack when every hour of
the session was tested as a single-window strategy. The most-cited window came
out slightly negative.

WIN RATE: claimed 70–80%. Measured 34–48% for top versions, ~52% for survivors.
Five configurations of 25,000 reached 70%, all by taking quick 1R profits about
twenty times a year.

FREQUENCY: as_taught_5m ~34 trades/yr, as_taught_1m ~133/yr,
as_traded ~1,996/yr.

WHAT THIS IMPLIES FOR THE ORDER OF WORK: build the sweep detector first and
ablate every other component against it. Do not implement six detectors and
test the bundle — that is how one contributing rule and four subtracting ones
produce a single indistinguishable verdict.
```

Two corollaries for the India adaptation:

- Your §54 already says the US windows are hypotheses in India. Strengthen it: **the US windows
  were not special in the US either.** Test India windows against adjacent and shifted controls
  (§55 window-mining control) from the start.
- Your §50 bias engine is the component that measured **0.16**. Do not drop it — but its default
  must be `NONE`, and any bias mode must earn its place through ablation, not by being in the
  canonical diagram.

---

## 5. §60 — keep the blind frequency diagnostic exactly as written

This is the strongest single control in your prompt and it has no equivalent in this repo. Showing
counts, frequencies and gate-reason mixes while withholding PnL, win rate, Sharpe and expectancy is
what stops definition-tuning from becoming performance-tuning. Implement it before any PnL is
computed for a new profile.

One addition: **route its output through the existing trial ledger.** A definition adjusted on
frequency grounds is still a new strategy version and still raises the denominator, even though no
PnL was seen.

---

## 6. §91 — add the video-2 case as a worked example

```text
WORKED EXAMPLE OF A RESULT THAT MUST BE FLAGGED

An agent iterating for ~2 hours on one instrument produced a Donchian-breakout
+ EMA-regime + Chandelier-exit strategy reporting 101% total return with 6.2%
maximum drawdown, and it was suggested for funded accounts.

Independent evidence: in a 25,000-config study of a different strategy family,
6,190 configurations "made money after costs" and only 420 survived trial
correction, cross-instrument testing and a locked holdout.

An unrecorded search that stops when the equity curve looks good does not
produce a survivor. It produces one of the 6,190. Flag TOO_GOOD_TO_TRUST and
run the §91 audit list. In particular ask:

  how many configurations were tried before this one was kept?

If the answer is unknown, the deflated Sharpe cannot be computed and the result
is not evidence.
```

---

## 7. §74 — the cost engine gap is wider than dates

Verified in `lib/paper/fees.ts`: policies are named `IN_EQUITY_INTRADAY_2026_01` but
`feePolicyFor(market, product)` takes no date, and **only cash equity exists**. Requirements:

```text
Three instrument-type schedules, each effective-dated:

  CASH_EQUITY     delivery and intraday
  EQUITY_FUTURES  STT on the SELL side only
  EQUITY_OPTIONS  STT on the SELL side, on PREMIUM not notional

The options basis is the one that produces a ~50x error if wrong. State it in
the schema, not in a comment.

Each record:  effective_from, effective_to, instrument_type, buy_or_sell,
              basis (NOTIONAL | PREMIUM | TURNOVER), rate, source, source_date

Trade timestamp selects the schedule. A 2023 trade must not receive a 2026
regime. Every run records cost_schedule_version.

UNVERIFIED: the April 2026 STT changes (futures sale 0.02% → 0.05%, option sale
0.10% → 0.15%) came from the prompt author, and nseindia.com was not reachable
from this session. Put the numbers in versioned, source-attributed config — the
right shape regardless — and have a human confirm them before any cost-stressed
result is treated as evidence.
```

---

## 8. Kronos — four insertion points, and the one that matters

### 8.1 What exists and what blocks it

Verified today: **29/29 tests pass** across `lib/forecast/`. The reader validates with Zod, stamps
`epistemicStatus: "not_forward_validated"` itself (a producer cannot promote its own standing), and
flags `contextOverrun` when `lookbackBars` exceeds the checkpoint window. `scoreForecast()` drops
every bar at or before `generatedAt` and scores against the **persistence baseline** — with
`directionalAccuracy`, MAE, RMSE and a paired bootstrap at `FORECAST_GATES = { minScoredBars: 30, maxPValue: 0.05 }`.

And: `data/quantcore/` contains `universe.json`, `regime_state.json`, `trial_ledger.jsonl`,
`forward_journal.jsonl` and two board packets — and **no `forecasts/kronos/` directory at all.**
Zero forecast files have ever been written. Kronos is a working adapter with no producer.

`lib/strategy/dsl.ts` accepts `forecast_return_1d` / `forecast_return_5d` but lists them in
`UNSUPPORTED_BY_ENGINE`, because the runner publishes **one current forecast per instrument**.
Reading it at every historical bar applies today's prediction to last year's decisions — and unlike
a missing feature, that does not error. It produces a spectacular equity curve.

### 8.2 The primary integration: Kronos as the bias engine (your §50)

This is the sharpest use and it is directly testable against video 1's finding.

Video 1 measured the 15-minute swing-structure bias at **0.16** — it destroyed the strategy. But it
also ran a **perfect-bias oracle** and found that a *correct* directional bias beats everything.
So the finding is not "bias is useless"; it is "the bias people actually use is worse than none."

That makes bias an open slot with a measured floor, and Kronos is a candidate to fill it:

```text
BIAS_MODE: KRONOS_FORECAST

  direction = sign(forecast_return_1d) from the point-in-time archive,
              as_of = current bar close

  ADMISSION GATE — it may not be used as a bias until it has passed
  scoreForecast() against the persistence baseline on that instrument and
  timeframe, with:

      scoredBars      >= FORECAST_GATES.minScoredBars (30)
      p-value          < FORECAST_GATES.maxPValue (0.05)
      directionalAccuracy materially above the persistence baseline's

  Below that gate the mode returns NEUTRAL and says why. A forecast that cannot
  beat "tomorrow equals today" is not a bias, and MAE alone will not reveal it:
  on a low-volatility series a model posts an excellent MAE while being
  strictly worse than doing nothing.

  ABLATION IS MANDATORY. Run KRONOS_FORECAST against NONE and against
  15M_SWING_STRUCTURE through lib/research/ablation.ts. The measured prior is
  that adding a bias SUBTRACTS. Kronos must beat that prior, on this data, or
  it goes in the graveyard like any other component.
```

This is a real experiment with a preregistered expectation and a real chance of failing. That is
what makes it worth running.

### 8.3 The blocker: the point-in-time forecast archive

```text
=====================================================================
KRONOS POINT-IN-TIME FORECAST ARCHIVE
Build in: E:\BoraTradingTool\quant\
=====================================================================

READ FIRST (TypeScript side, do not modify):
  docs/adr/0004-kronos-forecast-intake.md   the policy
  docs/KRONOS_RUNNER.md                     the current file contract
  lib/forecast/kronos.ts                    the reader
  lib/forecast/score.ts                     persistence-baseline scorer
  lib/forecast/manifest.ts                  the job list you consume

BUILD: one row per (instrument, timeframe, bar), each carrying the
generated_at of the run that actually produced it.

  quant/data/forecasts/kronos/archive/
      instrument=<id>/timeframe=<tf>/year=<YYYY>/month=<MM>/part-*.parquet

  instrument_id, timeframe, checkpoint
  generated_at_utc     timestamp[us, tz=UTC]   when the model RAN
  forecast_for_utc     timestamp[us, tz=UTC]   the bar it is ABOUT
  horizon_bars, lookback_bars, context_overrun
  open, high, low, close, volume
  model_version, code_commit, dataset_version, config_hash
  is_backfill          bool

THE RULE THAT MAKES IT WORTH BUILDING

  generated_at_utc <= forecast_for_utc, ALWAYS.
  The archive is APPEND-ONLY.
  A row may NEVER be rewritten after the bar it forecasts has closed.

  The whole point is that it records what was predicted BEFORE the answer
  existed. A backfill regenerated with today's weights is indistinguishable
  from a genuine archive and is worse than useless, because it backtests
  beautifully.

  Backfill is permitted ONLY with is_backfill = true. The TypeScript side
  refuses backfilled rows as backtest features. Report genuine and backfilled
  row counts separately.

CAUSAL GENERATION

  A run at T may feed the model only bars with close <= T, and writes the
  archive row at that moment. Batch-generating a year with a rolling window
  over completed history is the same lookahead in a different shape.

  The honest bootstrap: start the archive now and accept that it accumulates
  one row per bar per instrument in real time. Twenty forecast bars of genuine
  archive outrank five years of regenerated ones, for the same reason twenty
  forward observations outrank a decade of backtest.

INDIA SPECIFICS

  - A 512-bar context that silently spans a holiday or the pre-open auction is
    not 512 bars of trading. Respect the exchange calendar.
  - For futures, feed RAW_TRADED contract bars, never a continuous series. The
    tokenizer quantises absolute OHLCV; a back-adjusted level is not a price
    that ever traded, and early history under a large cumulative adjustment can
    go negative.
  - Record contract identity and expiry on every futures row.

VALIDATORS THAT MUST FAIL THE BUILD

  test_forecast_generated_before_target     generated_at > forecast_for
  test_forecast_archive_append_only         rewrite of a closed bar
  test_backfill_segregated                  is_backfill row used as a feature
  test_forecast_beats_persistence_gate      bias admitted below the gate

DO NOT

  - modify lib/forecast/*.ts
  - emit an epistemicStatus field (the reader stamps it and ignores yours)
  - write an empty bars array — write no file instead
  - treat a forecast as a signal. ADR 0004: Kronos is admitted as a hypothesis
    and feature source, and is never admitted as a signal.
=====================================================================
```

### 8.4 The other three insertion points

| Where | Use | Constraint |
|---|---|---|
| §38 FeatureStore | `forecast_return_1d/5d` as features once the archive exists | comes out of `UNSUPPORTED_BY_ENGINE`; `known_at = generated_at_utc` |
| §99 regime matrix | forecast **dispersion** as a regime axis alongside `classifyRegime()`'s volatility percentile | a regime label invented after seeing PnL is itself a trial (§99) |
| §81 candidate families | a Kronos-only strategy as one of the 20 candidates | must pass the same gauntlet as a hand-written one — "a pretrained model is a reason to look, never a reason to skip the checks" (ADR 0004 §5) |

### 8.5 The honest framing to keep in the prompt

```text
Kronos reports +93% RankIC over the leading time-series foundation model. That
is a benchmark result on historical data — historically_observed, not known —
and it says nothing about NSE in 2026. RankIC is a cross-sectional rank
correlation; the distance between "ranks better than baseline" and "survives
costs after execution" is exactly where most published edge dies.

Report RankIC separately and labelled. The number that decides admission is the
paired-bootstrap difference against persistence.
```

---

## 9. Conflicts I resolved

| Conflict | Resolution |
|---|---|
| §55 says one trade per window; the researched definition says configurable multi-trade, hard cap 10 | `max_trades_per_window = 1` is the immutable recorded baseline; multi-trade is a separate named profile. Two engines must not disagree. Note that video 1's surviving profile was the high-frequency one (~1,996 trades/yr) — so the cap matters empirically, not just structurally. |
| Prompt says Python/pyarrow; repo is TypeScript | `quant/` subtree inside this repo, joined by the existing Contract v1 seam. Not a second architecture — the producer for a seam already built. |
| v2 routed work to `E:\Trading_BOT` | Void — that repo does not exist. One repo, two languages. |
| Video 2's Hermes/MT5 agent | Rejected. It places live orders; `place_order` is prohibited in every learning mode and enforced by tests. Its useful parts — reflection cadence, one-variable-per-proposal, versioned strategies with history — already exist as the learning cycle plus `evolution_proposals`, minus the execution. |
| "Backadjusted drives all strategy logic" | Not implemented literally. Additive for translation-invariant geometry, ratio/raw for returns, raw contract for fills — per §7–11 as you corrected them. |

---

## 10. Recommended build order

Ordered by "what would silently corrupt results if left undone", not by section number:

1. **§7–11 PriceDomain + typed `PriceFrame`** — `lib/backtest/engine.ts` computes a ratio today
2. **§17–18 point-in-time contract master** — `INSTRUMENT_CATALOG` is a static frozen array of
   cash equities, i.e. today's universe used for all history: survivorship by construction
3. **§33 causal loader with `as_of`** — nothing takes one now
4. **§44 sweep detector**, then ablate everything else against it (video 1's ordering)
5. **§74 three effective-dated cost schedules**
6. **§20–21 NSE calendar with pre-open states and `effective_from`**
7. **Kronos PIT archive** (§8.3) → unblocks the two DSL forecast features
8. §60 blind frequency diagnostic before any PnL on a new profile

---

## 11. Open items

- **NSE rule citations unverified.** Pre-open windows, Tuesday expiry convention and the April 2026
  STT rates came from the prompt author; nseindia.com was not reachable from this session. The
  design puts them in versioned, source-attributed config — correct either way — but treat the
  values as unconfirmed.
- **Contract v1 has no `forecast` resource.** §8.3 routes around it with a separate reader, matching
  `lib/forecast/kronos.ts`. Making forecasts first-class is an additive v1 change and should be a
  deliberate decision, not a side effect.
- **`.gitattributes` regression** in the build-mode hook is fixed in
  `docs/governance/guard-writes.build-mode.mjs` and needs one `Copy-Item` to take effect.
