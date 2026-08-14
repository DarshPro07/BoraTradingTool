# Final — strategy pipeline progression

## Objective

Owner requirement: "the system should create a strategy unless no path exists." Applied as the
blocked-task doctrine to strategies: every strategy advances, knows its typed dependency and the
named next action, or terminates with a stated permanent reason. Nothing stalls silently.

## Root causes fixed (each fail-first where reproducible)

1. Authored specs were UNSATISFIABLE BY CONSTRUCTION — resolution defaulted "D" (DELIVERY) while
   the capital basis is INTRADAY-only, so the candidacy guard refused every one, forever
   (fail-first: "basis says INTRADAY but the authored spec resolves 'D'"). Now born on the
   basis's own product (5m), priced on the same product, spread stated.
2. Rehearsal STARVED specs 11+ — unordered `.slice(0,10)` re-evaluated the same ten forever
   (fail-first: 12 drafts, 2 passes, 10 seen). Now rotates: never-rehearsed first, then stalest.
3. One unpriceable spec could kill the WHOLE candidacy pass (unguarded `CostModelError`) —
   latent, statically confirmed, now blocks only itself (guarded wrapper, injectable, tested).
4. Stall reasons were computed and thrown away — `blockedOn` had no consumer; the funnel read
   raw tables (its REHEARSED bar was the cap itself). Now the funnel counts the derived ladder
   from the SAME standings array as the rows, and the typed wait renders per-row and aggregated.
5. The ladder above `validated` had no recorded path — `forward_enroll` now exists as a durable
   kind (double-gated like `validation`: explicit enqueue + confirmed:true; ALREADY_ACTIVE is
   success; SPEC_NOT_FOUND is PERMANENT), and the cycle REPORTS enrollable survivors with the
   exact enqueue to make. Not autonomous: the protected governance table has no action code for
   challenger activation, and this leg does not invent policy.

## Deliberately not built

- **holdout_decision**: no sealed-holdout dataset apparatus exists anywhere (no snapshot
  purpose, no sealed segment, no evaluator — `holdoutId` is a ledger key). Improvising one
  mid-slice would be fabricated statistics. The stage surface states the wait; the apparatus is
  queued as its own WORK_QUEUE item.
- No re-authoring migration for existing "D" specs — their refusal is now VISIBLE with its
  reason; new authorship supersedes them through the normal pipeline.
- No change to trial governance (lane switch, 1/day budget, double gates all untouched).

## Evidence

- Unit: full suite **152 files / 1792 passed / 0 failed** (+6 new: author invariant, rotation,
  guarded candidacy, forward_enroll gates ×2, forwardEnrollable). `tsc --noEmit` clean.
- E2E (fresh production build, fresh DB): `strategy-progression.spec.ts` + strategy-factory +
  app — **8 passed (1.3m)**; second clean run on a second virgin DB — **2 passed (15.3s)**.
- Files: lib/research/hypothesis-author.ts, lib/learning/rehearsal.ts,
  lib/strategy/auto-gauntlet.ts, lib/strategy/promotion.ts, lib/learning/cycle.ts,
  lib/research/queue.ts, lib/research/worker.ts, components/strategy/ValidationFunnel.tsx,
  app/strategies/page.tsx, e2e/strategy-progression.spec.ts, + 4 test files.

## Rollback

Single commit revert; no migrations, no data transformations, no protected paths touched.

## Verdict

**VERIFIED_FOR_DEFINED_SCOPE** — the funnel's five structural stalls are closed or honestly
stated; autonomously authored strategies are born eligible; every rung either advances by
evidence, carries a typed visible wait, or names the explicit act that moves it. Strategy
PROFITABILITY remains NOT VERIFIED — this leg makes the pipeline honest, not the edge real.
