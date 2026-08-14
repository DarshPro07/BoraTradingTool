# Continuous Chain — Gate 5 Verification

## Suite + typecheck

```
npx tsc --noEmit       → exit 0
npm run test:verified  → 146 files / 634 suites / 1712 passed / 0 failed / 2 skipped
```

Baseline entering this leg: 143 files / 1689 passed (dependency-grammar final). Delta: +3 test
files (supervisor.wake, local-session-security, chain), +23 tests net, 0 regressions. The 2 skips
are the standing pre-existing ones.

## Behavioral proofs, by slice

- **WakeInstant split** (21 tests, dependency-resolver + reasons): the mixed-format min now
  selects by instant — a same-day exchange-local descriptor no longer beats an earlier ISO time;
  every assessment carries `resumeAtMs` beside its display; the string-parsing comparator is
  deleted. An exchange-local display always carries its true UTC instant (09:00 IST = 03:30 UTC).
- **Event-driven job wake** (3 tests): a new job wakes the lane on JOB_CREATED; a completion
  wakes it on JOB_COMPLETED (dependents just became claimable); registration is idempotent. The
  5s research timer remains as the reconciliation net.
- **Auth boundary** (16 forged-request tests): every attack the owner enumerated is rejected;
  the legitimate path is allowed. See protected-path-provenance/00-status.md.
- **Continuous chain** (3 tests): backtest job runs, persists an experiment, and emits
  BACKTEST_COMPLETED with the REAL specId; a dependent job wakes `waiting_dependency → queued →
  succeeded` on the parent's success in one drain sweep, no owner; an unconfirmed validation job
  dies with **0 rows in schema.trials** — the guardrail proven, not asserted.

## Safety judgment recorded

The `run_gauntlet` autonomous-allowlist finding (SAFETY-FINDING-run_gauntlet.md) is a
governance-posture change inherited from a prior session, surfaced for owner decision. This leg
deliberately did not build autonomous trial-spending on it; the new `validation` kind is
double-gated and enqueued by nothing autonomous.

## Independent verification

A fresh-context verifier was dispatched against all five claims plus the safety judgment, with
instructions to independently confirm whether `run_gauntlet` is genuinely in the allowlist, and
to hunt for any path reaching `runGauntlet` without all three gates. Verdict in 07-final.md.

## Not verified in this pass (stated)

- No UI changed; e2e not rerun. The auth happy-path is covered by existing green e2e mutation
  flows; the enforcement function is adversarially proven at unit level.
- The `validation` handler's ALLOWED path (actually running the gauntlet) is exercised only under
  the double gate; the chain test proves the REFUSE path to avoid spending a trial even in a
  temp DB unless explicitly intended.
