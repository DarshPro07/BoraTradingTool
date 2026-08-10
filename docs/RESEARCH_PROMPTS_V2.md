# Research prompt set v2 — routed, de-duplicated, Kronos-integrated

Your four prompts, upgraded against what this codebase actually contains. Written 2026-08-08.

This document does **not** restate the parts of your prompts that are already correct. It states
the parts that would have failed, why, and the replacement text.

---

## 0. The finding that reorders everything

Your prompts are written as though there is one repository, in Python, that the receiving agent
can write to freely. There are two, in different languages, with different owners, and one hard
boundary between them.

| | `E:\BoraTradingTool` | `E:\Trading_BOT` |
|---|---|---|
| Language | TypeScript / Next.js 16 | Python |
| Owner | Claude Code | OpenCode / GPT-5.6 |
| My write access | full (minus protected paths) | **hook-blocked** |
| Holds | governance kernel, strategy DSL + compiler, 7-stage gauntlet, sealed holdout ledger, promotion ladder, risk gate, trade board, forward record, paper fee model, Kronos reader + scorer | the quant core (not present on this machine yet) |

`lib/governance/paths.ts` enforces this: `TREE_OWNERSHIP` maps `e:/trading_bot` to `opencode`
and `authorizeWrite` returns `FOREIGN_TREE` for any attempt. The two agents coordinate through
`E:\Trading_BOT\runtime\bridge\{claims,requests,responses}`.

**Consequence.** Prompt 1 says *"use Python, pandas, pyarrow, `data/raw/nse/…`"*. Pasted into a
Claude Code session rooted at `BoraTradingTool`, the receiving agent has exactly two outcomes:
it is blocked by the hook, or it builds a Python parquet data layer inside a Next.js
application — which is precisely the *"second data architecture next to a functioning first one"*
your own prompt forbids.

Every prompt below therefore carries a **routing header**, and Prompt 0 must be prepended to all
of them.

### Routing

| Prompt | Goes to | Repo |
|---|---|---|
| 0 — Boundary preamble | every agent | both |
| 1 — Data foundation | OpenCode / GPT-5.6 | `E:\Trading_BOT` |
| 2 — Feature research | OpenCode / GPT-5.6 | `E:\Trading_BOT` |
| 3 — Execution simulation | OpenCode (sim) + Claude (contract) | split, see §3 |
| 4 — Robustness lab | **Claude Code** | `E:\BoraTradingTool` |
| 5 — Kronos PIT archive (new) | OpenCode / GPT-5.6 | `E:\Trading_BOT` |

Prompt 4 flips repos. That is the second big finding — see §4.

---

## 1. What your prompts ask to build that already exists

Your prompts would rebuild, in Python, controls that already exist and are test-enforced in
TypeScript. Verified against the code today:

| Your prompt asks for | Already exists | Where |
|---|---|---|
| Holdout firewall, one query, access logged | `holdout_ledger` table, `HOLDOUT_QUERY_BUDGET = 1`, `requestHoldout()`, append-only at DB level | `lib/strategy/gauntlet.ts`, `lib/strategy/holdout.ts` |
| Immutable trial ledger, every config counts | `trials` table + `recordTrial()`; selection cost derived from `validation_results` | `lib/knowledge/repository.ts` |
| Deflated Sharpe with true trial count | implemented with Euler–Mascheroni expected-max-Sharpe correction | `lib/strategy/statistics.ts` |
| PBO via CSCV | implemented | `lib/strategy/statistics.ts` |
| Walk-forward, cost stress, Monte Carlo, parameter stability, no-trade comparison, causality | 7 gauntlet stages, fixed seeds | `lib/strategy/gauntlet.ts` |
| Promotion states (IDEA → … → RESEARCH_VALIDATED) | `Stage` ladder: draft → rehearsed → validated → holdout_cleared → paper_forward → owner_review → graveyard, **derived from evidence, never stored** | `lib/strategy/lifecycle.ts` |
| Graveyard / rediscovery blocking | `checkRediscovery()`, identity hash excludes compiler version | `lib/strategy/graveyard.ts` |
| Paper-forward record, R-multiples, risk fixed at open | `forward_outcomes`, `MIN_FORWARD_OBSERVATIONS = 20`, re-resolution refused | `lib/strategy/forward.ts` |
| Research ledger with code/dataset/config identity | `validation_results` + `trials` + `audit_events` | — |
| Placebo / permutation | `no_trade_comparison`, `causality` stages | `lib/strategy/gauntlet.ts` |

