# Gate 5 — Verification

## Fail-first proofs (the real-test rule)

Every behavioral regression test was run against the unfixed code and observed RED before the
fix was applied. Exact observations, 2026-08-13 ~23:38 IST:

1. **Permanent failures die immediately** — with `failureClass` exported but `failJob` unwired:
   `queue-failure.test.ts` → *"expected 'queued' to be 'dead'"* (old code requeued an
   INSTRUMENT_UNKNOWN failure with retries remaining). GREEN after wiring.
2. **Dead retryable jobs revive after cooldown** — with `enqueue` unwired:
   *"a cooled-down transient failure is new remediation, not a duplicate: expected true to be
   false"* (old dedupe matched the corpse forever). GREEN after wiring.
3. **Structured impairment degrades the run** — with `CycleReport.reasons` added but `tick()`
   unwired: `supervisor.health.test.ts` → *"a non-throwing infrastructure failure must degrade
   the run: Expected 'DEGRADED', Received 'RUNNING'"*. GREEN after wiring.

The waiting-reasons test ("typed waiting reasons keep the run RUNNING") passed against BOTH the
old and new rules — deliberately: it guards the new rule against over-reach, and its value is
pinning, not fail-first.

## The self-resolution loop (the feedback's named acceptance test)

`lib/brain/dependency-resolver.test.ts` — all through the durable queue, no owner action:

- blocked → `REMEDIATION_QUEUED` (job auto-created) → re-ask stacks nothing
  (`REMEDIATION_ACTIVE`, queued=1) → `runWorker` executes → re-ask answers `SATISFIED` and
  `instrumentReadiness().ready === true`.
- Transient death → `COOLING_DOWN` (no doomed duplicate) → cooldown passes → `REMEDIATION_QUEUED`
  with the SAME durable row revived, attempts reset, failure history intact.
- Permanent death → `BLOCKED_PERMANENT` forever, corpse visible in `queueStats().dead`.
- Unlisted instrument → `UNKNOWN_INSTRUMENT`, no job ever created.
- Universe pass → quota-bounded, second pass queues 0 / reports active.

## The forecast chain, link by link

`lib/forecast/resolver.test.ts`:
1. Store-only grading: matured forecast scored with zero provider calls.
2. The wake signal exists: real ingestion publishes `DATA_INGESTED` with the canonical
   instrumentId and bar count.
3. The full chain: a DIFFERENT instrument's ingestion event grades the pending forecast — no
   `runLearningCycle`, no manual call. Awaited via the registration's `lastRun` promise, so the
   test cannot race the fire-and-forget.

## Suite + typecheck

```
npx tsc --noEmit                 → exit 0
npm run test:verified            → 142 files / 616 suites / 1675 passed / 0 failed / 2 skipped
```

Baseline before this work (P0 status, session 5): 138 files / 1654 passed. Delta: +4 files
(queue-failure, dependency-resolver, forecast/resolver, learning/reasons), +21 tests
(19 new + 2 added to supervisor.health), 0 regressions. The 2 skips are the pre-existing ones.

## Independent verification

A separate verifier agent (fresh context) was dispatched to disprove seven claims (revival
cannot loop, permanent death is truthful, store-only forecast path, no RUNNING regression, no
protected paths touched, reasons attached on every exit tier, non-market events filtered) and to
hunt unclaimed defects. **Result: PASS, high confidence, 0 blockers, 7/7 claims CONFIRMED** with
its own fresh suite/type/build runs. Its two fixable gaps were closed the same session
(transactional `enqueue`; double-registration test — final suite 1676 passed / 0 failed); the
third (process-lifetime subscription) is accepted and recorded in 07-final.md, alongside its
flag that the tree's PRE-EXISTING dirty protected-path files (unrelated refactor, including an
applied migration edited in place) deserve separate owner attention.

## Not verified in this pass (stated, not hidden)

- The e2e suites were not rerun: no UI surface or route changed; the supervisor's status
  derivation is covered at unit level with the owner's real report shapes. The next e2e run on a
  fresh server remains the standing two-clean-run gate for the wider P0 mission.
- Live-server behavior of DEGRADED-on-quant-core-unreachable: the code path is proven with the
  production report shape, but no live server with a configured-and-down quant core was
  provoked in this pass.
