# MarketPulse OS — Architecture

Implements `docs/REQUIREMENTS.md`. Diagrams are Mermaid so they render in the repo and in any
artifact view.

---

## 1. The two workspaces

```mermaid
flowchart TB
    SW{{Workspace switch}}

    subgraph RESEARCH["RESEARCH — runs itself"]
        R1[Command<br/>what it did while you were away]
        R2[Pre-market<br/>India + USA phases, gaps]
        R3[Studio<br/>author, compile, rehearse, simulate]
        R4[Memory<br/>provenance graph, lessons, graveyard]
        R5[Paper<br/>positions, equity, loss ledger]
    end

    subgraph EXECUTE["EXECUTE — human confirms"]
        E1[Proposals<br/>qty, entry, stop, target, max loss]
        E2[Risk<br/>gate decision + policy version]
        E3[Confirm<br/>owner acts manually, outside the app]
    end

    SW --> RESEARCH
    SW --> EXECUTE
    RESEARCH -.validated strategy.-> EXECUTE
    EXECUTE -.realised outcome.-> RESEARCH
```

Scalping is a **mode of both**, not a third workspace: in RESEARCH it is a strategy family under
test; in EXECUTE it is a proposal with a tighter time budget.

---

## 2. Planes

| Plane | Owns | Key modules |
|---|---|---|
| **Control** | Claude via MCP; learning mode ladder; governance | `mcp/server.ts`, `lib/governance/**` |
| **Evidence/Data** | Quotes, candles, provenance, freshness | `lib/market/**`, `lib/providers/**`, `lib/ui/panel-state.ts` |
| **Research** | Sources, claims, hypotheses, memory graph | `lib/knowledge/**` |
| **Simulation** | Backtest engines, gauntlet, battery | `lib/backtest/**`, `lib/strategy/**`, `lib/simulation/**` |
| **Portfolio/Risk** | Paper accounting, risk gate, loss memory | `lib/paper/**`, `lib/risk/**` |
| **Confirmation** | Proposals; refuses to execute | `lib/execution/**` |

---

## 3. The autonomous loop

This is the part the owner says is invisible. It must produce a **durable, timestamped record**.

```mermaid
sequenceDiagram
    participant T as Tick (scheduler)
    participant C as runLearningCycle
    participant G as Governance
    participant M as Memory
    participant R as Rehearsal
    participant L as Run log

    T->>C: fire
    C->>G: mode? (off/observing/learning/evolving)
    G-->>C: permitted actions
    C->>M: inspectMemory()
    M-->>C: orphans, repeated failures, stalled
    alt mode >= learning
        C->>R: rehearse candidates (records NO trial)
        R-->>C: would_pass / would_fail / not_evaluable / rediscovered
    end
    C->>L: append run record
    L-->>T: visible in Command activity feed
```

**Why a rehearsal and not the gauntlet:** `runGauntlet` consumes the sealed holdout budget and
every trial permanently raises that strategy's statistical bar. An idle loop running it on a
timer would destroy the only unbiased estimate the system has, unprompted and irreversibly.

---

## 4. Validation pipeline

```mermaid
flowchart LR
    A[Source<br/>paper/repo/video] --> B[Claim<br/>epistemic status]
    B --> C[Hypothesis<br/>falsifiable]
    C --> D[Strategy DSL<br/>compiled, point-in-time]
    D --> E[Backtest<br/>single + portfolio parity]
    E --> F[Simulation battery<br/>5 independent attacks]
    F --> G{Survives?}
    G -- no --> H[Graveyard<br/>reason + rediscovery block]
    G -- yes --> I[Gauntlet<br/>costs a trial]
    I --> J{Passes?}
    J -- no --> H
    J -- yes --> K[Paper challenger<br/>forward evidence]
    K --> L[EXECUTE proposal<br/>human confirms]
```

| Stage | Guard | Module |
|---|---|---|
| Compile | Lookahead features rejected | `lib/strategy/dsl.ts` |
| Backtest | Decide-on-close, fill-next-open; engines kept at parity | `lib/backtest/` |
| Battery | Monte Carlo · block bootstrap · walk-forward · permutation · cost stress | `lib/simulation/battery.ts` |
| Graveyard | Compiler-independent identity blocks rediscovery | `lib/strategy/graveyard.ts` |
| Gauntlet | Deflated Sharpe, PBO, sealed holdout, family trial count | `lib/strategy/gauntlet.ts` |
| Risk | Independent, agent-immutable | `lib/paper/risk.ts` |

