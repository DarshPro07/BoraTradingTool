# Dependency Grammar (resolver v2) — Status

**Mission (owner, 2026-08-14):** after the migration provenance fix, generalize the dependency
engine to one grammar — *"Why can't I continue? → What dependency is unsatisfied? → Who owns
satisfying it? → What event will wake me?"* — with the nine prerequisite kinds and the six-way
blocked classification; compose warm-up from TIME + MARKET_STATE + DATA; expand the durable Job
OS beyond ingestion. Agents/Teams and multi-model routing stay explicitly AFTER this.

Continues docs/plans/dependency-engine/ (v1: DATA remediation, failure classes, typed reasons,
forecast-on-bar-arrival). Gate 0 for this leg: 01-reality of dependency-engine plus the
protected-path-provenance investigation (both current in this checkout).

| # | Slice | Status |
|---|---|---|
| 1 | Prerequisite union (9 kinds) + per-kind assessment + 6-way BlockedClass | ✅ DONE — 12 grammar tests |
| 2 | Composite assessment: `assessRequirements` with dominance + `nextCheckAt` (min-wake) | ✅ DONE — ORB-shaped composition proven |
| 3 | Warm-up two-concept rule: TIME_READY alone must never read as ready without DATA_READY | ✅ DONE — pinned by test |
| 4 | Richer CycleReason optional fields (dependencyType, retryClass, instrument, jobId) | ✅ DONE — wired on the DATA reason |
| 5 | Job OS beyond ingestion: `forecast_resolve` + `memory_validate` durable kinds with real deterministic handlers; target kind ladder documented | ✅ DONE — worker-kinds tests |
| 6 | Verify: suites, tsc, docs | ✅ DONE — 143 files / 1689 passed / 0 failed, tsc 0, build 0; independent verifier PASS (9/9 claims); its one real find (nextCheckAt string-sort comparator) fixed fail-first same session |

## Design decisions (Gate 2/3 compressed — full types in the module docblocks)

- The grammar lives in `lib/brain/dependency-resolver.ts` beside v1's DATA machinery — one
  module answers "why can't I continue", never two.
- `PROVIDER` prerequisites take a caller-supplied probe status (READY/AUTH_REQUIRED/UNAVAILABLE):
  probing spawns binaries (gateway), and an assessment that costs a subprocess per question would
  be re-polling wearing a new hat. The router owns fallback; UNAVAILABLE classifies as
  RESOLVABLE_VIA_ALTERNATIVE.
- Dominance order for a composite: IMPOSSIBLE > EXTERNAL_REQUIRED > RESOLVABLE_NOW >
  RESOLVABLE_VIA_ALTERNATIVE > RESOLVABLE_ON_EVENT > RESOLVABLE_LATER. An impossible member makes
  the composition impossible; otherwise in-flight remediation is the truest headline.
- `nextCheckAt` = MIN of time-knowable blockers' resumeAt — the moment the answer can next
  change. A "when will it all be ready" estimate is NOT computable honestly (event-driven members
  have no ETA) and is not fabricated.
- Structured warm-up refusals from the signals panel (barsHeld/barsNeeded) are the NEXT rung —
  the panel's `ready()` is boolean today and widening it is a features.ts seam change. The
  cycle's warm-up reason stays string-matched INFO until then (severity is unaffected either way).
- Job kinds added only where a real deterministic handler exists TODAY (`forecast_resolve` →
  resolveMaturedForecasts; `memory_validate` → inspectMemory). The remaining ladder
  (instrument_research, hypothesis_generate, strategy_generate, backtest, validation,
  holdout_decision, forward_enroll, forward_resolve, paper_order, paper_reconcile,
  incident_repair) is documented intent: each lands WITH its handler, dedupe identity and
  dependency declarations, never as a decorative enum entry.

## Exact next action

Done — see 07-final.md.