**So Prompt 4 must not build a validation lab. It must feed the one that exists.** Rewritten in
§4.

---

## 2. What your prompts ask for that is genuinely missing

All of these are real gaps, confirmed by reading the code:

| Gap | Evidence it is missing | Severity |
|---|---|---|
| **PriceDomain** — no concept anywhere | `lib/strategy/dsl.ts` has no domain field; `lib/backtest/engine.ts` computes `(exit − entry)/entry`, a **ratio**. The day a continuous-additive futures series is fed to it, every return is silently wrong. | **Critical** |
| **Futures contract model** | `INSTRUMENT_CATALOG` is a frozen array of cash equities. No expiry, lot size, tick size, OI, contract identity. | Critical |
| **Roll engine + lineage** | nothing | Critical |
| **Point-in-time instrument master** | `INSTRUMENT_CATALOG` is a static literal — today's universe used for all history = survivorship by construction | Critical |
| **`as_of` on every historical read** | no loader takes one | Critical |
| **NSE pre-open call auction states** | `lib/market/calendar.ts` has `IN: { preOpen: 9*60, open: 9*60+15 }` — one `PRE_OPEN` label, no `PREOPEN_ORDER` / `PREOPEN_MATCH` / `PREOPEN_BUFFER` split | High |
| **Expiry from contract metadata** | no contract master exists to read it from | High |
| **NSE EOD / UDiFF reconciliation** | nothing | High |
| **Effective-dated cost schedules** | `lib/paper/fees.ts` names policies `IN_EQUITY_INTRADAY_2026_01` — versioned in the *name* — but `feePolicyFor(market, product)` never takes a date. A 2023 trade gets 2026 rates. **And there is no futures or options schedule at all.** | High |
| **Intrabar ambiguity resolution** | the backtest decides on close and fills at next open, so it dodges the question today; any intrabar stop/target sim must answer it | High |
| **Upstox V3 live feed + staleness states** | nothing | Medium |
| **Corporate actions / ISIN / listing status** | nothing | Medium |

Your instinct on all of these is right. Keep those sections of Prompts 1–3 essentially as
written, with the edits below.

---

## 3. Corrections to your prompts' technical content

### 3.1 The price-domain rule needs one more clause

Your rule is correct and your refinement over the naive "never divide by close" is correct. Add
the case your version misses — **cross-sectional and cross-instrument comparison**:

```
CONTINUOUS_ADDITIVE MAY ALSO NOT BE USED FOR:

- comparing price levels across two different instruments
- comparing price levels across two different roll methodologies
- comparing price levels across two dataset versions with different roll anchors
- any ranking where the sort key is a price level rather than a distance

Two additive series carry two different cumulative adjustments. Their price levels are not on
the same axis, so "NIFTY is above BANKNIFTY" is meaningless in that domain even though both
numbers are finite and plausible. Distances remain comparable; levels do not.
```

This matters for your top-list / relative-strength scanners specifically.

### 3.2 `(price - low) / (high - low)` — your claim is right, state the precondition

You correctly note this is translation-invariant. It is — **provided `low` and `high` come from
the same series as `price`**. Mixing a raw price against an additive-adjusted range gives a
number that looks normalized and is not. Make the wrapper enforce same-domain operands, not just
same-domain outputs.

### 3.3 STT effective dates — confirmed against the code, and wider than you said

Your April 2026 STT point is correct and the code confirms the gap. But the fix is bigger than
adding dates: `lib/paper/fees.ts` has **no futures or options schedule at all**. The prompt
should ask for three instrument-type schedules (cash / futures / options), each effective-dated,
each with the correct side (STT sell-side-only for futures and options, both sides for delivery
equity) and correct basis (premium vs notional for options — getting this wrong is a ~50×
error).

