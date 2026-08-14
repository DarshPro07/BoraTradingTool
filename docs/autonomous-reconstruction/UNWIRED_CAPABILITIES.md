# Unwired Capabilities Inventory

This document maps code that EXISTS but is not yet wired into the Brain operational hub.

## Classification System

| Status | Meaning |
|--------|---------|
| BRAIN_WIRED | Connected to Brain via Capability Registry + Event Bus |
| UI_WIRED | Connected to a page/route |
| JOB_WIRED | Executed by the job system |
| API_WIRED | Exposed via API route |
| AGENT_WIRED | Can be invoked by an agent |
| TEST_ONLY | Only exercised by tests |
| ORPHAN | No caller found |
| DUPLICATE | Multiple implementations |
| LEGACY | Old architecture, retain for compatibility |

## Inventory

### Fully Wired (Brain + UI + API + Jobs)

| Module | File | Status | Notes |
|--------|------|--------|-------|
| Supervisor/Scheduler | `lib/runtime/supervisor.ts` | BRAIN_WIRED | Emits events on tick/start/stop |
| Job Queue | `lib/research/queue.ts` | BRAIN_WIRED + JOB_WIRED | Full lifecycle working |
| Job Worker | `lib/research/worker.ts` | JOB_WIRED | Drained by learning cycle |
| System Readiness | `lib/product/readiness.ts` | BRAIN_WIRED + UI_WIRED | Shown on /brain |
| Research Pipeline | `lib/research/bridge.ts` | UI_WIRED + API_WIRED | Working via /analyze |
| Strategy DSL | `lib/strategy/dsl.ts` | UI_WIRED | Strategy author page |
| Backtest Engine | `lib/backtest/engine.ts` | UI_WIRED | Via strategy gauntlet |
| Paper Engine | `lib/paper/service.ts` | UI_WIRED + API_WIRED | /paper page + API |
| Alpha Health | `lib/quant/alpha-health.ts` | BRAIN_WIRED | Shown on /brain |
| Event Bus | `lib/brain/event-bus.ts` | BRAIN_WIRED | New — central nervous system |
| Brain Kernel | `lib/brain/kernel.ts` | BRAIN_WIRED | New — capability registry |
| Capability Registry | `lib/brain/capability-registry.ts` | BRAIN_WIRED | New — system capabilities |

### Partially Wired (exists but not Brain-connected)

| Module | File | Current Status | What's Missing |
|--------|------|----------------|----------------|
| Agent Gateway | `lib/runtime/gateway.ts` | API_WIRED | Should emit AGENT events |
| Model Catalog | `lib/runtime/model-catalog.ts` | TEST_ONLY | Should feed Brain provider view |
| Provider Adapters | `lib/runtime/adapter.ts` | API_WIRED | Should emit MODEL events |
| Forward Testing | `lib/forward/shadow.ts` | JOB_WIRED | Should emit FORWARD events |
| Strategy Factory | `lib/factory/generation.ts` | JOB_WIRED | Should emit STRATEGY events |
| Self Repair | `lib/learning/self-repair.ts` | JOB_WIRED | Should emit REPAIR events |
| Memory System | `lib/learning/memory.ts` | JOB_WIRED | Should emit MEMORY events |
| Knowledge Graph | `lib/knowledge/memory-graph.ts` | ORPHAN | Should feed Brain knowledge view |
| NSE Security Master | `lib/market/security-master.ts` | API_WIRED | Should emit DATA events |
| Data Ingestion | `lib/market/candle-store.ts` | JOB_WIRED | Should emit DATA_INGESTED events |
| Quant Core Bridge | `lib/quantcore/client.ts` | API_WIRED | Should emit SCANNER events |
| Learning Metrics | `lib/learning/metrics.ts` | JOB_WIRED | Should feed Brain progress view |

### Orphaned / Unused (valuable, should be wired)

| Module | File | Value | Recommendation |
|--------|------|-------|----------------|
| Execution Board | `lib/execution/board.ts` | Trade board building | Wire to event bus |
| Portfolio Analysis | `lib/portfolio/correlation.ts` | Portfolio analytics | Wire to Brain capabilities |
| Forecast Engine | `lib/forecast/live.ts` | Kronos forecasting | Wire to scanner lane |
| StatArb | `lib/quant/statarb.ts` | Statistical arbitrage | Wire to strategy factory |
| Scenario Engine | `lib/quant/scime.ts` | Monte Carlo scenarios | Wire to validation |
| Meeting Pipeline | (not in repo) | Teams meeting summaries | Out of scope for now |
| Trading Engine | `lib/trading/capabilities.ts` | Trading capabilities | Paper-only, already wired |

### Legacy (retain for compatibility)

| Module | File | Notes |
|--------|------|-------|
| Robinhood Adapter | `lib/trading/robinhood-adapter.ts` | Disabled, no broker |
| Agent Config | `lib/legacy/agent-config.ts` | Historical |
| Legacy Orders | `lib/legacy/orders.ts` | Audit only |

## Wiring Plan

### Phase 1: Event Bus Integration (DONE)
- [x] Create Event Bus
- [x] Wire supervisor events
- [x] Create Brain Kernel
- [x] Create Capability Registry

### Phase 2: Emit Events from All Subsystems (NEXT)
- [ ] Agent Gateway: emit AGENT_STARTED, AGENT_COMPLETED, AGENT_FAILED
- [ ] Job Queue: emit JOB_CREATED, JOB_COMPLETED, JOB_FAILED
- [ ] Provider system: emit MODEL_SELECTED, MODEL_CALL_*
- [ ] Strategy Factory: emit STRATEGY_CREATED
- [ ] Backtest: emit BACKTEST_STARTED, BACKTEST_COMPLETED
- [ ] Paper: emit PAPER_ORDER_*
- [ ] Forward: emit FORWARD_SIGNAL_*
- [ ] Research: emit RESEARCH_*, EVIDENCE_*, CITATIONS_*
- [ ] Data: emit DATA_INGESTED, DATA_QUALITY_ALERT
- [ ] Scanner: emit SCANNER_COMPLETED
- [ ] Memory: emit MEMORY_PROMOTED
- [ ] Repair: emit INCIDENT_CREATED, REPAIR_COMPLETED

### Phase 3: Brain UI Enhancement
- [ ] Interactive system graph (clickable nodes)
- [ ] Lane state transitions visible
- [ ] Provider health dashboard
- [ ] Capability health matrix
- [ ] Event stream viewer

### Phase 4: Provider System Completion
- [x] Anthropic API adapter
- [ ] OpenAI API adapter (dynamic model discovery)
- [ ] Ollama adapter (dynamic model listing)
- [ ] DeepSeek/OpenRouter compatible adapter
- [ ] Claude Code MCP adapter (via `claude mcp serve`)
- [ ] Multi-model routing proof
