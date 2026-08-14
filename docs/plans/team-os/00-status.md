# 00 — Status: Chief-of-Staff / Team OS (rung 3, second leg)

**Feature:** a bounded semantic team on top of the verified single-agent slice. A `depth:"deep"`
`instrument_research` job escalates deterministically to a Chief-of-Staff that plans, runs 3
model-driven members in parallel over one shared evidence packet (each producing a persisted
artifact), synthesizes a dissent-preserving TeamResult, and lets the durable job complete so
dependents wake — with all failures on the existing Job OS grammar and no privileged authority.

**Owner direction (this leg):** build Chief-of-Staff / Team OS BEFORE 1-5 model routing; add four
concepts (TeamDefinition / TeamRun / TeamExecutionPlan / AgentArtifact), not a framework; reuse
`instrument_research` with a deterministic SINGLE↔REQUIRED_TEAM policy; same model for every role;
artifacts not chat; dissent must survive; CoS holds no privileged Quant authority; team failures use
the existing Job OS grammar; deterministic budget the CoS operates inside.

## Gate progress

- Gate 0 Reality — DONE (01-reality.md)
- Gate 1 Product — DONE (02-product.md)
- Gate 2/3 Architecture + Program Design — DONE (03-architecture.md, 04-program-design.md)
- Gate 4 Vertical Slices — DONE (05-slices.md) — schema+ledgers, team definitions, orchestration,
  worker wiring, all built and green
- Gate 5 Independent Verification — IN PROGRESS (independent `verifier` subagent dispatched)

## Evidence so far (self-run, pre-independent-verification)

- Acceptance suite `lib/agents/team.test.ts`: **10 passed**, covering all 17 owner cases.
- Dissent-survival assertion **proven to bite** by a revert-checked mutation (emptying dissent fails [9]).
- Single-agent slice `lib/agents/instrument-research.test.ts` still green — the single path is unchanged.
- `tsc --noEmit`: exit 0.
- Full suite: running (see 07-final.md for the confirmed count).

## Files

New: `lib/agents/teams.ts`, `lib/agents/team-runtime.ts`, `lib/agents/team-runs.ts`,
`lib/agents/artifacts.ts`, `lib/agents/team.test.ts`, `drizzle/0021_team_os.sql`.
Edited: `lib/agents/definitions.ts` (roles + OPTIONAL_TEAM), `lib/db/schema.ts` (2 tables + column),
`lib/db/migrate.ts` (register 0021), `lib/runtime/agent-runs.ts` (teamRunId + idempotent insert),
`lib/research/worker.ts` (deterministic team branch).

## Next action

Await the verifier verdict → 06-verification.md + 07-final.md → update WORK_QUEUE →
checkpoint commit. Deferred to owner steer: 1-5 model routing (rung 4), now that roles/tasks/team
contracts exist as a meaningful destination for a router.