### 3.4 The Hermes / MT5 section is rejected, not deferred

The article you pasted deploys an agent that places live trades on MT5 from TradingView
webhooks. This system's first rule is that it has **no broker adapter**: `/api/trade/place`
returns `EXECUTION_ADAPTER_MISSING`, and that is enforced by hook, by `lib/trading/capabilities.ts`
(a protected path), and by tests that fail the build. `lib/governance/policy.ts` lists
`place_order` as prohibited in **every** learning mode including `evolving`.

Do not paste that prompt at this repo. The parts of it worth keeping already exist without the
execution:

| Hermes idea | Already here |
|---|---|
| reflect every N closed trades | `runLearningCycle` on a 15-min scheduler, `scripts/cycle.mjs` |
| change exactly ONE variable per cycle | `evolution_proposals` — one action id, owner-approved |
| version the strategy, keep prior in `history/` | `strategy_specs.version` + `parentId` + graveyard |
| score against a goal file | `lib/strategy/gauntlet.ts` GATES |
| halt at max drawdown | `RiskRules.maxCombinedDrawdownUsd`, `dailyLossLimitR` |

What Hermes adds beyond that is the order placement. That is the one thing this system refuses.

---

## 4. Prompt 4, rewritten — it goes to the TypeScript repo

Your Prompt 4 builds a validation lab. One exists. Rewritten to feed it:

```text
You are the research-integrity reviewer for MarketPulse OS (E:\BoraTradingTool, TypeScript).

A validation system already exists and is test-enforced. Your job is NOT to build another one.

READ FIRST, DO NOT REBUILD:

  lib/strategy/gauntlet.ts     7 stages, sealed holdout, HOLDOUT_QUERY_BUDGET = 1
  lib/strategy/statistics.ts   deflated Sharpe (Euler-Mascheroni), PBO via CSCV,
                               paired bootstrap, Monte Carlo with fixed seeds
  lib/strategy/lifecycle.ts    the promotion ladder; stage is DERIVED from evidence
  lib/strategy/promotion.ts    evidenceFor() / currentStage() / standings()
  lib/strategy/holdout.ts      sealed_holdout trial verdict + budget
  lib/strategy/forward.ts      forward observations, risk denominator fixed at open
  lib/strategy/graveyard.ts    rediscovery blocking

Your Prompt-4 concepts map onto these as follows. Implement ONLY the unmapped rows.

  MAPPED - do not rebuild:
    trial ledger              -> trials table + recordTrial()
    DSR                       -> statistics.ts
    PBO / CSCV                -> statistics.ts
    walk-forward              -> gauntlet stage
    cost stress               -> gauntlet stage
    placebo / no-trade        -> gauntlet no_trade_comparison + causality
    parameter stability       -> gauntlet parameter_stability
    holdout firewall          -> holdout ledger, one query, append-only
    promotion states          -> Stage ladder
    paper forward             -> forward_outcomes, MIN_FORWARD_OBSERVATIONS = 20

  UNMAPPED - implement these:
    1. COMPONENT ABLATION. Run the same candidate with each feature removed
       (sweep only, MSS only, FVG only, pairwise, full). Record every variant as
       its own trial - ablation is a search and must raise the multiple-testing
       denominator, not hide inside one strategy id.

    2. MATCHED CONTROLS. Same date, instrument, direction, time-of-day and risk
       distance, feature removed. Report the paired difference, not two means.

    3. OUTLIER DEPENDENCE. Recompute after dropping best trade / day / week /
       month and top 1% and 5% of winners. Flag OUTLIER_DEPENDENT.

    4. WINDOW-MINING CONTROL. Every research window tested is a trial. Compare
       any "special" window against adjacent and randomly shifted windows of the
       same duration. Without that comparison, do not claim a time-of-day edge.

    5. REGIME PARTITION. Volatility, volume, trend/range, gap, expiry, roll
       proximity. A regime definition invented after seeing results is itself a
       trial - record it as one.

    6. AMBIGUITY / LATENCY STRESS. Compare WORST_CASE vs BEST_CASE vs
       SKIP_AMBIGUOUS, and 0/1-bar entry delay. If the verdict flips, label
       EXECUTION_FRAGILE or LATENCY_FRAGILE and refuse promotion.

CONSTRAINTS:

  - Do not weaken any gate in gauntlet.ts. Raising a bar is allowed; lowering one
    is a governance change and is owner-only.
  - Do not touch protected paths (lib/governance/**, lib/paper/risk.ts,
    lib/paper/engine.ts, lib/quantcore/contract.ts, lib/db/migrate.ts, mcp/**).
  - migrateDatabase() reads a HARDCODED array in lib/db/migrate.ts, which is
    protected. A migration you add to drizzle/ WILL NOT RUN. Persist through an
    existing table (audit_events, trials) or derive on read.
  - Every new evaluation must record a trial. An evaluation that does not raise
    the denominator is a way of searching for free.
  - "NO EVIDENCE OF EDGE" is a successful outcome. Report it plainly.

Run npx vitest run and npm run build before claiming completion.
```

