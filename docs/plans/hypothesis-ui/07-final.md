# Final - hypothesis UI surface

**Verdict: VERIFIED**

## Objective
Close the golden journey's finding: hypothesis creation was MCP-only, so the owner could not
contribute an idea to their own research system.

## What shipped
- `app/api/research/hypotheses/route.ts` - POST records the hypothesis (idempotent by content
  hash) and runs the SAME authoring engine the learning cycle uses; GET lists hypotheses with
  their strategies. Refusals return 200 with a verdict: a refusal is a successful triage.
- `components/research/HypothesisComposer.tsx` - prose in, verdict out, mounted on /strategies
  ABOVE the DSL editor (the hypothesis path authors a strategy WITH research identity; the
  hand-written path cannot - the ordering is the recommendation).
- Professor-path e2e in `e2e/golden-journey.spec.ts`: through the real form on a fresh database,
  desktop and mobile.

## Evidence (all recorded command results, 2026-08-09 evening)
- Expressible prose -> EXPRESSIBLE, thresholds echoed from the owner's own words
  ("gap_pct gte 3", "rvol gte 1.5"), draft strategy in family `fam_*`, visible in the registry
  after reload.
- System-hypothesis -> NOT_A_TRADING_RULE, nothing authored.
- Missing-data hypothesis -> NEEDS_FEATURE naming the quantity, nothing authored.
- Resubmission -> 200 alreadyExisted, nothing duplicated.
- Thin statement -> STATEMENT_INVALID shown in the composer.
- Full suites: **1,294 unit tests / 0 failed - 72 browser tests on a fresh DB / 0 failed** -
  typecheck clean - build clean.

## Unresolved limitations
- The triage is the lexicon: ideas phrased outside its vocabulary refuse as UNCLEAR (by design;
  the false-conversion direction is the unrecoverable one).
- GET list has no UI panel yet; the composer shows only the submitted idea's outcome.

## Rollback
Delete the route, the component, and one mount line.
