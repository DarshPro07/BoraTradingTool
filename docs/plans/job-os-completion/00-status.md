# Job OS Completion (rungs 1–2) — Status

**Owner directive 2026-08-14:** continue the next rungs. In order: structured warm-up refusals →
durable-kind ladder (forward_resolve, paper_reconcile, incident_repair) → Agents/Teams as job
workers → 1–5 model routing. Rungs 1–2 complete the Job OS; Agents/Teams (rung 3) is a large
architectural leg that follows once the Job OS is solid.

| # | Slice | Status |
|---|---|---|
| 1 | Structured warm-up refusals (barsHeld/barsNeeded) | ✅ DONE — `warmupBarsFor` + pinned map, `SignalSweep.warmups` |
| 2 | Durable-kind ladder — only kinds with real handlers | ✅ DONE — paper_reconcile + incident_repair wired to existing handlers; 4 kind tests |
| 3 | Verify + docs + assess Agents/Teams scope | ✅ DONE — verifier PASS 0 blockers (10 claims); its inert warm-up finding closed (timeGated split). 148 files / 1752 passed / 0 failed, tsc 0. Rung 3 scoped in 07-final.md |

## Rung 1, delivered

- `lib/backtest/features.ts`: `FEATURE_WARMUP_BARS` (each feature's warm-up window, e.g. sma200→200,
  rsi14→15, gap_pct→2) + `warmupBarsFor(required)` (the max over a strategy's required features).
- `features.warmup.test.ts` PINS the map against the real panel: each feature is undefined one bar
  before its declared warm-up and defined exactly at it — so the map can never drift from the
  computation. 14 assertions.
- `lib/quantcore/signals.ts`: `SignalSweep` gains a structured `warmups: WarmupRefusal[]`
  ({instrumentId, specName, barsHeld, barsNeeded}) beside the human strings, and the warm-up
  refusal string now carries the counts ("… (50/200 bars)"). This turns warm-up from an opaque
  sentence into a COUNTABLE DATA condition the dependency resolver can act on (ingest more history)
  with a knowable resume — the owner's two-concept point (TIME session-gating stays with the market
  clock; DATA bar-count is now explicit).

Suite after rung 1: quantcore/execution/learning 269 passed / 0 failed; full suite pending rung 2.

## Rung 2 principle (unchanged)

A kind lands ONLY with a real deterministic handler. The explore agent is mapping forward_resolve /
paper_reconcile / incident_repair; any that needs a model, the network for prices, or that could
modify code/governance is NOT added as an autonomous durable kind — documented instead.

## Rung 2, delivered

Handlers mapped (explore agent), all confirmed deterministic + idempotent + network-free:
- **paper_reconcile** → `runPaperPass()` (lib/forward/paper.ts): fills accepted orders at the next
  bar, closes decided positions, updates cash/outcomes. Bar-time only, terminal order states.
- **incident_repair** → `runSelfRepair()` (lib/learning/self-repair.ts): fixes only
  provably-understated declared costs vs the published fee schedule, reports (never fixes) capital
  drift, audits before/after, never touches code or governance. Already runs each cycle; the kind
  just makes it schedulable/chainable.
- **NOT added: `forward_resolve`.** Forecast grading is already the `forecast_resolve` kind (store-
  only, added earlier). True forward-SIGNAL resolution is `runForwardDriver`, which needs a
  network-capable bar loader — so it is not a clean store-only deterministic kind and stays in the
  cycle until a store-only variant exists. Documented rather than force-fit.

Neither new kind is auto-enqueued — they are available durable kinds (schedulable/dependency-
chainable), consistent with the no-decorative-entries rule (each has a real handler).

## Rung 3 (Agents/Teams) — scoped, NOT started this leg

The foundation exists from M5: `lib/runtime/gateway.ts` (`runAgent({capability})` + provider
detection), `lib/runtime/agent-runs.ts` (the AgentRun ledger), `lib/runtime/adapter.ts` (adapters),
`lib/runtime/model-catalog.ts`. There is no `lib/agents/` or `lib/teams/` yet. Rung 3 = making the
durable Job OS invoke agents through the gateway (an agent-family job kind whose handler routes
semantic work via `runAgent`, records an AgentRun, feeds the result back), then team coordination
(the Chief-of-Staff pattern the WORK_QUEUE already specifies), with 1–5 model routing (rung 4)
above. This is a large architectural leg with extensive existing owner direction — it deserves its
own focused build once the owner confirms the direction, rather than being half-started here.

## Exact next action

Await verification; write final verdict; present rung 3 to the owner.