---

## 5. Prompt 0 — prepend to every prompt

```text
=====================================================================
BOUNDARY PREAMBLE - READ BEFORE ANY OTHER INSTRUCTION
=====================================================================

TWO REPOSITORIES, TWO OWNERS, ONE HARD BOUNDARY.

  E:\BoraTradingTool   TypeScript / Next.js   owned by Claude Code
  E:\Trading_BOT       Python quant core      owned by OpenCode / GPT-5.6

Neither agent writes the other's tree. A pre-edit hook enforces it and returns
FOREIGN_TREE. Coordinate through E:\Trading_BOT\runtime\bridge\:

  claims/     check before touching a shared file; skip rather than block
  requests/   what you need from the other side
  responses/  what was delivered

THIS PROMPT IS ADDRESSED TO: <name the repo>. If you are not the agent that owns
that tree, file a bridge request instead of writing.

THE FROZEN SEAM.

lib/quantcore/contract.ts is Contract v1, shared, FROZEN, additive-only, and a
protected path. It defines exactly six resources:

  health  board  universe  forwardOutcomes  regime  trials

plus QuantErrorCode: QUANT_CORE_UNAVAILABLE, RESOURCE_NOT_PROVIDED,
RESOURCE_STALE, RESOURCE_MALFORMED, CONTRACT_VERSION_MISMATCH, and a
per-resource FRESHNESS_BUDGET_MS.

Anything the Python side produces reaches TypeScript either through one of those
six, or through a separate file reader that mirrors the same discipline (see
lib/forecast/kronos.ts for the pattern: typed refusal on absence, Zod validation
on presence, never a fabricated default). Do not widen the union unilaterally.

THE EXECUTION BOUNDARY.

This system has NO broker adapter and places NO orders. /api/trade/place returns
EXECUTION_ADAPTER_MISSING. lib/governance/policy.ts prohibits place_order in
EVERY learning mode. Research, backtest, replay, paper/forward observation and
manually-placed tickets only. Do not add an execution path, a webhook receiver
that trades, or an MT5/broker bridge. If you find yourself reasoning about HOW to
place a trade, stop.

MISSING IS NOT ZERO.

RESOURCE_NOT_PROVIDED, an empty result and a value of zero are three different
facts. Never render them alike. Never fill a gap with a plausible number.

=====================================================================
```

---

## 6. Prompt 5 — Kronos point-in-time forecast archive (new)

This is the Kronos integration you asked for. The seam already exists; one thing blocks it.

**The blocker, exactly.** `lib/strategy/dsl.ts` accepts `forecast_return_1d` and
`forecast_return_5d` as features, and `UNSUPPORTED_BY_ENGINE` lists them with this reason:

> The quant core produces one file per instrument, holding the current prediction with a single
> `generatedAt`. Reading it at every bar would apply today's forecast to last year's decisions,
> which is lookahead of the purest kind — and unlike a missing feature, it would not fail. It
> would silently produce a spectacular equity curve.

