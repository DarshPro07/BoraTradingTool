# Continuous Chain (rung 3) — Status

**Mission (owner, 2026-08-14):** after the instant/display split and event-driven wake, add
durable `backtest`/`validation` job kinds — each ONLY when its real handler exists — and prove
one continuous chain: candidate → backtest job → BACKTEST_COMPLETED → validation dependency
wakes → verdict → memory/forward, with no owner clicking Next. Agents/Teams and model routing
remain AFTER this.

Standing invariant to preserve (owner): *every non-terminal blocked state has an explicit wake
condition or remediation owner; every terminal state has an explicit reason; no workflow depends
on repeated warning text to progress.*

| # | Slice | Status |
|---|---|---|
| 1 | WakeInstant split: epochMs schedules, display presents; string comparator deleted | ✅ DONE — 21 tests, mixed-format min proven by instant |
| 2 | Event-driven job wake; 5s poll demoted to reconciliation safety net | ✅ DONE — registerJobWake, 3 tests + short-txn discipline confirmed |
| 3 | Auth boundary adversarially proven (owner's gate) | ✅ DONE — 16 forged-request attacks rejected, happy path allowed |
| 4 | Durable backtest kind + continuous-chain wake proof | ✅ DONE — backtest+validation kinds, chain test 3/3 |
| 5 | Verify + docs + independent check | ✅ DONE — 146 files / 1712 passed / 0 failed, tsc 0; verifier PASS 0 blockers; safety finding confirmed + sharpened |

## What landed for slice 4

- `backtest` job kind (READ capability `run_backtest`, deterministic, re-runnable): handler reads
  a recorded snapshot via `snapshotFromStore`, runs `runPortfolioBacktest`, persists via
  `recordExperiment`, and emits `BACKTEST_COMPLETED` with the REAL specId — the engine's own emit
  says "unknown", which could never wake a spec-scoped dependent.
- `validation` job kind: DOUBLE-GATED handler (payload.confirmed===true AND
  `evaluateAutonomousAction('run_gauntlet')` allowed AND `freezeStanding`), refuses-without-
  spending on any miss. **Nothing autonomous enqueues it** — reached only by explicit creation.
- Continuous-chain test (lib/research/chain.test.ts): backtest job → experiment persisted →
  BACKTEST_COMPLETED(real specId) → a dependent job wakes `waiting_dependency → queued →
  succeeded` in one drain sweep, no owner; and an unconfirmed validation job dies with 0 trials
  spent.

## Constraints already known

- **The validation gauntlet spends an irreversible trial** (CLAUDE.md: "every trial permanently
  raises the statistical bar"; "Do not run the validation gauntlet speculatively"). An autonomous
  `validation` job must therefore be POLICY-GATED (`evaluateAutonomousAction('run_gauntlet')`),
  which is NOT in the default autonomous allowlist — so the honest autonomous behavior is
  REFUSE-WITHOUT-SPENDING, exactly as `runAutonomousGauntlet` already does in the cycle. The
  chain proof will show the dependent job WAKING and then the guardrail correctly refusing to
  spend, which is a valid terminal outcome — not forcing a trial to manufacture a green chain.
- Backtest is deterministic and re-runnable → safe as an autonomous durable kind.

## Exact next action

Await handler map; add `backtest` kind with the real persist path; write the chain test
(dependent job wakes via job-dependency + event wake, no owner).
