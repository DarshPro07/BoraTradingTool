# Event Bus Wiring — COMPLETE

## Status: VERIFIED_COMPONENT

1606 unit tests pass (+5 new atomicity tests). 19 domains emit typed events.

## Domains Wired

| Domain | Events | File |
|--------|--------|------|
| JOB | JOB_CREATED, JOB_STARTED, JOB_COMPLETED, JOB_FAILED | lib/research/queue.ts |
| AGENT | AGENT_STARTED, AGENT_COMPLETED, AGENT_FAILED | lib/runtime/gateway.ts |
| MODEL | MODEL_SELECTED, MODEL_CALL_COMPLETED, MODEL_CALL_FAILED | lib/runtime/gateway.ts |
| RESEARCH | RESEARCH_STARTED, RESEARCH_COMPLETED, RESEARCH_FAILED | lib/research/bridge.ts |
| EVIDENCE | EVIDENCE_PACKET_BUILT, CITATIONS_VERIFIED | lib/research/bridge.ts |
| FORWARD | FORWARD_SIGNAL_CREATED, FORWARD_SIGNAL_RESOLVED | lib/forward/shadow.ts |
| STRATEGY | STRATEGY_CREATED | lib/factory/generation.ts |
| PAPER | PAPER_ORDER_CREATED, PAPER_ORDER_FILLED | lib/paper/repository.ts |
| HYPOTHESIS | HYPOTHESIS_CREATED | lib/knowledge/repository.ts |
| LEARNING | LEARNING_CYCLE_COMPLETED | lib/learning/cycle.ts |
| VALIDATION | VALIDATION_COMPLETED | lib/strategy/gauntlet.ts |
| HOLDOUT | HOLDOUT_ACCESSED | lib/strategy/selection-ledger.ts |
| ALPHA | ALPHA_HEALTH_UPDATED | lib/quant/alpha-health.ts |
| DATA | DATA_INGESTED | lib/research/ingest.ts |
| SCANNER | SCANNER_COMPLETED | lib/quantcore/signals.ts |
| MEMORY | MEMORY_PROMOTED | lib/learning/memory.ts |
| REPAIR | REPAIR_COMPLETED | lib/learning/self-repair.ts |
| INCIDENT | INCIDENT_CREATED | lib/learning/self-repair.ts |
| BACKTEST | BACKTEST_STARTED, BACKTEST_COMPLETED, BACKTEST_REFUSED | lib/backtest/engine.ts |

## Atomicity Guarantees

- Event bus `publish()` persists to `audit_events` table (durable, survives restart)
- Queue domain mutations wrapped in SQLite transactions WITH events (claimNextJob, completeJob)
- Paper orders: domain mutation in transaction, event emitted after commit with captured metadata
- Event bus swallows errors internally — never breaks the publisher
- Kernel state reconstructed from DB on restart (no in-memory-only state)
