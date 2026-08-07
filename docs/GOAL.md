# GOAL — read this first after any interruption

**Owner:** wants a system that earns. **Agent:** Claude Code, autonomous, no subagents.

## The single sentence

Turn MarketPulse from 26 scattered tabs of libraries into **two workspaces** — one that runs
itself (research, paper trading, learning, evolving) and one that produces human-confirmed
execution proposals — where the autonomous half visibly does work while the owner is away.

## Instrument scope — decided 2026-08-07 (ADR 0005)

**NSE and US cash equities on daily bars.** Not MNQ intraday futures, and not both.

The engine decides on close and fills at the next open. It models no spread, queue position,
partial fill or latency — so it cannot measure an intraday futures edge, and running the
validation stack over such a result would apply real statistical rigour to a mismeasured input.
That is worse than no backtest, because it looks like evidence.

`lib/scalping/**` remains as bar-based intraday *research*, labelled as such, and is not a
validation path.

## Non-negotiable constraints

1. **No broker adapter, no order placement.** `/api/trade/place` returns `EXECUTION_ADAPTER_MISSING`.
   EXECUTE produces fully specified proposals and stops.
2. **No subagents.** Direct tools only.
3. **Bash is blocked by the governance hook** regardless of owner permission. Use Read/Write/
   Grep/Glob/Playwright. The owner runs `npx tsc --noEmit`, `npx vitest run`, `npm run check`.
4. **Protected paths** cannot be edited: `lib/governance/**`, `lib/security/**`, `lib/paper/risk|engine|repository`,
   `lib/knowledge/repository.ts`, `lib/quantcore/contract.ts`, `.claude/hooks/**`, `mcp/**`,
   `package.json`, `vitest.config.ts`, `app/api/{owner,learning,proposals,agent,paper/orders}/**`.
5. **Never fabricate data.** Missing is not zero. Every panel uses the 14-state vocabulary.
6. **A rehearsal is not a trial.** The gauntlet consumes holdout budget; the idle loop must not.

## Phase order (do not reorder)

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **0** | Requirements, Architecture, Structure, Wireframes | Four docs exist and agree |
| **A** | Two-workspace navigation | ≤2 clicks to any capability; old routes redirect |
| **B** | Autonomous loop visibly running | Run log with timestamps; cycle button; activity feed |
| **C** | Loss memory + risk adaptation | A losing day changes posture and says so |
| **D** | Strategy Studio | Author → compile → rehearse → simulate in one view |
| **E** | Graphical showcase | Research graph, strategy lineage, simulation distributions, equity curve |
| **F** | Kronos feature path | Forecast features usable in the DSL |

After **every** phase: typecheck, tests, Playwright live check, bug hunt. Then next phase.
Do not stop between phases to ask.

## Where I am

See `docs/BUILD_LOG.md` — appended after every phase. Read it to resume.
