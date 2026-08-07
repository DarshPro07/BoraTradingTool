# MarketPulse OS — Requirements

Source: the full conversation of 2026-08-06, the Threepio reel package
(`analysis/`, `research/`), and `CLAUDE.md`. This is the contract. Anything built that is not
traceable to a requirement here is scope creep; anything here that is not built is a gap.

Status legend: **DONE** · **PARTIAL** · **TODO** · **BLOCKED**

---

## R-1 — Instrument scope (decided, ADR 0005)

**NSE and US cash equities, daily bars.** The reel's system trades MNQ intraday futures; this one
does not, because the engine cannot measure a fill-quality edge and would produce confident
numbers about something it never measured. Both markets simultaneously is rejected — two engines,
two fee models, two session models, half the depth in each.

This is not a claim that equities are more profitable. It is a claim that an equity result from
this system means what it says, and an MNQ result would not.

## R0 — The two workspaces (highest priority)

The product is **two modes**, not twenty-six tabs. Navigating between scattered pages is the
single loudest complaint against the current build.

| Mode | Purpose | Contains |
|---|---|---|
| **RESEARCH** | Runs by itself. Paper trading, learning, evolving, research, strategy creation, validation, simulation, memory. | Command view, pre-market, research/memory graph, strategy studio, simulations, paper desk, learning |
| **EXECUTE** | Human-confirmed. Uses validated strategies, candlestick models and indicators to produce proposals the owner acts on manually. | Proposals, risk, positions, confirmation queue, audit |

Scalping belongs to **both** modes, not to a third one.

- **R0.1** One top-level switch between the two modes. **TODO**
- **R0.2** Each mode has at most five sub-views. **TODO**
- **R0.3** No page reachable only by typing a URL. **TODO**
- **R0.4** Acceptance: a new user reaches any capability in ≤2 clicks from the mode switch.

## R1 — Autonomous, self-evolving, self-developing

The system must do work while the owner is away, and that work must be visible afterwards.

- **R1.1** Idle detection: active / idle (15 min) / deep idle (60 min). **DONE** (`lib/learning/introspection.ts`)
- **R1.2** Learning-mode ladder off → observing → learning → evolving, each strictly more capable. **DONE** (`lib/learning/cycle.ts`)
- **R1.3** Memory self-inspection: orphaned knowledge, repeated failures, stalled strategies. **DONE**
- **R1.4** Strategy rehearsal that costs no trial. **DONE** (`lib/learning/rehearsal.ts`)
- **R1.5** A durable scheduler that runs cycles without a browser tab open. **TODO**
- **R1.6** A visible run log: what the last cycles did, when, and what changed. **TODO**
- **R1.7** Acceptance: leave the app for an hour, return, and see a list of what it did — not a static badge saying "LEARNING".

## R2 — Pre-market analysis, India and USA

- **R2.1** India pre-open modelled as three phases, not one flat window. **DONE** (`lib/market/phases.ts`)
- **R2.2** US early trading / pre-market / auction imbalance / regular / post-close. **DONE**
- **R2.3** Overnight gaps, breadth, next-session countdown. **DONE** (`lib/premarket/report.ts`)
- **R2.4** Every unavailable input named with a reason, never defaulted to zero. **DONE**
- **R2.5** Scheduled pre-market run that produces a report before each open. **TODO**

## R3 — Strategy creation, backtesting, validation

- **R3.1** Typed strategy DSL with a deterministic compiler and point-in-time feature guarantee. **DONE**
- **R3.2** Single-instrument and portfolio backtest engines, kept at parity. **DONE**
- **R3.3** Validation gauntlet with trial accounting, sealed holdout, deflated Sharpe, PBO. **DONE**
- **R3.4** Strategy graveyard with rejection reasons and rediscovery prevention. **DONE**
- **R3.5** Strategy Studio: author, compile, rehearse and inspect a strategy in the UI. **TODO**
- **R3.6** Features the engine cannot derive must be reported at authoring time, not at replay time. **TODO** — *this is why both existing strategies are untestable today*
- **R3.7** Candlestick and indicator panes attached to the strategy being edited. **PARTIAL** (chart exists on `/analyze`, not in a studio)

## R4 — Simulation battery (investment mode)

