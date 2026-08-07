# Structure — module map

Where everything lives and what may depend on what. Implements `docs/ARCHITECTURE.md`.

## Dependency rule

```
app/  ──▶  components/  ──▶  lib/
                                ▲
              lib modules may depend downward only:
              ui → strategy/simulation → backtest → market/providers → db
```

`lib/` must never import from `app/` or `components/`. A pure module with no React import can be
tested in vitest; a module that reaches into a page cannot.

## Tree

```
app/
  research/                    RESEARCH workspace (Phase A)
    page.tsx                     Command — activity feed, what needs me
    premarket/page.tsx           India + USA session phases, gaps
    studio/page.tsx              author → compile → rehearse → simulate
    memory/page.tsx              provenance graph, orphans, graveyard
    paper/page.tsx               equity, positions, loss ledger, posture
  execute/                     EXECUTE workspace (Phase A)
    page.tsx                     proposals with risk-gate decision
  analyze/[ticker]/page.tsx    instrument detail (chart, technicals)
  api/
    learning/cycle/route.ts      POST — one autonomous iteration
    premarket/route.ts           GET — phases + unavailable inputs
    simulation/route.ts          POST — run the battery
    introspection/route.ts       GET — idle state + memory findings
    candles/route.ts             GET — OHLCV for the chart
    ...

components/
  system/     Panel, StatTile, PanelState (14-state badge + body)
  memory/     MemoryMap (layered SVG provenance graph)
  chart/      CandlestickChart (lightweight-charts + SMA overlays)
  layout/     TopNav, TickerTape, autonomy strip

lib/
  ui/            panel-state.ts        the 14 states, severity, error mapping
  nav.ts                               two workspaces (Phase A)
  market/        phases.ts             fine-grained IN/US session phases
                 calendar.ts           coarse session + timezone parts
                 catalog.ts            instrument master (40 instruments)
                 service.ts            normalized quotes/candles + provenance
  premarket/     report.ts             gaps, breadth, refusals per market
  providers/     yahoo, finnhub, empty, index (caching + fallback)
  backtest/      engine.ts             single instrument, decide-close/fill-open
                 portfolio.ts          multi-instrument, position cap binds
                 features.ts           point-in-time feature panel
  strategy/      dsl.ts                typed IR + deterministic compiler
                 gauntlet.ts           validation stages, trial accounting
                 graveyard.ts          rejection reasons + rediscovery block
                 statistics.ts         Sharpe, deflated Sharpe, PBO, bootstrap
  simulation/    battery.ts            5 independent attacks
  learning/      cycle.ts              the mode ladder, one iteration
                 introspection.ts      idle detection + memory findings
                 rehearsal.ts          costs no trial
                 dataset.ts            production candle loader (memoised)
  knowledge/     memory-graph.ts       whole-graph projection
                 graph-layout.ts       pure layered layout (no DOM)
                 repository.ts         PROTECTED — evidence writes
  forecast/      kronos.ts             typed reader, refusal on absence
                 score.ts              vs persistence baseline
                 manifest.ts           job list + context clamp
  paper/         engine, risk, repository, fees   PROTECTED
  risk/          gate.ts               ALLOW_FOR_CONFIRMATION | BLOCK | DEFER
  governance/    policy.ts, runtime.ts, paths.ts  PROTECTED
  quantcore/     contract.ts (FROZEN), client.ts, filesystem.ts
  db/            schema.ts (41 tables), index.ts, migrate.ts (PROTECTED)

docs/
  GOAL.md              read first after any interruption
  REQUIREMENTS.md      the contract, R0–R12
  ARCHITECTURE.md      planes, loops, diagrams
  STRUCTURE.md         this file
  WIREFRAMES.md        two workspaces, view by view
  BUILD_LOG.md         appended after every phase
  VALIDATION_RUNBOOK.md how to prove it works
  PHASES_REMAINING.md  scored against the reel's 12 capabilities
  KRONOS_RUNNER.md     spec for the Python side
  adr/                 0001–0004 decisions
```

## Protected paths — cannot be edited by the agent

Enforced by `.claude/hooks` and by `lib/governance/paths.ts`:

`lib/governance/**` · `lib/security/**` · `lib/paper/{risk,engine,repository}.ts` ·
`lib/knowledge/repository.ts` · `lib/quantcore/contract.ts` · `lib/trading/capabilities.ts` ·
`lib/learning/evolution.ts` · `lib/db/migrate.ts` · `lib/analyst/{schema,service}.ts` ·
`lib/ai/evidence*.ts` · `mcp/**` · `dist/mcp/**` · `.mcp.json` · `.claude/**` ·
`.github/workflows/**` · `package.json` · `vitest.config.ts` · `playwright.config.ts` ·
`app/api/{owner,learning,proposals,agent,paper/orders}/**` · `.env*` · applied `drizzle/` migrations.

Adding a new migration is allowed; editing an applied one is not.

## Test layout

`vitest.config.ts` includes `lib/**/*.test.ts`, `app/**/*.test.ts`, `mcp/**/*.test.ts`.

**Components and pages are not covered by vitest** — they are checked by `npx tsc --noEmit` and
`npm run build`, and validated live with Playwright. Green tests alone never mean the screens work.

Current: 51 files, 664 tests.