So Kronos is admitted as a **hypothesis source** (ADR 0004) but cannot be backtested. The fix is
one artefact: an archive with one forecast record per bar, each stamped with when it was
actually generated.

```text
=====================================================================
PROMPT 5 - KRONOS POINT-IN-TIME FORECAST ARCHIVE
ADDRESSED TO: OpenCode / GPT-5.6, repo E:\Trading_BOT
=====================================================================

[prepend Prompt 0]

READ FIRST (in E:\BoraTradingTool, read-only for you):

  docs/adr/0004-kronos-forecast-intake.md   the policy
  docs/KRONOS_RUNNER.md                     the current file contract
  lib/forecast/kronos.ts                    the reader
  lib/forecast/score.ts                     persistence-baseline scorer
  lib/forecast/manifest.ts                  the job list you consume

WHAT ALREADY WORKS

  buildForecastManifest() emits the request list.
  You write <QUANT_CORE_ROOT>/data/forecasts/kronos/<instrument>_<tf>.json.
  The reader validates it, stamps epistemicStatus = not_forward_validated
  (you cannot set this - the reader ignores what your file claims), and flags
  contextOverrun when lookbackBars exceeds the checkpoint window.
  The scorer refuses to score any bar at or before generatedAt.

  Do not change any of that. It is correct.

WHAT IS MISSING - BUILD EXACTLY THIS

A point-in-time forecast archive. One record per (instrument, timeframe, bar),
each carrying the generatedAt of the run that actually produced it.

  <QUANT_CORE_ROOT>/data/forecasts/kronos/archive/
      instrument=<id>/timeframe=<tf>/year=<YYYY>/month=<MM>/part-*.parquet

  Columns:
    instrument_id          string
    timeframe              string
    checkpoint             string          Kronos-mini | small | base
    generated_at_utc       timestamp[us, tz=UTC]   when the model RAN
    forecast_for_utc       timestamp[us, tz=UTC]   bar the forecast is ABOUT
    horizon_bars           int32                   forecast_for - generated_at, in bars
    lookback_bars          int32
    context_overrun        bool
    open high low close    double          forecast bar
    volume                 double
    model_version          string          checkpoint + weights hash
    code_commit            string
    dataset_version        string
    config_hash            string

THE ONE RULE THAT MAKES THIS WORTH BUILDING

  generated_at_utc <= forecast_for_utc, ALWAYS, and the archive is APPEND-ONLY.

  A row may never be rewritten after the bar it forecasts has closed. The whole
  point of the archive is that it records what was predicted BEFORE the answer
  existed. A backfill that regenerates history with today's weights produces a
  file that is indistinguishable from a genuine archive and is worthless -
  worse than worthless, because it will backtest beautifully.

  If you must backfill for bootstrap purposes, write it to a SEPARATE tree:

      data/forecasts/kronos/backfill/...

  and set a column `is_backfill = true`. The TypeScript side will refuse to use
  backfilled rows as backtest features. State plainly in your report how many
  rows are genuine and how many are backfill.

CAUSAL GENERATION

  A run at time T may feed the model ONLY bars with close <= T. Write the
  archive row at that moment. Do not batch-generate a year of forecasts in one
  pass using a rolling window over completed history and call it point-in-time -
  that is the same lookahead in a different shape.

  The honest bootstrap is: start the archive now, accept that it accumulates at
  one row per bar per instrument in real time, and say so. Twenty forecast bars
  of genuine archive is worth more than five years of regenerated ones, for the
  same reason twenty forward observations outrank a decade of backtest.

SCORING

  Against the persistence baseline ("tomorrow equals today"), per ADR 0004 §4.
  MAE alone hides the failure mode: on a low-volatility series a model posts an
  excellent MAE while being strictly worse than doing nothing. Report the paired
  bootstrap difference vs persistence, not the absolute error.

  Report RankIC separately and label it. The paper's +93% RankIC is
  historically_observed on the authors' benchmark, not known, and says nothing
  about NSE in 2026.

INDIA SPECIFICS

  - Bars fed to the model must respect the NSE session calendar. A 512-bar
    context that silently spans a holiday or a pre-open auction is not 512 bars
    of trading.
  - For futures, feed RAW_TRADED contract bars, not a continuous series. The
    tokenizer quantises absolute OHLCV; a back-adjusted level is not a price
    that ever traded, and early history under a large cumulative adjustment can
    be negative.
  - Record contract identity and expiry on every archive row for futures.

DELIVERABLES

  1. the archive writer, with the append-only and causality guarantees
  2. a validator that FAILS on generated_at_utc > forecast_for_utc
  3. a validator that FAILS on any rewrite of a row whose bar has closed
  4. genuine-vs-backfill row counts
  5. persistence-baseline scores with paired bootstrap
  6. a bridge response in runtime/bridge/responses/ announcing the archive path
     and schema version

WHAT YOU MUST NOT DO

  - do not change lib/forecast/*.ts (not your tree)
  - do not add a resource to Contract v1 (frozen, protected, owner-reviewed)
  - do not emit an epistemicStatus field
  - do not write an empty bars array - write no file instead
  - do not treat a forecast as a signal. ADR 0004: Kronos is admitted as a
    hypothesis and feature source, and is never admitted as a signal.

=====================================================================
```

