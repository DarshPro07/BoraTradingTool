# Task 1 — Gate 2: Architecture

## The decision that matters: where does the loop live?

The owner requires "click Start, walk away, come back to a machine still making progress", and
separately "do not rely on in-memory timers for important work."

Those pull in opposite directions only if you conflate two things:

| | The TICKER | The WORK |
|---|---|---|
| What | something that decides *now is the time to act* | ingestion, scanning, research, backtests, forward, paper |
| Lives in | the Next.js server process | `research_jobs` — leased, deduped, retried, resumable |
| Survives a crash? | no | **yes** |
| Cost of losing it | one missed tick | nothing |

**So: an in-process supervisor ticks; the database holds the state.** Losing the ticker loses a
tick, never a unit of work — because `claimNextJob` leases with `locked_until`, so a job interrupted
mid-flight becomes claimable again once its lease expires. That IS the durable-execution pattern the
owner asked for, implemented on machinery this repository already has. Introducing Temporal to get
it would be migration risk for a property already satisfied.

Rejected alternatives:

- **External daemon / Task Scheduler** — what exists today (`scripts/daemon.mjs`, `scripts/cycle.mjs`).
  Rejected: it is precisely the manual-CLI dependency Task 1 exists to remove, and the daemon's own
  header admits it dies on reboot.
- **Durable timer service (Temporal et al.)** — real durability, real migration risk, and it would
  duplicate `research_jobs`. Use the pattern, not the dependency.

## Shape

```
POST /api/system/start ──► startAutonomousRun()
                              │  (idempotent: returns the live run if one exists)
                              ├─► acquireLease()            singleton ownership, existing
                              ├─► INSERT autonomous_runs    runId, profile, ceiling, mode, status
                              └─► supervisor tick loop ─┐
                                                        │
        ┌───────────────────────────────────────────────┘
        ▼
   every tick:  heartbeat ──► autonomous_runs.heartbeat_at
                marketMode ──► from exchange calendar + readiness
                nextAction ──► what it is about to do, in words
                runLearningCycle()  ← the existing machine, unchanged
                                     enqueues durable jobs, drains the queue

GET /api/system/status ──► the same row + queueStats() ──► /brain (auto-refresh)
POST /api/system/stop  ──► status=STOPPED, release lease
```

## `autonomous_runs` — the record the owner specified

`id · runId · startedAt · runtimeProfile · governanceCeiling · marketMode · status · heartbeatAt ·
lastCheckpoint · nextAction · stoppedAt · stopReason · ticks · host`

`status`: `STARTING · RUNNING · DEGRADED · STOPPED · CRASHED`

`governanceCeiling` is **copied from the learning mode at start** and is a *record of what was
permitted*, never a control. The supervisor reads the live mode each tick; it cannot write it.

## Idempotent Start (property 1)

Two clicks must not produce two supervisors. Enforced at two layers, because either alone is a race:

1. **Database** — a partial unique index allowing at most one row whose `status` is `STARTING` or
   `RUNNING`. A second insert fails at the storage layer, not in application logic.
2. **File lease** — `acquireLease` already gives cross-process exclusion, covering a second Node
   process pointed at the same database.

`startAutonomousRun()` therefore: read live run → if present, **return it** → else acquire lease →
insert → start ticking.

## Recovery (property 5)

A run whose `heartbeatAt` is older than the stale threshold was interrupted — the process died
without stopping. On startup and on every status read:

```
stale RUNNING row ──► mark CRASHED with reason
                 ──► expired job leases are already reclaimable by claimNextJob
                 ──► /brain shows the recovery honestly, not a silent gap
```

No duplicate work: interrupted jobs return through the existing lease expiry, and `dedupe_key`
prevents re-enqueuing the same unit.

## Degraded operation (property 6)

The supervisor never dies because a dependency did. Each tick catches per-subsystem failure, records
it, sets `status=DEGRADED` with the reason, and continues the subsystems that still work. Provider
down ⇒ deterministic data/market work proceeds. This mirrors `runLearningCycle`'s existing
`skipped[]` discipline rather than inventing a second error model.

## Security

`/api/system/start|stop` are mutations ⇒ `requireMutationAccess`. They do **not** require owner
authority: starting the machine within its existing ceiling is an operator action, not a governance
change. Raising the ceiling remains owner-only and untouched.

## Observability

Every start/stop/crash writes an `audit_events` row, so "who started this and when" is answerable
from the same ledger as every other governed decision.
