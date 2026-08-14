# Trial Budget Governor — Gate 5 Verification

## Suite + typecheck

```
npx tsc --noEmit       → exit 0
npm run test:verified  → 147 files / 637 suites / 1719 passed / 0 failed / 2 skipped
```

Baseline entering this leg: 146 files / 1712 passed. Delta: +1 file (trial-governor.test), +7
tests net (governor tests + auto-gauntlet/cycle-resolution flips), 0 regressions, −1 deleted file
(auto-mode.ts). The 2 skips are the standing pre-existing ones.

## Behavioral proofs

- **Governor** (`trial-governor.test.ts`): off by default refuses even a perfectly eligible
  candidate (`LANE_DISABLED`); no eligible candidate refuses even with the lane on
  (`NO_ELIGIBLE_CANDIDATE`); approves only when lane on AND eligible AND budget remains; refuses
  once the daily budget is spent (`BUDGET_EXHAUSTED`); records an audit row per decision and
  writes zero trials. `MARKETPULSE_AUTONOMOUS_TRIALS` truthiness: only `"1"` enables.
- **auto-gauntlet** (`auto-gauntlet.test.ts`, flipped from the inherited posture): lane off ⇒
  recommend-only; lane on + eligible ⇒ governor authorizes, noData still blocks the spend;
  `run_gauntlet` is now DENIED by `evaluateAutonomousAction`.
- **cycle** (`cycle.resolution.test.ts`, flipped): the guarded gauntlet spends nothing at the
  default (lane-off) posture — `policyAllowed: false`, `spent: false`, reported as a skip.
- **validation job** (`chain.test.ts`, unchanged and still green): an unconfirmed validation job
  dies with 0 trials; the handler now authorizes through the governor, not the removed allowlist.

## Removal + deletion proofs

- `run_gauntlet` removed from `AUTONOMOUS_PERMITTED` (protected policy.ts, edited under direct
  owner instruction — a tightening). Verified: `evaluateAutonomousAction("run_gauntlet",…)` →
  denied.
- `lib/brain/auto-mode.ts` deleted; a repo-wide import search returns zero (the e2e spec uses
  "auto-mode" only as a log label).

## Independent verification

A fresh-context verifier was dispatched on the security-critical questions: is the governor the
SOLE path to a trial spend (every `runGauntlet` caller gated by the governor OR owner auth); is it
truly off by default; does removal break other paths; the TOCTOU question between the budget check
and the spend. Verdict recorded in 07-final.md.

## Known ceiling (documented in 00-status.md)

The daily budget is checked per-authorization against the committed ledger; the autonomous path is
sequential so it cannot overshoot itself. Concurrent overshoot needs multiple explicit
owner-created validation jobs with the lane on — narrow, owner-initiated, and it does not touch
the hard invariants (no holdout requery, no trial deletion, exactly-once per configurationFingerprint).
