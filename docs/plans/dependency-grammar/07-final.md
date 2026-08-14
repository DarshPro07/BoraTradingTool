# Final — Dependency Grammar (resolver v2) + Protected-Path Provenance

**Verdict: VERIFIED** (defined scope: engine behavior + migration resolution; e2e explicitly out
of scope, stated in 06-verification.md).

## Objective (owner, 2026-08-14)

Resolve the protected migration/refactor situation FIRST; then one grammar for every blocked
workflow; warm-up as TIME + DATA, not one clock; the Job OS beyond ingestion. Agents/Teams and
multi-model routing deliberately AFTER — and they were not touched.

## Delivered

1. **Provenance resolved** (docs/plans/protected-path-provenance/): 0014 restored to canonical
   after proving the edit dead three ways; no data migration needed (the always-RUN intent lives
   in code and covers every DB uniformly); the wider single-RUN/ownerless-auth refactor stays as
   inherited, test-green, owner-directed WIP — uncommitted, auth surfaces e2e-unverified (named).
2. **The grammar**: 9 prerequisite kinds → 6-way BlockedClass with dominance; composite
   assessment with honest min-wake; the two-concept warm-up rule pinned (TIME ✓ + market ✓ +
   DATA ✗ → NOT ready; the durable queue closes it with no owner).
3. **Job OS**: `forecast_resolve` + `memory_validate` durable kinds with real deterministic
   handlers; the remaining ladder documented with the no-decorative-entries rule.
4. **CycleReason enrichment**: optional dependencyType/retryClass/instrument/jobId, wired where
   a producer exists today.

## Evidence

- `npx tsc --noEmit` → 0 · `npm run test:verified` → **143 files / 1689 passed / 0 failed /
  2 skipped** (entering baseline 1676; +13 tests net, 0 regressions) · `npm run build` → clean
  (verifier's own run).
- Post-restore migration+governance regression: 76/76.
- Fail-first regressions this leg: the mixed-format `nextCheckAt` comparator (below) observed
  red against the string sort, green after the instant-aware fix.

## Independent verification (Gate 5)

Fresh-context verifier, its own suite/typecheck/build runs, exact-match reproduction of the
suite numbers: **PASS, high confidence, 0 blockers, all 9 claims CONFIRMED** — including the
three-ways-dead migration analysis (it additionally confirmed only two coercing readers of the
stored mode exist and that no code path executes 0014's .sql), the satisfied⟺null invariant
across all 24 assessment branches, the no-cycle import graph, and that the worker-kinds test
writes nothing outside its temporary database.

**Its hunt found one real dormant defect, fixed the same session:** `nextCheckAt` min-selected
by STRING sort, and `' '` < `'T'` makes a same-day exchange-local descriptor beat an EARLIER ISO
instant — a consumer would under-poll. Fixed with an instant-aware comparator (descriptors
inverted through the zone's own rules via Intl — DST-correct by the zone database, not a
hardcoded offset); regression proven red first; suite re-run green (1689). Its two refuted
suspicions (composition double-enqueue; CLASS_PRECEDENCE completeness) and one cosmetic note
(a stale test name in protected `lib/governance/runtime.test.ts` — left, protected + cosmetic)
are recorded here.

## Flags for the owner (unchanged from dependency-engine final, minus the migration)

The single-RUN/ownerless-auth refactor remains uncommitted across protected paths — coherent,
unit-green, matching your stated direction, and needing YOUR commit decision plus an e2e pass
over its auth surfaces. The migration half of that flag is now resolved.

## Next rungs (unchanged order)

Structured warm-up refusals (panel `ready()` → barsHeld/barsNeeded) · event-driven queue wake
beyond the 5s lane · the durable-kind ladder, each WITH its handler · Agents/Teams as workers ·
multi-model routing above.
