# Final — extended crash matrix (masterclass C39)

## Objective

Prove the crash boundaries beyond run-resumption: kill the server while REAL work is mid-flight
(a live model call with the whole durable-job family in the lane) and show restart recovers to
exactly-once effects — no duplicate AgentRun, no duplicate trial, no duplicate forward signal or
paper order, no re-execution of completed work.

## What was built

- **`e2e/crash-matrix.spec.ts`** — self-contained (own `next dev` servers on OS-allocated ports,
  fresh DB per run, stable dist `.tmp/crash-matrix-dist`, tree-kill takes the in-flight CLI down
  with the server). One timeline: seed (real ingest + real authored strategy) → six-kind flight
  (`instrument_research` on a REAL model call, `backtest`, `validation{confirmed:true}`,
  `paper_reconcile`, `forecast_resolve`, `memory_validate`) → SIGKILL mid-call with the ledger
  still empty → restart → recovery audit → all six truthful terminals → exactly-once ledger
  audit → dedupe identity through the crash.
- **Product fix (`lib/runtime/supervisor.ts`)**: `recoverInterruptedRun` now releases the crashed
  run's LANE leases (research + cycle, by exact holder string). Found by the matrix: without it,
  the recovered machine's mid-drain lane is dead for the lease's 10-minute TTL and the other lane
  silently masks it at its own cadence. Fail-first proven (run 3), fixed, post-recovery
  all-terminals latency 121.7s → 36.4s.

## Evidence

- Fail-first: run 3 failed at the lease-freshness assertion against unfixed code with the dead
  server's `acquiredAt` in hand.
- Clean runs 4 & 5 (fresh DB each): **2 passed (1.1m)** / **2 passed (1.3m)**. Assertions:
  recovery audit row; killed job reclaimed exactly once (attempts=2, lastError NULL, envelope
  parses, **COMPLETED AgentRuns for its jobId == 1**); pre-kill-completed jobs frozen (status and
  attempts unchanged through recovery); validation dead of `TRIAL_NOT_AUTHORIZED` with
  **trials == selection_trials == trial_reservations == 0**; forward_signals == paper orders == 0;
  post-recovery claims include the research lane itself; both lease files fresh-or-absent;
  dedupe keys answer with the original job ids.
- Regression: `tsc --noEmit` clean; full vitest suite and the baseline `crash-recovery.spec.ts`
  re-run recorded in `00-status.md`/commit message.

## Honest scope

- PROCESS-KILL-PROVEN: mid-model-call interruption with the family in flight, both concurrent
  drain lanes exercised (runs captured both shapes: research held by lane / by cycle worker).
- CONSTRAINT-PROVEN (static + unit suites): intra-handler partial-write atomicity (SQLite
  transactions in `completeJob`/`enqueue`/`claimNextJob`), replay dedupe (`UNIQUE(signal_id)`,
  trial reservations' fencing index, grading ledger). The millisecond record→completeJob window
  for research is at-least-once for a re-spendable call with a truthful per-attempt ledger — by
  design, documented, not hidden.
- ALREADY-PROVEN ELSEWHERE: single trial spend through the UI double-gate (golden journey ×2
  clean runs); run-resumption (`crash-recovery.spec.ts`).

## Rollback

Additive spec + docs + one scoped supervisor block (release-by-exact-holder at recovery). Revert
the commit to restore prior behavior; no migrations.

## Verdict

**VERIFIED_FOR_DEFINED_SCOPE** — the extended crash matrix exists, found a real recovery defect
(stranded lane leases) plus a false-green shape (safety-net masking), fixed both, and passed two
consecutive clean runs on virgin databases with exactly-once evidence at every ledger.