---

## 5. Simulation battery — what each attack catches

| Simulation | Null it tests | Catches |
|---|---|---|
| Monte Carlo | Trade order is irrelevant | Results resting on one sequence |
| Stationary block bootstrap | Serial dependence preserved | Clustered losses IID resampling destroys |
| Walk-forward | Edge is spread over time | One lucky stretch carrying a flat record |
| Sign-flip permutation | Outcomes are symmetric noise | Means reachable by luck |
| Cost stress | Costs were modelled optimistically | Edge thinner than the cost assumption |

Deterministic given a seed. A verdict that moves between runs cannot be evidence, because the
next run is a new trial.

---

## 6. Kronos integration

```mermaid
flowchart LR
    subgraph PY["Python quant core (not this repo)"]
        K1[Kronos-mini<br/>4.1M · ctx 2048]
        K2[Tokenizer<br/>OHLCV to discrete tokens]
        K1 --- K2
    end

    M[manifest.ts<br/>jobs + context clamp] -->|data/forecasts/kronos| PY
    PY -->|instrument_timeframe.json| RD[kronos.ts<br/>typed reader]
    RD --> ST[epistemicStatus<br/>not_forward_validated]
    ST --> SC[score.ts<br/>vs persistence baseline]
    SC --> V{Beats<br/>persistence?}
    V -- no --> STOP[Stop. The paper's<br/>RankIC is not your edge]
    V -- yes --> FEAT[DSL features] --> GAUNTLET[Gauntlet like any strategy]
```

**Design rules.** The model never runs in this app — it is PyTorch and there is no model runtime
here by design. `lookbackBars` is clamped to the checkpoint's context window *at request time*,
because a 512-context model handed 2000 bars silently reads the last 512 and produces a forecast
that looks like four years of history and used ten months. `epistemicStatus` is stamped by the
reader, never read from the file, so a producer cannot promote its own standing.

---

## 7. Loss memory and adaptation

```mermaid
flowchart TB
    P[Paper fill] --> O{Closed at a loss?}
    O -- no --> N[Record outcome]
    O -- yes --> L1[Loss record<br/>instrument, strategy, size, cause]
    L1 --> L2[Loss ledger<br/>aggregate by cause]
    L2 --> L3{Cause repeated<br/>>= 3 times?}
    L3 -- yes --> L4[Lesson with citations]
    L2 --> L5[Risk posture<br/>size and daily stop tighten<br/>as cumulative loss grows]
    L4 --> M[Memory graph]
    L5 --> RG[Risk gate inputs]
```

The adaptation is **deterministic and bounded**, not a model deciding to trade differently. The
owner's ceilings remain owner-set; adaptation may only tighten, never loosen.

---

## 8. Data honesty — the 14 states

Every panel resolves to exactly one. The pairs that matter render identically in a naive UI and
mean opposite things:

| Pair | Difference |
|---|---|
| `empty` / `unavailable` | Looked and found nothing / could not look |
| `unavailable` / `unsupported` | Not configured here / cannot exist here |
| `unauthorized` / `unavailable` | You lack entitlement / nobody has it |
| `stale` / `delayed` | Should have updated / late by design |
| `invalid` / `compute_error` | Bad input / our code failed on good input |

`worstState([])` is `empty`, never `current`: zero sources is not a healthy panel.

---

## 9. Execution boundary

```mermaid
flowchart LR
    S[Validated strategy] --> P[Proposal<br/>qty · entry · stop · target · max loss]
    P --> RG[Risk gate]
    RG --> D{Decision}
    D -->|BLOCK| X[Refused with reason]
    D -->|DEFER| W[Wait for condition]
    D -->|ALLOW_FOR_CONFIRMATION| C[Owner confirms]
    C --> H[Owner places it manually<br/>outside this software]
    P -.-> API["/api/trade/place<br/>EXECUTION_ADAPTER_MISSING"]
```

There is no path from an agent to a broker. This is enforced by governance policy, by a
repo-wide test asserting no broker mutation call exists, and by the absence of an adapter.
