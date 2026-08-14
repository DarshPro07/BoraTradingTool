# MarketPulse Autonomous Reconstruction — Status

## Mission
Transform the existing MarketPulse codebase into a coherent, genuinely operational, India-first quantitative research operating system with:
- One Brain Kernel as central operational hub
- Real concurrent AUTO mode (Observe + Learn + Evolve simultaneously)
- Real provider system (not just Claude Code)
- Full route wiring and verification
- 30-stock acceptance testing
- Golden Journey Playwright proof
- Crash recovery

## Current Verdict: PARTIALLY_VERIFIED

## Phase Status

| Phase | Status | Evidence |
|-------|--------|----------|
| P0-A: Full repository map | ✅ COMPLETE | 200+ files inventoried across all domains |
| P0-B: Wiring Matrix | 🔄 IN_PROGRESS | Brain is a view; no event bus; no capability graph |
| P0-C: Brain Kernel | ⏳ PENDING | Currently just a DB-reading page |
| P0-D: Capability Graph | ⏳ PENDING | Does not exist |
| P0-E: Event Bus | ⏳ PENDING | Does not exist |
| P0-F: Jobs integration | ✅ EXISTS | Full lifecycle working |
| P0-G: Agents integration | ⚠️ PARTIAL | Only Claude Code works |
| P0-H: Provider system | ⚠️ PARTIAL | 1/8 providers have adapters |
| P0-I: AUTO concurrent mode | ⏳ PENDING | Mode always returns "evolving" |
| P0-J: Full page coverage | ⏳ PENDING | 28 routes, only ~4 tested |
| P0-K: 30-stock Playwright | ⏳ PENDING | Only RELIANCE tested |
| P0-L: Multi-stock Golden Journey | ⏳ PENDING | No full chain test |
| P0-M: Paper lifecycle | ⚠️ PARTIAL | Engine exists, not verified end-to-end |
| P0-N: Crash recovery | ✅ EXISTS | Supervisor has recovery logic |
| P0-O: Independent final verification | ⏳ PENDING | |

## Critical Findings

1. **Brain is a view, not a system** — `/brain` reads DB directly, no kernel
2. **No event bus** — all inter-system communication goes through SQLite tables
3. **No capability graph** — no registry of what the system can do
4. **Provider system incomplete** — 7/8 declared providers have no adapters
5. **Mode system always returns "evolving"** — `getLearningMode()` hardcoded
6. **Owner token already removed** — `requireOwnerMutationAccess` delegates to local boundary
7. **Supervisor/scheduler is solid** — 60s ticker, crash recovery, leases all working
8. **Learning cycle is comprehensive** — covers quant core through trade board
9. **Job system is the most complete** — full lifecycle with dependencies
10. **Only ~4 of 28 routes have been tested**

## Next Actions
1. Build Event Bus (typed events, subscribers, persistence)
2. Build Brain Kernel (capability registry, state graph, wiring)
3. Implement AUTO concurrent mode (lanes instead of mode switching)
4. Build real provider adapters (Anthropic API, OpenAI API, Ollama)
5. Create route coverage Playwright suite
6. Create 30-stock matrix Playwright suite
7. Create Golden Journey Playwright suite
