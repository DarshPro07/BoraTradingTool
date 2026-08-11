# MarketPulse — Master Form

Five tasks. Authored 2026-08-11 from the owner's directive, reconciled against what the repository
actually enforces. This supersedes the ordering in WORK_QUEUE.md; WORK_QUEUE keeps the per-item
detail.

**The product contract, in one line:**

> Select a model → open `/brain` → press Start → MarketPulse does the rest.

**Standing rule:** no new backend capability ships until Tasks 1 and 2 are working. A capability is
not implemented if the user must run a CLI, execute a script, inspect SQLite, or know an internal ID.

---

## The one conflict, and how it resolves

The directive says nothing may be switched by hand, including `learning → absorbing → evolving`.
That collides with a rule this repository enforces in code:

- `app/api/learning/route.ts:38` gates every mode change behind `requireOwnerMutationAccess`.
- `lib/governance/policy.ts` lists eleven actions prohibited in **every** mode.
- Both live under protected paths (`lib/governance/**`, `lib/security/**`), enforced by a write
  hook and by tests that fail the build. `MARKETPULSE_AGENT_TOKEN` never grants owner authority.

**Resolution — two different things that were being treated as one:**

| | Learning mode ladder | Operational state machine |
|---|---|---|
| What it is | a **permission ceiling** | **what the system is doing right now** |
| Values | `off · observing · learning · evolving` | `BOOTSTRAP · OBSERVE · LEARN · RESEARCH · VALIDATE · FORWARD · PAPER · MONITOR · EVOLVE · RETIRE` |
| Who moves it | the owner, once, deliberately | the system, continuously, on evidence |
| Frequency | rarely | constantly |

