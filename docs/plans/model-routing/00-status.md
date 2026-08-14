# 00 — Status: Model Routing (rung 4)

**Feature:** learned, role-based model selection. A role's requirements + the models actually
available + each model's EARNED verification-rate/latency history (from the AgentRun ledger) →
a model assignment, roster-agnostic, refusing rather than silently downgrading. Realizes the owner's
"MarketPulse learns which model earns which role" — no hard-coded `if research → X`.

**Owner direction:** build model routing AFTER Team OS (done), so routing has real roles/tasks as a
destination. **Design roster-agnostic** (pure policy over whatever roster exists; fixture roster for
tests; wire the real detected roster later). Router consumes role requirements + provider health +
cost + latency + **historical verification rate** → assignment.

## Gate progress

- Gate 0 Reality — DONE: mapped `routing.ts` (capability→provider `route()`, honesty invariants),
  `providers.ts` (registry), `model-catalog.ts` (existing `ModelEntry` roster type + basic
  unlearned `selectModelForCapability`), and the `agent_runs` ledger shape. See also
  `01-current-model-inventory.md` (prior session's model inventory).
- Gate 1-3 Product/Architecture/Design — DONE (03-architecture.md).
- Gate 4 Slice — DONE: `model-router.ts` (policy) + `model-stats.ts` (ledger-learned stats) + thin
  team integration (per-role assignment recorded in the plan).
- Gate 5 Independent Verification — IN PROGRESS.

## What this builds ON (not duplicating)

`route()` stays the capability→provider layer enforcing the honesty invariants (arithmetic never
reaches an LLM; a forecast never reaches a chatbot; fallback never silent). The ModelRouter is a
LAYER ABOVE it: which MODEL, for a ROLE, by earned performance. It reuses `ModelEntry` as the roster
type and complements (does not replace) the existing `selectModelForCapability`.

## Evidence so far (self-run, pre-independent-verification)

- `lib/runtime/model-router.test.ts`: **11 passed** (capability filter, learned scoring, role-weighted
  latency, unproven-tried-on-prior, latency cap, verification floor proven-only, refuse-not-downgrade,
  unhealthy exclusion, `computeModelStats` aggregation + capability-keying).
- Team integration in `lib/agents/team.test.ts`: **+2** (learned per-role assignment recorded in the
  plan — the better-ledger model wins from second in the roster, proving the LEDGER drives it; and no
  roster → no assignments, honest single-model default). **13 team tests total.**
- Ledger-learning **proven to bite** by a revert-checked mutation (forcing the router to ignore stats
  makes it pick the worse model by roster order → the integration test fails).
- `tsc --noEmit`: exit 0.

## Files

New: `lib/runtime/model-router.ts`, `lib/runtime/model-stats.ts`, `lib/runtime/model-router.test.ts`.
Edited: `lib/agents/teams.ts` (per-role `modelNeeds`), `lib/agents/team-runs.ts`
(`TeamExecutionPlan.modelAssignments`), `lib/agents/team-runtime.ts` (roster dep + `assignModels`),
`lib/agents/team.test.ts` (integration tests).

## Next action

Await the verifier → 06/07 → commit. Deferred (explicit next wiring step): build the real detected
roster (detectProviders + a populated model catalog with priors) and bind EXECUTION to the assigned
model (the gateway selecting a specific model). This slice delivers the POLICY + the learned signal +
observable per-role decisions; execution binding is the follow-up.
