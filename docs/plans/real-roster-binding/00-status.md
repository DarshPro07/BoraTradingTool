# 00 — Status: Real Model Roster + Execution Binding (masterclass A6.1/A6.2)

**Feature:** close the two production gaps the model-routing leg (docs/plans/model-routing/) named
as its explicit next step: (A6.1) the production team path builds its roster from what
`detectProviders()` ACTUALLY found — never a fixture; (A6.2) the router's assigned model is
actually requested from the adapter, and where a provider cannot enumerate/bind, that limitation is
REPRESENTED (`binding: PROVIDER_DEFAULT`) rather than hidden.

## Gate 0 — Reality (compact; labels STATICALLY_CONFIRMED)

- `DetectedProvider.models: CatalogModel[]` exists but the claude-code probe returns `[]` — the CLI
  does not enumerate models. The EXECUTED model is already discovered post-hoc from run telemetry
  (`pickModelId` over modelUsage).
- The claude adapter ALREADY passes `--model` (env alias `MARKETPULSE_CLAUDE_MODEL ?? "sonnet"`,
  documented as a routing knob) — so binding IS technically supported; it just wasn't driven by the
  router's assignment.
- The production team caller passed no roster (learned routing exercised only by tests) — the gap
  the model-routing 07-final named.

## Design (Gates 1-3, compact)

- `lib/runtime/roster.ts` — `buildDetectedRoster(detected)`: READY LLM providers only; enumerated
  `CatalogModel`s → entries carrying the catalog's own relative cost (→ latency class) — nothing
  authored here; a READY non-enumerating LLM → ONE sentinel entry `<provider>:default`, an explicit
  truthful statement ("the provider serves its configured model; the id is discovered per-run"),
  NOT a fabricated name. Capabilities derive from the PROVIDER_REGISTRY descriptor's declared
  support. `contextWindow 0` = unreported. Malformed enumerations are ignored (defensive).
- `gateway.ts` — `AgentRunRequest.model?: string | null`; claude adapter uses
  `request.model ?? CLAUDE_MODEL_ALIAS` for `--model`. Two-line diff.
- `team-runtime.ts` — `deps.roster === undefined` → build from real detection (production default);
  explicit `[]` → honest no-assignments. `RunMember` gains `assignedModel`; the real runner passes a
  CONCRETE id to the gateway and passes the sentinel as null. `assignModels` records
  `binding: REQUESTED | PROVIDER_DEFAULT` per role in the persisted plan.
- Single-agent path (`lib/agents/runtime.ts`) and `route()` untouched.

## Evidence (self-run)

- `roster.test.ts` 5/5 · team 15/15 (incl. new `[A6.2]` assigned==executed==recorded proof and the
  production-default PROVIDER_DEFAULT assertions on the worker path) · single slice 7/7 unchanged ·
  router 11/11 — 37/37. `tsc` exit 0.
- **Mutation-proven:** severing the model thread-through (`model: concreteModel` → `null`) fails the
  `[A6.2]` test; reverted and re-verified green.
- Full suite + independent verifier: running; verdict lands in 06/07.

## Files

New: `lib/runtime/roster.ts`, `lib/runtime/roster.test.ts`, `docs/plans/real-roster-binding/`.
Edited: `lib/runtime/gateway.ts` (2 additions), `lib/agents/team-runtime.ts`,
`lib/agents/team-runs.ts` (binding field), `lib/agents/team.test.ts`.

## Next action

Await full suite + verifier → 06/07 → WORK_QUEUE → commit. Remaining A6-adjacent scope (owner-
steered later): an owner-facing 1-5 ACTIVE-model selection surface (the roster builder is the input
to it); enumeration probes for API providers when their adapters exist.