**Then, on the TypeScript side** (one small follow-up, mine to do): once the archive exists,
`forecast_return_1d` / `forecast_return_5d` come out of `UNSUPPORTED_BY_ENGINE` and
`lib/backtest/features.ts` reads the archive with `as_of = bar close`. That is a ~40-line change
and it is the entire payoff of Prompt 5.

---

## 7. Edits to keep Prompts 1–3 usable

Keep them as written except:

**Prompt 1**
- add Prompt 0; address it to `E:\Trading_BOT`
- delete the holdout section; replace with: *"The holdout ledger lives in the TypeScript app
  (`holdout_ledger`, budget 1, append-only). Do not build a second one. Emit a
  `holdout_boundary` in every dataset manifest and let the TS side enforce."*
- add the cross-instrument clause from §3.1
- add: *"`INSTRUMENT_CATALOG` in the TS app is a static frozen array of cash equities. It is
  today's universe and is therefore survivorship-contaminated by construction. Your point-in-time
  instrument master replaces it as the authority; file a bridge request for the TS side to
  consume it."*

**Prompt 2**
- add Prompt 0; address it to `E:\Trading_BOT`
- your `LOOKAHEAD_ORACLE` isolation is good — strengthen it to a **build-failing import test**,
  matching how `lib/governance` guards protected paths
- the `CAUSAL_PREFIX_INVARIANCE_TEST` and future-mutation test are the strongest things in your
  whole set. Keep verbatim.

**Prompt 3**
- **split it.** The simulator belongs in Python next to the data. But the *result* must arrive as
  `forwardOutcomes` / `trials` through Contract v1, and promotion is decided by the TS ladder —
  the Python side must not invent its own promotion states.
- add the three-schedule effective-dated cost engine from §3.3
- your `WORST_CASE` intrabar default is correct and is genuinely missing here. Keep verbatim.

---

## 8. Open items

- **`/watch` could not run.** `ffmpeg`, `ffprobe` and `yt-dlp` are all absent and no Whisper key
  is configured, so neither video was transcribed. Nothing in this document comes from them.
  To fix: `winget install Gyan.FFmpeg` and `winget install yt-dlp.yt-dlp`, then re-run.
- **NSE rule citations unverified.** The pre-open auction window, Tuesday expiry convention and
  April 2026 STT rates came from your message. I could not reach nseindia.com from this session
  to confirm them. The prompts are written so the values live in versioned, source-attributed
  config rather than in code — which is the right shape whether or not those specific numbers are
  current, but treat them as unconfirmed until someone checks.
- **Contract v1 has no `forecast` resource.** Prompt 5 routes around it with a separate reader,
  matching `lib/forecast/kronos.ts`. If forecasts should become a first-class resource, that is an
  additive v1 change to a protected file and needs owner review.
