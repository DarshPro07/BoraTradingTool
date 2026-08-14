# 07 — Final Verdict (Model Routing, rung 4)

## Verdict: VERIFIED

Learned, role-based model routing is built and independently verified; the verifier's one actionable
gap (prose-parsed refusal classification) is closed and re-verified.

## Objective

Route a role to the model that has EARNED it — by verification-rate/latency history from the AgentRun
ledger — over whatever roster exists, refusing rather than silently downgrading. No hard-coded
`if research → X`. Built AFTER Team OS so routing has real roles/tasks as a destination.

## Architecture

A policy layer ABOVE the unchanged `route()` (which keeps the arithmetic/forecast/fallback honesty
invariants). `routeRoleModel(req, roster, stats, capability)` reuses the existing `ModelEntry` roster
type; `computeModelStats()` turns the `agent_runs` ledger into the learned signal. Roster-agnostic:
fixture roster for tests; the real detected roster is the deferred next wiring step.

## Implementation summary

- `model-router.ts` — the policy: hard capability/health/latency/verification-floor filter → weighted
  score (verification leads) → assignment or a coded refusal with the attempt trail. Unproven models
  are tried on a prior; the verification floor applies only to proven models; refusal is classified by
  a structural flag (not prose).
- `model-stats.ts` — per-(model, capability) verificationRate/medianLatencyMs/samples from the ledger;
  deterministic coordination runs excluded; team + single-agent runs both feed it (the learning loop).
- Team integration — `modelNeeds` per role; `TeamExecutionPlan.modelAssignments`; `runInstrumentResearchTeam`
  records the router's per-role decision when a roster is present (honest empty default otherwise).

## Files changed

New: `lib/runtime/model-router.ts`, `lib/runtime/model-stats.ts`, `lib/runtime/model-router.test.ts`,
`docs/plans/model-routing/{00,03,06,07}.md`.
Edited: `lib/agents/teams.ts`, `lib/agents/team-runs.ts`, `lib/agents/team-runtime.ts`,
`lib/agents/team.test.ts`.

## Tests executed — exact results

- `lib/runtime/model-router.test.ts`: **11 passed** (capability filter, learned scoring, role-weighted
  latency, unproven-on-prior, latency cap, verification-floor-proven-only, both refusal codes,
  unhealthy exclusion, computeModelStats aggregation + capability-keying).
- Team integration: **+2** (learned per-role assignment recorded in the plan — winner from SECOND in
  the roster, proving the ledger drives it; no-roster → no assignments).
- Ledger-learning **proven to bite** by a revert-checked author mutation (forcing stats-ignored →
  the integration test fails).
- Team OS 13/13, single slice 7/7 (unchanged). `tsc` 0. Full suite **150 files / 1779 passed**
  (verifier's independent run confirmed 1779/1779 non-skipped; the one mcp anomaly is an environmental
  parallelism flake in an untouched file). MCP 4/4. `next build` exit 0.

## Independent verification

`verifier` subagent → VERIFIED / 0 blockers, having read all files, hand-traced the scoring math,
confirmed `route()` zero-diff and a strictly-additive lib/agents diff, and root-caused the sole
full-suite anomaly to test-runner resource contention. Its actionable gap (prose-parsed classification)
was closed; the others are already-covered (mutation executed; live-DB path exercised by the seeded
integration test) or explicitly-deferred scope.

## Known limitations / deferred (the explicit next steps)

- **Real detected-roster wiring**: the production caller passes no roster yet, so learned routing is
  exercised by tests until `detectProviders()` + a populated model catalog build the live roster.
- **Execution binding**: this slice makes the routing DECISION real, observable and learned; binding
  the gateway to EXECUTE on the chosen model is the follow-up (needs gateway model-selection).
- A CI mutation-testing step on `model-router.ts` would permanently pin the decisiveness the author
  proved by hand this session.

## Rollback

Delete `lib/runtime/model-router.ts`, `model-stats.ts`, `model-router.test.ts`; revert the additive
`lib/agents/*` changes (modelNeeds, the plan field, assignModels + roster dep). No schema, no
migration, no change to `route()` — fully isolated.

## Readiness

**VERIFIED** for the model-routing policy + learned signal + observable per-role decisions. The system
stays PARTIALLY_VERIFIED overall (real-roster wiring + execution binding ahead). Owner status wording:
**Model Router (policy + learned signal) — VERIFIED_INTEGRATION.**
