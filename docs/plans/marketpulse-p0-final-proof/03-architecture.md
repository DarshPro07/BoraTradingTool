# Gate 2 — Architecture

## Current architecture

### Runtime (engine lane)
- `lib/runtime/supervisor.ts` — autonomous supervisor. `startAutonomousRun()` creates a run
  (idempotent via unique index). `stopAutonomousRun()` stops. `recoverInterruptedRun()` resumes a
  CRASHED run as DEGRADED on boot. `tick()` (line 478) is non-reentrant (`state.ticking` guard, line
  481): runs ONE awaited `runLearningCycle` per tick, `TICK_MS = 60_000`.
- `lib/learning/cycle.ts` — `runLearningCycle` (line 101) wraps `runCycleBody` (line 285) in
  `withCycleLease`. `runCycleBody` is ONE sequential async body: evidence → quant-core → quiz → study
  queue → paper check → intraday → self-repair → introspection → promotion → produce → forecast →
  `runWorker` → hypothesis → rehearsal → gauntlet → shadow → board → generation.
- `lib/learning/lease.ts` — `withCycleLease` uses `fs.openSync(file, "wx")`, a file-based mutex
  serializing ALL three drivers (scheduler, daemon, browser tab). `LEASE_TTL_MS = 10 * 60_000`.
- `lib/runtime/supervisor.ts:392` `recoverInterruptedRun` — CRASHED → DEGRADED, resumes same run id,
  reconciles stale runs via `reconcileStaleRuns` (line 154), `liveRun` (line 198).

### Research pipeline
- `lib/research/bridge.ts` — evidence packet (canonical store bars + features) → sha256 fingerprint
  → model → `verifyProposalSources()` → `ResearchProposalEnvelope` (SOURCE_VERIFIED / CONFLICTED /
  INSUFFICIENT_EVIDENCE).
- `lib/research/hypothesis-author.ts` — semantic compiler (`Condition` → DSL).
- `app/api/research/hypotheses/route.ts` — POST → hypothesis triage (EXPRESSIBLE /
  NOT_A_TRADING_RULE / NEEDS_FEATURE / STATEMENT_INVALID).

### Strategy pipeline
- `app/api/strategy/author/route.ts` — POST → 201 CREATED or 409 NAME_ALREADY_EXISTS.
- `app/api/strategy/gauntlet/route.ts` — POST → 428 (confirm) / 412 RESEARCH_IDENTITY_MISSING /
  503 / 422.
- `app/api/strategy/trades/route.ts` — POST → backtest trades or 422 (NO_DATA / DSL_INVALID).

### Forward / Paper / Quant
- `app/api/forward/run/route.ts` — POST → `runShadowPass` + `runPaperPass`, returns
  `{ ...shadow, paper, mode: "LIVE"|"REPLAY", evaluatedAsOf }`.
- `app/api/paper/orders/route.ts` — POST → order lifecycle (FILLED / REJECTED / EXPIRED).
- `app/api/paper/portfolio/route.ts` — GET → accounts, positions, orders.
- `app/api/quant/analytics/route.ts` — POST specId → `analyzeReturns` over experiment trades, or
  412 NO_EXPERIMENT.

### Brain
- `lib/brain/kernel.ts` — 13 lane states, `initializeBrain`, `getBrainState`, `updateLanesFromEvent`.
- `lib/brain/event-bus.ts` — typed events persisted to `auditEvents`, in-memory subscribers.
- `lib/brain/capability-registry.ts` — `registerCoreCapabilities`, `updateCapabilityHealth`.
- `app/api/brain/route.ts` — GET → full BrainState.

### Golden Journey (partial)
- `app/api/golden-journey/route.ts` — currently 3 steps: research → author strategy → backtest.

## Where the Golden Journey fits

The 15-step Golden Journey is a **sequential pipeline verifier** — an e2e spec that exercises each
step through its real HTTP surface and asserts the chain holds together. It is NOT a new runtime
component; it is a test harness that proves the existing components connect correctly.

The expanded `app/api/golden-journey/route.ts` becomes a programmatic one-shot endpoint that chains
all 15 steps, mirroring the e2e spec. It is used for CLI verification and manual demonstration.

## Data flow (15 steps)

```
[1 NSE Identity] GET /api/system/identity
  ↓
[2 Data Snapshot] GET /api/research-data/bars?ticker=... (canonical store only; NO_DATA with remedy)
  ↓
[3 Research] POST /api/research/stock (bridge → provider → envelope; may refuse INSUFFICIENT_EVIDENCE)
  ↓
[4 Evidence] (from research response — fingerprint + verificationStatus)
  ↕
[5 Hypothesis] POST /api/research/hypotheses (triage → EXPRESSIBLE)
  ↓
[6 Strategy IR] POST /api/strategy/author (→ 201 specId)
  ↓
[7 Backtest] POST /api/strategy/trades?specId= (→ experimentId + trades)
  ↓
[8 Trades] (from backtest response — trade ledger)
  ↓
[9 Selection Trial] POST /api/strategy/gauntlet {specId} (→ 428 confirm)
  ↓
[10 Validation] POST /api/strategy/gauntlet {specId, confirm:true} (→ 412/503/422 honest refusal)
  ↓
[11 Holdout] (from validation — budget untouched assertion)
  ↓
[12 Forward] POST /api/forward/run (→ shadow + paper pass, LIVE/REPLAY + evaluatedAsOf)
  ↓
[13 Paper] POST /api/paper/orders + GET /api/paper/portfolio (→ FILL or honest REFUSE)
  ↓
[14 Alpha Health] POST /api/quant/analytics {specId} (→ analytics or 412 NO_EXPERIMENT)
  ↓
[15 Memory] GET /api/memory/trace?nodeId=... + GET /api/brain (→ knowledge trace + brain state)
```

## Key interfaces

- **ResearchProposalEnvelope**: `{ ok, events, envelope: { proposal, evidenceFingerprint, verificationStatus } }`
- **StrategySpec**: `{ id, name, dsl, createdBy, stage, createdAt }`
- **Experiment**: `{ id, specId, snapshotId, kind, summary, trades, createdAt }`
- **GauntletResponse**: `{ status: 428 | 412 | 503 | 422, message, error? }`
- **ShadowResult**: `{ signals, mode, evaluatedAsOf }`
- **PaperPortfolio**: `{ accounts: [...], positions: [...], orders: [...] }`
- **BrainState**: `{ mode, runtimeRunning, autonomousRun, lanes, providers, capabilities, ... }`

## Honest limitations

- **Research step (3)**: On a fresh DB with no live provider (`QUANT_CORE_URL=off`),
  `/api/research/stock` returns INSUFFICIENT_EVIDENCE. The Golden Journey spec seeds a canned
  hypothesis through `/api/research/hypotheses` to continue the chain. This is documented as an
  honest substitution, not a fake.
- **Gauntlet step (10)**: On a fresh DB with no research identity (RESEARCH_IDENTITY_MISSING) or no
  data (503), the gauntlet refuses honestly. The spec asserts the refusal with the named reason.
- **Paper step (13)**: Uses TEST_FIXTURE quote (RELIANCE ₹2,985.50), no credentials. Requires
  watchlist + position cap checks.
- **Concurrency**: The machine is sequential by design. The Golden Journey tests sequential
  correctness, not parallelism.
