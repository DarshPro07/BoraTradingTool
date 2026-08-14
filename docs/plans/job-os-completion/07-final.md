# Final — Job OS Completion (rungs 1–2)

**Verdict: VERIFIED.** Independent verifier: **PASS, high confidence, 0 blockers** (10 claims
CONFIRMED + hunt items). Its one inert finding (session-gated warm-up default) was closed.

## Delivered

### Rung 1 — structured warm-up refusals
- `lib/backtest/features.ts`: `FEATURE_WARMUP_BARS` (per-feature warm-up windows) + `warmupBarsFor`.
- `features.warmup.test.ts` pins every value against the real `buildFeaturePanel` (undefined at
  warmup-1, defined at warmup) — the verifier confirmed it is a genuine pinning test, not circular.
- `lib/quantcore/signals.ts`: `SignalSweep.warmups: WarmupRefusal[]` with the owner's TWO-CONCEPT
  split — `{barsHeld, barsNeeded, timeGated}`. `timeGated=false` is a DATA shortage (ingest more
  history; countable gap); `timeGated=true` is a TIME gate (enough bars, but a session-gated
  opening-range window has not closed — the market clock resolves it, not more bars). No fabricated
  bar count for a session gate.

### Rung 2 — durable-kind ladder
- `paper_reconcile` → `runPaperPass()`: bar-time-only paper reconciliation (fills/closes/cash),
  no network, terminal-state idempotent.
- `incident_repair` → `runSelfRepair()`: fixes only provably-understated declared costs vs the
  published schedule, reports (never fixes) capital drift, audits before/after, never touches code
  or governance. Byte-identical logic to what the cycle already runs — the kind just makes it
  schedulable/chainable.
- `forward_resolve` deliberately NOT added: forecast grading is already `forecast_resolve`
  (store-only); forward-signal resolution needs a network bar loader, so no clean store-only kind.
- Neither new kind is auto-enqueued (verifier confirmed zero enqueue sites outside tests).

## Evidence

`npx tsc --noEmit` → 0 · `npm run test:verified` → **148 files / 1752 passed / 0 failed /
2 skipped** (baseline 1734; +18 net) · verifier reproduced the exact counts and clean build.

## Rung 3 (Agents/Teams) — the next major leg, scoped

**Foundation that already exists** (M5 work): `lib/runtime/gateway.ts` (`runAgent({capability})`
+ `detectProviders`), `lib/runtime/agent-runs.ts` (AgentRun ledger: recordAgentRun/listAgentRuns),
`lib/runtime/adapter.ts` (provider adapters, claude-code implemented), `lib/runtime/model-catalog.ts`,
`lib/runtime/routing.ts` (capability routing + budget profiles, 13 tests). There is NO `lib/agents/`
or `lib/teams/` yet.

**What rung 3 is:** make the durable Job OS invoke agents through the gateway — an agent-family job
kind whose handler routes a semantic capability via `runAgent`, records an AgentRun with the full
provenance (agent/model/tokens/cost/evidence), and feeds the result back into the chain. Then team
coordination (the Chief-of-Staff manager pattern the WORK_QUEUE specifies: one CoS, ~8-12 domain
agents, dynamic workers, AgentBudgetPolicy). Rung 4 (1–5 model routing) sits above it, on
`routing.ts`.

**Why it is its own leg, not started here:** it is a large architectural build with extensive
existing owner direction (WORK_QUEUE §CHIEF-OF-STAFF, multi-model debate, budget policy). Per the
"don't invent requirements / don't silently change architecture" discipline, it should be built as
a focused effort — the recommended first slice is a single `agent`-family durable kind that routes
one real capability (e.g. `instrument_research`) through the existing gateway and records its
AgentRun, proving the Job-OS→gateway→ledger seam end to end before any team/debate layer. That
first slice is cleanly scoped and safe; the team/model-panel layers follow.

## Next rungs (order)

Agents/Teams on the Job OS (first slice: one agent-kind through the gateway → AgentRun) → team
coordination (Chief-of-Staff) → 1–5 model routing above.
