# Extended crash matrix (masterclass C39) — status

**Objective:** prove the six remaining crash boundaries the owner named — kill during model call /
after model result before persistence / during backtest / during validation reservation / during
forward resolution / during paper reconciliation — each recovering to **exactly-once effects**:
no duplicate AgentRun, no duplicate trial, no duplicate forward signal, no duplicate paper order.

## Gate 0 — reality (all STATICALLY_CONFIRMED from source, 2026-08-14)

The six scenarios all ride ONE machine: the durable job queue (`lib/research/queue.ts`).

- **Claim/lease:** `claimNextJob` claims `queued` OR `running` with `lockedUntil <= now`
  (DEFAULT_LEASE_MS 5min), inside a transaction, attempts+1. A killed worker's job is therefore
  reclaimed by lease expiry — recovery needs no repair step (`supervisor.ts` says exactly this).
- **Recovery:** `recoverInterruptedRun` (boot hook): stale heartbeat (STALE_MS=5min) → CRASHED →
  resume as DEGRADED + audit `autonomous_run_recover interrupted_jobs=N` + restart ticking.
  Verified live by `crash-recovery.spec.ts` (golden baseline 9627ee5).
- **instrument_research** (`lib/agents/runtime.ts`): the AgentRun row is written AFTER the model
  call returns (success or refusal both recorded). Kill mid-call ⇒ ZERO rows for the attempt; the
  reclaimed attempt records exactly one. The narrow record→completeJob window is at-least-once
  for a RE-SPENDABLE model call with a truthful per-attempt ledger — deliberately not a mutex,
  because unlike a trial nothing irreversible is spent.
- **Trials** (the irreversible spend): `withAuthorizedTrial` holds the trial mutex across
  authorize→spend; `trial_reservations` carries a fencing token + partial unique index
  (drizzle/0019). The `validation` job kind is DOUBLE-GATED (payload `confirmed:true` AND the
  governor, which is OFF unless `MARKETPULSE_AUTONOMOUS_TRIALS=1`) and refuses WITHOUT spending.
- **Backtest jobs**: deterministic, snapshot-pinned, append-only `recordExperiment` — re-runnable
  by design; the crash invariant is completeness of any persisted experiment, not uniqueness.
- **paper_reconcile / forward**: `UNIQUE(signal_id)` on execution intents; outcomes keyed by
  intentId; `lib/forward/paper.ts` line 275 documents "a restart replay already decided this
  signal". forecast_resolve is grading-ledger-deduped. Idempotent replay is the designed property.
- **Enqueue surface:** POST `/api/research/jobs` accepts every JOB_KIND (mutation-guarded);
  dedupe: live row → `deduped:true`; dead RETRYABLE corpse revives only after 15min cooldown;
  PERMANENT (INSTRUMENT_UNKNOWN) never revives.
- **Worker:** ONE sequential drainer (`runWorker` maxJobs=10 under the research lease). A real
  model call (~45-70s) therefore HOLDS the lane while later-priority jobs sit queued — a wide,
  natural kill window with everything in flight.

## Design (Gates 1-4, condensed)

**One spec, `e2e/crash-matrix.spec.ts`**, self-contained like crash-recovery (own `next build`
into the STABLE dir `.tmp/crash-matrix-dist` — stable so Next's tsconfig auto-append converges to
one line; fresh DB per run; fresh port per server; tree-kill with taskkill /T so the CLI child
dies with its server). Serial tests share the DB — the file IS the timeline:

1. **Seed** — start machine, ingest fixture history for the subject, author a real strategy spec.
2. **Flight + kill** — enqueue by priority: `instrument_research` (1, claims the lane, REAL model
   call), then `backtest`, `validation{confirmed:true}`, `paper_reconcile`, `forecast_resolve`,
   `memory_validate`. Wait until research is `running` mid-call (agent_runs still 0), SIGKILL the
   tree. Assert the orphaned truth in the DB, then age heartbeat AND the job lease (epoch
   seconds) so recovery is immediate.
