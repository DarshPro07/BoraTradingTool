# Final — sealed holdout apparatus

## Objective

The owner's six-piece architecture: a real sealed holdout — separated, sealed, protected,
evaluated once under controlled authority, consumed at family/campaign identity, audited — with
time-series chronology (purge + embargo) and the invariant that the holdout comes AFTER robust
validation (DSR/PBO), never instead of it.

## What was built

- **HoldoutDefinition + Seal** (`drizzle/0022_sealed_holdout.sql`,
  `lib/research-data/holdout-seal.ts`): immutable window over the canonical store, materialized
  as a fingerprinted dataset snapshot at seal time; purge/embargo stated (defaults 14d/7d daily,
  2d/1d intraday); decision rule PINNED as a copy of the declared gates; states SEALED →
  AUTHORIZED_FOR_EVALUATION → CONSUMED / INVALIDATED; one active seal per universe (partial
  unique index); generations for re-seals; fingerprint integrity check that INVALIDATES loudly
  on drift.
- **Development exclusion** (`snapshotFromStore`): while a seal is live, every research snapshot
  excludes [start − purge, end + embargo]. Fail-first proven — 94 bars leaked before the fix.
  The unsealed fingerprint returns byte-identically after consumption.
- **HoldoutEvaluator** (`lib/strategy/holdout-evaluator.ts`): deterministic, never a model; gate
  order seal-authorized → integrity → stage==validated → contamination (qualifying gauntlet
  experiment must postdate the seal) → family/campaign budget (existing `requestHoldoutAccess`)
  → same backtest engine, spec's own declared costs → pinned-rule verdict → full-economics
  `holdout_results` (incl. degradation vs validation OOS PF and reason codes) + `sealed_holdout`
  trial (ladder: pass → holdout_cleared, fail → graveyard) + seal CONSUMED.
- **holdout_decision durable kind** — confirmed:true, never autonomously enqueued (the
  constitutional pattern); **API**: seal (rule pinned at the route from GATES), authorize behind
  the house 428 confirm gate, status listing; **cycle** reports the one next act per universe.
- **UI**: HoldoutPanel on /strategies (definition, state, pinned rule, next act, evaluations
  with degradation) + per-rung waiting breakdown on the funnel.

## Evidence

- Unit: **154 files / 1801 passed / 0 failed** (+11 new across seal, evaluator, worker-kinds).
  `tsc --noEmit` clean throughout.
- Fail-first: dev-snapshot leak (94 bars) reproduced before exclusion; evaluator contamination
  and no-second-look refusals asserted to consume nothing.
- E2E on a fresh production build: 9 passed (40.8s) incl. the apparatus journey; second clean
  run on a virgin DB 3 passed (16.8s). The journey itself surfaced WINDOW_TOO_THIN refusing a
  52-bar tail — the floor working live.

## Honest limitations

- Pre-existing validated strategies are CONTAMINATED_DEVELOPMENT for any new seal (their
  gauntlet ran on full-store snapshots) — eligibility requires post-seal re-validation under the
  trial governor. Stated by the evaluator, never bypassed.
- One look per generation per campaign: with the singleton autonomous campaign, one family's
  evaluation consumes the generation. The next question needs generation N+1 over later data.
- The purge derives from stated defaults, not per-strategy label horizons; both are recorded on
  the definition and overridable at seal time.
- PBO/CSCV beyond the gauntlet's existing DSR/PBO gates is unchanged — the holdout sits AFTER
  those gates by construction (WRONG_STAGE otherwise), per the architectural invariant.

## Rollback

One commit; the migration is additive (two new tables + indexes); no existing table is altered;
no protected paths beyond the sanctioned MIGRATIONS registration line.

## Verdict

**VERIFIED_FOR_DEFINED_SCOPE** — the holdout is now separated, sealed, protected, evaluated
once, consumed at identity, and audited; development provably cannot see it; and every refusal
is a coded, stored reason. What it does not do: make any strategy profitable, or replace robust
validation — by design.
