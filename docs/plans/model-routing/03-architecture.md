# Gate 2/3 — Architecture + Program Design (Model Routing, rung 4)

## Where it sits — a LAYER above route(), not a replacement

```
Role (Researcher / Critic / …) + its requirements (needs, latency cap, verification floor, weights)
        │
        ▼
  ModelRouter.routeRoleModel(req, roster, stats, capability)     ← LEARNS from the ledger
        │  roster = ModelEntry[] (roster-agnostic)   stats = computeModelStats() over agent_runs
        ▼
  ModelRouteDecision { ok, providerId, modelId, score, source: EMPIRICAL|PRIOR, reason, trail }
        │  or  { ok:false, code: NO_MODEL_AVAILABLE | NO_MODEL_MEETS_REQUIREMENTS, attempted[] }
        ▼
  (recorded in TeamExecutionPlan.modelAssignments)   →   [later] gateway executes on that model
```

`route()` (capability → provider) is UNCHANGED and still owns the honesty invariants: DETERMINISTIC
never reaches an LLM, TIME_SERIES only reaches a financial model, fallback is never silent. The
ModelRouter answers the orthogonal question "which MODEL, for this ROLE, has EARNED the work?" and
reuses `ModelEntry` (the existing catalog/roster type). It complements — does not replace —
`selectModelForCapability`.

## The learned signal

`computeModelStats()` aggregates `agent_runs` into per-(model, capability) stats:
- **verificationRate** = COMPLETED-and-verified / total, where verified = status COMPLETED AND
  (verificationStatus NULL or SOURCE_VERIFIED). A CONFLICTED/INSUFFICIENT completion is not a win.
- **medianLatencyMs** = median(completedAt − startedAt).
- **samples** = count.
Deterministic coordination runs (Chief-of-Staff synthesis: provider "deterministic" / model
"chief_of_staff" / "none") are EXCLUDED — they are not model observations. Every single-agent AND
team-member run feeds these stats, so teams improve future routing: the ledger is the learning loop.

## The policy (routeRoleModel)

1. **Hard filter**: available && health READY && declares ALL `needs`; then latency cap (measured
   when proven, else the class prior); then the verification FLOOR — applied ONLY to models with
   ≥ MIN_SAMPLES_FOR_EMPIRICAL (3) samples, so an unproven model is judged on its prior, never
   rejected for having no history (else no model could ever earn one).
2. **Score survivors**: `w.verification·rate − w.cost·(costRank/3) − w.latency·(latency/maxLatency)`.
   Default weights `{verification 1.0, cost 0.15, latency 0.15}` — verification LEADS (the owner's
   primary directive); a latency-sensitive role raises its own `latency` weight.
3. **Winner** = max score (ties → cheaper, then faster). `source` = EMPIRICAL if the winner had
   enough samples, else PRIOR. The full scored `trail` is returned — observable "why this model".
4. **Refuse, never downgrade**: no survivors → NO_MODEL_AVAILABLE (nothing capable) or
   NO_MODEL_MEETS_REQUIREMENTS (capable but all failed the caps), each with the attempted trail.

## Types

```
RoleModelRequirement { role; needs: (keyof ModelCapabilities)[]; maxLatencyMs?; minVerificationRate?; weights? }
EmpiricalModelStats  { lookup(modelId, capability): {verificationRate, medianLatencyMs, samples} | null }
ModelRouteDecision   = { ok:true; providerId; modelId; score; source; reason; trail[] }
                     | { ok:false; code; attempted[]; message }
routeRoleModel(req, roster: ModelEntry[], stats, capability) -> ModelRouteDecision
computeModelStats(rows?) -> EmpiricalModelStats   // rows injectable for tests; defaults to the DB
```

## Integration (thin, roster-agnostic)

`TeamMemberSpec` gains `modelNeeds`; `TeamExecutionPlan` gains optional `modelAssignments`.
`runInstrumentResearchTeam` accepts `deps.roster` (default `[]`); when a roster is present it computes
`computeModelStats()` and routes each role, recording the per-role decision in the plan. **Default
empty roster → no assignments** (honest single-model behavior; the real detected roster is the next
wiring step). Members still EXECUTE on the same capability/model as before — this slice makes the
routing DECISION real, observable, and learned; binding execution to the chosen model is the deferred
follow-up (needs the gateway to select a specific model).

## Alternatives considered

- **Replace route() / selectModelForCapability** — rejected; route() owns invariants the router must
  not touch, and a learned layer composes cleanly above it.
- **Hard-code role→model** — rejected; the owner's explicit anti-goal. Route by earned history.
- **Reject unproven models** — rejected; a model can never earn history if it is never tried. Priors
  let it compete without beating a proven one.
- **Bind execution now** — deferred with the real roster; the policy + learned signal are the substance.

## Risks

- Cold start: with an empty ledger every model routes on priors (source PRIOR) — correct and honest;
  routing sharpens as runs accumulate.
- The default roster is empty until the real detected-roster builder is wired — the router's value is
  latent until then, but proven by fixture-roster tests and observable the moment a roster is supplied.