The ladder stays owner-set because it is the boundary on how much autonomy is permitted; a system
that can raise its own ceiling has no ceiling. **Everything else becomes autonomous.** One press of
Start runs the full machine to the limit of whatever mode the owner already chose — and the owner
never touches it again during operation. That satisfies the intent ("press one button, it runs for
hours") without breaching the guardrail.

If the owner wants the ladder itself automated, that is a governance change and needs an explicit
decision — it is not something to do quietly inside a build task.

---

## TASK 1 — Autonomous Master Runtime

Restart → model-selection popup → `/brain` → **one** Start button → the whole machine runs.

Build/verify `RuntimeSupervisor` owning startup order: migrations → database → runtime identity →
security master → market clock → provider health → **parser health** → data readiness → scheduler → UI.

Exposes runtime identity (PID, serverStartTime, buildFingerprint, schemaVersion, database
fingerprint, runtimeMode) so tests can never attach to a stale or foreign server. A port held by a
foreign process is identified and reported, never killed blindly.

Market modes select themselves from the exchange calendar and readiness:
`BOOTSTRAP · PRE_MARKET · MARKET_OPEN · POST_MARKET · OFF_HOURS · RECOVERY · DEGRADED`.

The operational state machine advances on evidence: insufficient data → OBSERVE; clean data →
LEARN; candidate → RESEARCH; compiled → VALIDATE; acceptable → FORWARD; sufficient → PAPER;
decaying → EVOLVE; broken → RETIRE.

**Done when:** restart → choose model → `/brain` → Start → the system runs for hours with no further
routine action, and recovers its state across a restart.

## TASK 2 — UI ↔ Core Integration and Bug Elimination

The highest-priority product problem, and the one the owner hit live.

Produce a **UI Control Inventory** covering every page: for each button, dropdown, toggle, tab,
search box, table row, retry, refresh and navigation link, record
`Page · Control · Action · API · Service · Database · Expected output · Error behaviour · Playwright result`.

Every control must prove the chain
`USER → CONTROL → API → SERVICE → ENGINE → DATABASE/LEDGER → RESULT → UI`.
Anything that renders but does not do this is a bug. Unfinished features are **disabled with a
stated reason**, never left looking live.

Known P0/P1 defects to close, from the owner's own testing:

- buttons that do nothing
- "create a new strategy" shows the previous strategy
- strategy creation/development flow unreliable
- validation requires manual navigation between pages
- data collection does not run on its own
- Playwright does not traverse the product
- research dead-ends on an uningested instrument (see WORK_QUEUE §66 — the refusal is correct, the
  missing part is an in-product ingestion action)

`/brain` becomes the command centre: system, market mode, data health, security-master count,
scanner, candidates, research, strategies, validation, forward, paper, Kronos, learning, evolution,
self-development, and the next action — **every number from a real ledger**, every tile clickable
through to the underlying data. No fake counters, no static cards pretending to be live.

Mobile: `/brain`, `/market`, `/research`, `/strategies`, `/paper`, `/alpha-health`, `/jobs` must be
usable on a phone for monitoring and paper operations. The full build UI need not be.

**Done when:** the inventory has no unproven control, and the listed defects are closed with tests.

## TASK 3 — Autonomous Data, Analysis, Validation and Learning

The system schedules its own work; it never tells the owner to run a script.

Data: universe → market data → canonical store → data quality → dataset snapshot → readiness. A gap
(`SBIN daily READY, 5m PARTIAL → ACCUMULATE_MORE_DATA`) **schedules its own job**.

Analysis: the full NSE universe is reduced deterministically — liquidity, volatility, trend,
momentum, volume, relative volume, sector, breadth, regime — into a small ranked candidate set.
Expensive AI runs only on that set. Funnel counts are stored and shown in `/brain`.

Strategy lifecycle advances on evidence, not on a click:
`CANDIDATE · TESTING · REJECTED · FORWARD · PAPER · DEGRADED · RETIRED`.

Learning accumulates real evidence (snapshots, research, verifications, rejections, strategies,
backtests, failures, forward signals, paper outcomes, TCA, Alpha Health, model errors, data-quality
failures, defects) with full provenance. Locked validation and forward evidence stay locked. No
training on future information. **No deleting adverse data until something looks profitable.**

## TASK 4 — Kronos and Strategy Intelligence

Kronos is a financial time-series model over OHLCV/K-lines — a **feature and forecast source**,
nothing more:

`OHLCV → Kronos → forecast/probability/features → Strategy Engine → validation → backtest → forward → paper`

Kronos never owns fees, P&L, position sizing, Sharpe, risk, the trade ledger, or promotion. Those
stay deterministic MarketPulse code. Track checkpoint, model version, dataset, normalisation, input
window, horizon, loss, seed and metrics.

Strategies may originate from the library, research proposals, scanner findings, papers,
open-source ideas, human ideas, Kronos signals or mutations — and all pass through the *same*
evidence system.

**The objective is stated honestly:** discover strategies with positive risk-adjusted expectancy
after realistic Indian costs, then prove or reject them on forward/paper evidence. No model can be
required to produce profit, and a system built to expect it will manufacture it.

## TASK 5 — Agent CLI ↔ MCP ↔ Website, and Full Verification

One domain, one tool plane, two front doors. **Not** a website implementation and a separate CLI
implementation.

```
UI ──► Agent Gateway ──► Claude/Codex CLI ──┐
                                            ├──► MarketPulse MCP ──► domain services ──► ledger ──► UI
CLI ────────────────────────────────────────┘
```

Tools the agent operates the product through: `market.*`, `scanner.*`, `research.*`, `strategy.*`,
`experiment.*`, `forward.*`, `paper.*`, `kronos.*`, `learning.*`, `system.*`. A run started from the
CLI appears in `/brain` because both wrote to the same ledger. The browser never executes a shell.

Verification is the user's journey, not a screenshot: open `/brain` → Start → services start → job
ledger fills → scanner begins → research → persisted AgentRun → rendered result → strategy → paper →
reload → state persists. Then an independent Chrome DevTools pass over the same journey: console,
network, runtime exceptions, hydration, duplicate requests, 4xx/5xx.

Failure injection must **degrade, not collapse**: provider unavailable, network lost, database
unavailable, bad market data, parser unavailable, quota exhausted, invalid strategy, Kronos
unavailable, no valid strategy.

---

## Order

```
TASK 1 → TASK 2 → TASK 3 → TASK 5 (integration) → TASK 4 (Kronos) → FULL GAUNTLET
```

## Ground truth this form is built on (verified 2026-08-11)

| Fact | Evidence |
|---|---|
| `agent_runs` and `stock_analysis_reports` are **empty** | direct query; no persisted research envelope exists yet |
| History ingestion has **no API route** | `app/api/market/` holds only `instruments` and `quote`; ingest is 2 manual CLI steps |
| Learning mode is **owner-gated** | `app/api/learning/route.ts:38` |
| Dependency-parse attachment is **done and green** | commit `ccc6e8e`; 1544 tests pass, 10/10 real-corpus attachment |
| The `/ai` hydration error was **a stale `.next` bundle**, not a code defect | `UTILITY_LINKS` is a frozen literal with no branching |

Nothing in this form assumes a capability that was not checked against the repository.
