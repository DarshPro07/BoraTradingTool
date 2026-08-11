# Task 1 — Autonomous Master Runtime

Updated 2026-08-11. Read this first on resume.

## Verdict: TASK 1 VERIFIED IN A BROWSER (desktop + mobile)

`e2e/autonomous-master-runtime.spec.ts` — **12/12 passing** on desktop-chromium and mobile-chromium
against a real `next start` server on an isolated database. Start, idempotent double-start, reload
persistence, Stop, real console state, and zero console/page errors are all proven by clicking, not
by claim.

Observed running unattended: `status=DEGRADED` (honestly reporting a paper-capital mismatch),
`marketMode=MARKET_OPEN` from the real NSE calendar, `succeeded=81` jobs and climbing, `failed=0`.
DEGRADED-but-progressing is the intended behaviour, not a fault.

The model-selection popup still does not exist.

## Slice 1 — done, with evidence

| Property the owner named | Status | Where |
|---|---|---|
| 1. Idempotent Start | **done** | partial unique index (`0017`) + `startAutonomousRun` returns the live run |
| 2. Singleton runtime ownership | **partial** | enforced in the DB; the *file* lease is not yet wired in (see gap below) |
| 3. Durable jobs | **already existed** | `research_jobs` — leased, deduped, retried. Reused, not rebuilt |
| 4. Evidence-driven lifecycle | **partial** | the tick runs `runLearningCycle`; market mode is derived from the exchange calendar. Full state machine is slice 3 |
| 5. Recovery | **done** | stale heartbeat ⇒ `CRASHED` with reason; `reconcileStaleRuns` runs on every status read |
| 6. Degraded, not dead | **done** | a failed cycle sets `DEGRADED` with the reason and keeps ticking |
| 7. Brain as console | **partial** | Start/Stop, status, mode, ceiling, ticks, heartbeat, queue, next action — polling every 5s. The full tile grid is slice 4 |

Files: `drizzle/0016_autonomous_runs.sql`, `drizzle/0017_autonomous_runs_single_live.sql`,
`lib/runtime/supervisor.ts`, `lib/runtime/supervisor.test.ts`,
`app/api/system/{start,stop,status}/route.ts`, `components/system/AutonomousControl.tsx`,
`app/brain/page.tsx`.

Suite: **129 files, 1571 passed, 0 failed**, `tsc` clean.

## Two defects this slice found in its own work

1. **`0016`'s unique index did not do what it said.** `UNIQUE (status) WHERE status IN
   ('STARTING','RUNNING','DEGRADED')` is unique on the *value* of status, so it permits one row per
   distinct live status — and a run is inserted `STARTING` then promoted to `RUNNING`, so the exact
   double-click race it existed to stop went straight through. Caught by the test that inserts the
   losing racer directly. Fixed in `0017` with an expression index collapsing all live statuses to
   one constant. **The test failed against `0016`** — that is what makes it worth keeping.
2. **`0017` originally contained `DROP INDEX`** and was caught by `migrate.test.ts`
   ("contains no destructive SQL"). The guard is right and was not weakened: the old index is
   strictly *weaker* than the new one, so leaving it costs nothing.

## Known gaps — do not mistake these for done

- ~~The file lease is documented but NOT implemented.~~ **Done.** Supervisor holds its OWN lease
  (never the cycle lease — that would deadlock its own cycle), renewed every tick, released when a
  run is stopped or reconciled to CRASHED.
- **No model-selection popup.** `/brain` currently passes `RUNTIME_PROFILES[0]`. The routing layer
  already carries `askOnRestart: true`, so the popup has somewhere to write to.
- ~~No Playwright test yet.~~ **Done and green**, desktop + mobile.
- **The tick calls `runLearningCycle` wholesale.** The evidence-driven state machine
  (`OBSERVE → LEARN → RESEARCH → …`) is not yet a real state machine; it is one cycle per tick.

## Open flake — NOT fixed, NOT reproduced

`lib/learning/lease.test.ts > withCycleLease > runs the work and reports the result` failed once in
a full parallel run and passed in isolation and on rerun. **Not accepted as resolved.**

Evidence and hypothesis: `acquireLease` (`lib/learning/lease.ts:89-101`) tolerates only `EEXIST` and
rethrows every other error from `openSync(file, "wx")`. The test file's own comment records that on
Windows "a scanner watching the temp tree" is enough to matter. A transient `EPERM`/`EBUSY` from an
antivirus or indexer touching the freshly created lease would surface exactly as this failure.

Deliberately not fixed: the root cause was inferred, not reproduced, and a speculative change to a
concurrency primitive is how a flake becomes a deadlock. Reproduce first — a loop hammering
`acquireLease` on a temp path under file-watch pressure — then fix. The supervisor does not yet
depend on this path, so nothing shipped inherits the risk today.

## Next executable task

1. Wire `acquireLease`/`releaseLease` into `startAutonomousRun`/`stopAutonomousRun`, with a test
   proving a second holder is refused.
2. Write `autonomous-master-runtime.spec.ts` and run it against a real server.
3. Model-selection popup on first load after a restart, writing the chosen `RuntimeProfile`.


## What the browser run exposed that unit tests could not

**A dead button of my own making.** `AutonomousControl` sent its POST without the
`x-marketpulse-csrf` header that every mutation in this application requires. Every unit test
passed; the button did nothing but display a refusal. This is exactly the defect class the owner
reported across the product, and no amount of backend testing would have found it — only clicking
it did.

Two further findings from driving it for real:

- **A stale server served the old bundle.** `TaskStop` did not kill `next start`; the port stayed
  held by the previous process, so a rebuilt fix appeared not to work. Identified by PID before
  killing, and the owner's own dev server on :3000 was left untouched. This is the argument for
  `buildFingerprint` in runtime identity — a test can otherwise pass or fail against a server nobody
  believes it is talking to.
- **The spec's own API calls were refused** for missing Origin/CSRF. Playwright's `request` fixture
  is not a browser fetch. The guard was right; the test had to learn its language.

## Next executable task

1. Model-selection popup on first load after restart, writing the chosen `RuntimeProfile`.
2. Replace the wholesale `runLearningCycle` tick with the evidence-driven state machine
   (`OBSERVE → LEARN → RESEARCH → VALIDATE → FORWARD → PAPER → MONITOR → EVOLVE → RETIRE`).
3. Add `buildFingerprint` + PID/startedAt to the status payload so a stale server is visible.
4. Then Task 2 — the UI control inventory.