3. **Restart → recovery → completion** — new server, same DB: recovery audit row; research
   reclaimed (attempts=2) and SUCCEEDED with `lastError` NULL; **agent_runs COMPLETED rows for
   that jobId == 1**; backtest succeeded with a COMPLETE experiment row; validation refused by
   the governor every attempt → dead with `TRIAL_NOT_AUTHORIZED` and **trials spent == 0**;
   paper/forecast/memory succeeded; **paper orders == 0, forward signals == 0** (nothing invented
   by recovery).
4. **Identity through crash** — re-enqueue the same dedupe keys: succeeded row answers
   `deduped:true` (same id); the validation corpse answers `deduped:true` inside its cooldown.

**Honest scope split** (recorded up front, per the repo's evidence discipline):

- PROCESS-KILL-PROVEN (this spec): kill during a real model call with five kinds in flight;
  restart; recovery; exactly-once per ledger. The kill lands mid-`instrument_research` and
  mid-queue for the other five — the same interruption class as any mid-backtest /
  mid-reconciliation kill at the job layer.
- CONSTRAINT-PROVEN (static + unit suites): intra-handler partial-write atomicity = SQLite
  transactions (`completeJob`, `enqueue`, `claimNextJob` are transactional); ledger-level replay
  dedupe = UNIQUE(signal_id), reservations' fencing index, grading ledger. Cited above.
- ALREADY-PROVEN ELSEWHERE: single trial spend through the UI 428→confirm double-gate — golden
  journey, 8 stocks × two clean runs; general server-kill recovery — crash-recovery.spec.ts.
- The millisecond record→completeJob window for research is AT-LEAST-ONCE by design (re-spendable
  call, truthful ledger) — asserted as "COMPLETED == 1" for the mid-call kill, documented rather
  than hidden for the general case.

## Findings (C35 discipline — each root-caused)

1. **Stranded lane leases after crash recovery** (REPRODUCED, then fixed). `acquireLease` has no
   same-holder re-entry, and a killed mid-drain server cannot release `<db>.research-lease` /
   `<db>.cycle-lease` — so post-recovery, whichever lane was mid-drain at the kill is DEAD for
   the lease's full 10-minute TTL while the other lane masks it at its own cadence. Run 1
   completed every job on 60-second cycle ticks behind a stranded research lease (completion
   timestamps land exactly on ticks: +53.5s recovery → +175.2s ≈ tick 3); the fail-first run of
   the lease-freshness assertion then caught the corpse's record directly (acquiredAt 9.4s
   before the kill). FIX: `recoverInterruptedRun` now releases the crashed run's lane leases —
   exact holder strings `research-<runId>` / `supervisor-<runId>` — with the same authority as
   the supervisor-lease release it already performed. Post-fix, all-terminals latency fell from
   121.7s to 36.4s after recovery, and the spec asserts both mechanism (no stale lease record;
   post-kill research-lane claims present) and outcome.
2. **The flight is drained by TWO concurrent workers by design** (the event-driven research lane
   and the cycle's embedded `runWorker` at `cycle.ts:643`, under separate leases). The spec's
   first draft assumed one sequential lane and asserted "co-flight still queued at kill" — run 2
   failed that honestly (the second worker had already completed four jobs in ~7s while the model
   call held the first). The spec now records the pre-kill truth per job and asserts the REAL
   invariants: terminal-exactly-once, and completed work NEVER re-executed by recovery (attempt
   counts frozen).

## Verification runs

- Run 1 (pre-assertion-hardening): green, but on the cycle safety net — the false-green shape
  that motivated the mechanism assertions.
- Run 2: honest failure of the single-lane flight assumption → tolerant redesign.
- Run 3 (fail-first, unfixed supervisor): FAILED at `.research-lease must not still be the dead
  server's record after recovery` — the finding reproduced by its regression test.
- Runs 4 & 5 (fixed, fresh DB each): **2 passed (1.1m)** and **2 passed (1.3m)** — two
  consecutive clean runs (C50). Kill mid-real-model-call → recovery → all six truthful terminals
  in ~36-55s → exactly-once ledger audit (COMPLETED AgentRuns for the killed job == 1; trials /
  selection_trials / trial_reservations == 0 through crash + restart + three governor refusals;
  forward_signals / paper orders == 0; dedupe identity intact; terminal jobs' attempts frozen).
