# Task 1 — Gate 0: Reality

What already exists, verified by reading it, before designing anything on top.

## The finding that shapes the whole task

**Task 1 is a CONNECTION problem, not a construction problem.** Almost every property the owner
requires is already built and working. What is missing is that none of it can be started, owned, or
observed from inside the product.

## Already built — REUSE, do not rebuild

| Requirement | Already exists | Evidence |
|---|---|---|
| Singleton runtime ownership (prop. 2) | `acquireLease` / `releaseLease` / `currentLease` / `withCycleLease` | `lib/learning/lease.ts:80-137` |
| Durable jobs (prop. 3) | `enqueue` (with `dedupe_key`), `claimNextJob` (leased, `locked_by`/`locked_until`), `completeJob`, `failJob` (retries, `attempts`/`max_attempts`), `queueStats` | `lib/research/queue.ts:36-191` |
| The autonomous cycle itself (prop. 4) | `runLearningCycle` — data, worker, hypotheses→strategies, quant, forward, paper | `lib/learning/cycle.ts:100` |
| Live operational readouts (prop. 7) | `/brain` is already all real ledger reads — jobs, queue stats, strategies, forward, paper, alpha health, graveyard | `app/brain/page.tsx` |
| Run history | `recordCycleRun`, `recentCycleRuns`, `lastCycleRun`, `autonomyPulse` | `lib/learning/run-log.ts` |
| One-shot cycle over HTTP | `POST /api/learning/cycle` → `runLearningCycle` | `app/api/learning/cycle/route.ts` |

Job states persisted today: `queued · running · succeeded · failed · dead`. Durable, leased, and
retried — sufficient. The owner's `WAITING`/`RETRYING`/`CANCELLED` are presentation over these
plus `available_at`, not new storage.

## Missing — this is the whole of Task 1

1. **No `AutonomousRun` record.** `POST /api/learning/cycle` runs exactly one iteration and returns.
   Nothing records that a *machine* is running: no runId, heartbeat, ceiling, market mode, or next
   action. `/brain` therefore cannot tell "running" from "nobody has clicked anything since boot".
2. **No Start control anywhere in the product.** The only drivers are:
   - `scripts/daemon.mjs` — loops `runLearningCycle`, and its own header says it **"dies on reboot
     and does not come back"**;
   - `scripts/cycle.mjs` under Windows Task Scheduler.
   Both are exactly the manual-CLI dependency the owner rejects.
3. **No continuous loop inside the server.** One HTTP call = one cycle. Leave the computer and
   nothing further happens.
4. **`/brain` does not refresh.** `dynamic = "force-dynamic"` re-reads per request, but the page
   never updates on its own, so a running machine looks frozen.
5. **No recovery/reconcile.** Nothing detects a run that was interrupted mid-flight.
6. **No model-selection popup / RuntimeProfile choice at startup.** `lib/runtime/routing.ts` and
   `gateway.ts` know about providers, but nothing asks the owner at boot.

## Constraints that bound the design

- **Learning mode stays owner-set.** `app/api/learning/route.ts:38` requires
  `requireOwnerMutationAccess`; `lib/governance/policy.ts` holds eleven actions prohibited in every
  mode. Protected paths — hook- and test-enforced. The supervisor operates **beneath** the ceiling
  and may never raise it.
- **No broker.** `/api/trade/place` returns `EXECUTION_ADAPTER_MISSING`. Autonomy stops at paper.
- **`agent_runs` and `stock_analysis_reports` are empty** — a fresh Start has no research history to
  display, and must say so rather than render zeros as if they were measurements.

## Labels

`REPRODUCED` — queue/lease/cycle APIs read directly from source; migration head is `0015_agent_runs`.
`STATICALLY_CONFIRMED` — the missing items above are absences verified by grep across `lib/`, `app/`.