- **R4.1** Monte Carlo, stationary block bootstrap, walk-forward, sign-flip permutation, cost stress. **DONE**
- **R4.2** Deterministic given a seed; seed sensitivity tested. **DONE**
- **R4.3** Walk-forward slices calendar when timestamps exist, and says which it used. **DONE**
- **R4.4** Simulations run against real strategies, not only fixtures. **PARTIAL** (rehearsal does; the screen does not)

## R5 — Loss memory and adaptation

When the system loses money it must record the loss, attribute it, and change behaviour.

- **R5.1** Every realised loss recorded with instrument, strategy, size and cause. **TODO**
- **R5.2** A loss ledger that aggregates by cause, so repeated causes surface. **TODO**
- **R5.3** Risk posture adjusts automatically as cumulative loss grows (position size, daily stop). **TODO**
- **R5.4** The adaptation is written to memory as a lesson with citations. **TODO**
- **R5.5** Acceptance: after a losing paper day, `/learning` shows what was lost, why, and what changed.

## R6 — Graphical representation

- **R6.1** Memory/provenance graph rendered as a graph, not a list. **DONE** (`components/memory/MemoryMap.tsx`)
- **R6.2** Research papers/sources shown graphically with their downstream claims. **PARTIAL**
- **R6.3** Strategy lineage and family/correlation map. **TODO**
- **R6.4** Simulation results shown as distributions, not only verdicts. **TODO**
- **R6.5** Equity and drawdown curves for paper trading. **TODO**

## R7 — Kronos foundation model

- **R7.1** MIT-licensed, AAAI 2026; runs in the Python quant core, never in this app. **DONE** (ADR 0004)
- **R7.2** Typed reader with refusal on absence; epistemic status stamped by the reader. **DONE**
- **R7.3** Forecast scorer against the persistence baseline with paired bootstrap. **DONE**
- **R7.4** Request manifest with context-window clamping and horizon cap. **DONE**
- **R7.5** Runner specification for the Python side. **DONE** (`docs/KRONOS_RUNNER.md`)
- **R7.6** Forecast-derived features usable in the DSL. **TODO**
- **R7.7** Kronos panel showing delivery status and score. **PARTIAL**

## R8 — Execution boundary (non-negotiable)

- **R8.1** No broker adapter. `/api/trade/place` returns `EXECUTION_ADAPTER_MISSING`. **DONE**
- **R8.2** Every trade requires human confirmation; the agent may propose, never place. **DONE**
- **R8.3** The EXECUTE workspace produces proposals with quantity, entry, stop, target and maximum loss, and stops there. **TODO**
- **R8.4** Risk gate is independent and cannot be modified by an agent. **DONE**

## R9 — Data honesty

- **R9.1** Missing is never rendered as zero. **DONE** (`lib/ui/panel-state.ts`)
- **R9.2** Fourteen panel states distinguished. **DONE**
- **R9.3** Canonical event envelope: correction refs, raw hashes, sequence. **TODO**
- **R9.4** Provider failure costs a row, never the report. **DONE**

## R10 — The UI must feel alive

- **R10.1** Ticker tape motion, price flashes, staggered panel entrance. **DONE**
- **R10.2** Live-updating panels without a manual refresh. **PARTIAL**
- **R10.3** Autonomous activity visible as it happens. **TODO**
- **R10.4** Motion respects `prefers-reduced-motion`. **DONE**

## R11 — Claude as control plane

- **R11.1** MCP server with read tools and local-write tools. **DONE**
- **R11.2** The app never calls Claude with a subscription token. **DONE**
- **R11.3** Work the app cannot do itself is queued for the agent. **DONE**

## R12 — Deferred, explicitly

Recorded so they are not forgotten, and not built now.

- Voice control with command authentication. **TODO**
- Tick-level datasets and a microstructure engine (needs licensed data). **BLOCKED**
- Autonomous paper-order placement (needs an owner-set governance permission). **BLOCKED**
- Automatic strategy generation over a brick registry (multiple-testing hazard). **DEFERRED**

---

## Acceptance for the whole system

The build is complete when, from a cold start:

1. The owner opens the app and sees **two** modes.
2. RESEARCH shows what the system did while they were away, with timestamps.
3. A strategy can be authored, compiled, rehearsed and simulated without leaving the workspace.
4. A losing paper day changes the risk posture and says so.
5. EXECUTE produces a fully specified proposal and refuses to place it.
6. Every panel that cannot see something says so in the state vocabulary.
