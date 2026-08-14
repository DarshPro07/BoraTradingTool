# MarketPulse OS v7 — Architecture Plan

## Current State (Verified)

### What Exists
- **Research Bridge** (`lib/research/bridge.ts`): Evidence packet → LLM → source verification → envelope. Works.
- **Semantic Compiler** (`lib/research/semantic-compiler.ts`): Natural language → Strategy DSL. Needs spaCy.
- **Hypothesis Author** (`lib/research/hypothesis-author.ts`): Hypothesis → Strategy DSL. Needs spaCy.
- **Backtest Engine** (`lib/backtest/engine.ts`, `lib/backtest/portfolio.ts`): DSL + data → trades. Works.
- **Gauntlet** (`lib/strategy/gauntlet.ts`): Statistical validation. Works but `run_gauntlet` not in AUTONOMOUS_PERMITTED.
- **Auto-Gauntlet** (`lib/strategy/auto-gauntlet.ts`): Selective trial spending. Policy-gated.
- **Canonical Store** (`lib/market/candle-store.ts`): Has data for HDFCBANK, RELIANCE, TCS (610 bars each).
- **Agent Gateway** (`lib/runtime/gateway.ts`): Claude Code adapter works. Others NOT_DETECTED.

### Where the Chain Breaks

1. **Data**: Only 3 NSE instruments have data (HDFCBANK, RELIANCE, TCS). Need more + proper ingestion.
2. **spaCy**: Semantic compiler needs Python parser. May not be available.
3. **Autonomous Gauntlet**: `run_gauntlet` not in AUTONOMOUS_PERMITTED → autonomous trials blocked.
4. **No Golden Journey**: No single API/UI path that chains research → strategy → backtest → result.
5. **Memory**: No validated lesson system (only raw failure memory).

## Target Architecture

```
START MARKETPULSE
    ↓
NSE UNIVERSE (security master)
    ↓
DATA READINESS (per-instrument)
    ↓
    ├─ READY → SCAN → CANDIDATES
    │              ↓
    │         RESEARCH (LLM + evidence)
    │              ↓
    │         HYPOTHESIS (verified sources)
    │              ↓
    │         STRATEGY DSL (semantic compiler)
    │              ↓
    │         REARSAL (free, no trial)
    │              ↓
    │         GAUNTLET (statistical validation)
    │              ↓
    │         FORWARD ENROLLMENT
    │              ↓
    │         PAPER (if eligible)
    │              ↓
    │         ALPHA HEALTH
    │
    └─ NOT READY → DATA JOB → INGEST → QUALITY → READY
```

## Task Breakdown

### #1: NSE Research → Strategy → Backtest Chain
- Create `/api/research/instrument` route that calls `researchInstrument`
- Create `/api/strategy/from-hypothesis` route that calls `authorFromHypotheses`
- Create `/api/backtest/run` route that calls `runPortfolioBacktest`
- Wire them in the learning cycle as an autonomous flow
- Fix `run_gauntlet` policy to allow autonomous trials (with guards)

### #2: Core Purpose Hardening
- Fix spaCy fallback (deterministic parser when Python unavailable)
- Fix data ingestion for NSE instruments
- Fix the rehearsal → gauntlet handoff
- Add proper error handling at each stage

### #3: Pluggable Multi-Model Provider System
- ProviderRegistry with 8+ providers
- ModelCatalog per provider
- CapabilityRouter for task-based selection
- AIJob recording (provider, model, cost, tokens)

### #4: NSE Data Connectors
- DataConnector interface
- Jugaad-data connector (GitHub repo)
- Yahoo research connector
- Canonical store normalization
- Dataset snapshots

### #5: Validated Long-Term Memory
- Episodic memory (what happened)
- Semantic memory (what evidence shows)
- Procedural memory (what to change)
- Lesson validation pipeline
- Integration with failure memory
