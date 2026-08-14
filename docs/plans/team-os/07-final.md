# 07 — Final Verdict (Chief-of-Staff / Team OS)

## Verdict: VERIFIED

The Team OS leg (rung 3, second leg) is complete and independently verified, with two of the
verifier's three residual risks closed and re-verified.

## Objective

Build a bounded semantic team on the verified single-agent slice: a deep `instrument_research` job,
coordinated by a Chief-of-Staff, that plans, runs parallel specialist members producing persisted
artifacts, and synthesizes a dissent-preserving result — under the Job OS, with no privileged
authority — so that 1-5 model routing (next) has real roles/tasks/team contracts to route against.

## Architecture

Brain decides work exists; Job OS owns lifecycle; the Chief-of-Staff ONLY coordinates. Four concepts,
not a framework: `TeamDefinition` (static/versioned, pinned by a TeamRun), `TeamRun`,
`TeamExecutionPlan` (persisted before members run), `AgentArtifact` (structured, consumed by id — not
chat). Same model for every role; deterministic synthesizer; deterministic budget the CoS operates
inside; failures on the existing Job OS grammar.

## Implementation summary

- `teams.ts` — `TeamDefinition` + `RESEARCH_TEAM_V1` (Researcher/Source Verifier/Critic + chief;
  budget maxAgents 4 / maxParallel 3 / maxModelCalls 3) + `AgentBudgetPolicy` + `resolveTeamDefinition`
  + `decideTeamExecution` (deterministic SINGLE↔REQUIRED_TEAM).
- `team-runtime.ts` — `runInstrumentResearchTeam`: budget pre-guard → shared packet → plan-before-
  members → bounded-parallel members (each an AgentRun + persisted artifact, deterministic ids) →
  deterministic synthesis (dissent preserved) → chief run + SYNTHESIS artifact → emit once.
- `team-runs.ts` / `artifacts.ts` — the TeamRun + artifact ledgers.
- `definitions.ts` — four role definitions (READ + RECOMMEND_ONLY); RESEARCH_INSTRUMENT_V1 → OPTIONAL_TEAM.
- `agent-runs.ts` — `teamRunId` provenance + idempotent `onConflictDoUpdate` (latest outcome wins).
- schema + `0021_team_os.sql` — `team_runs`, `agent_artifacts`, `agent_runs.team_run_id` (additive).
- `worker.ts` — deterministic escalation branch; single path untouched.

## Files changed

New: `lib/agents/{teams,team-runtime,team-runs,artifacts,team.test}.ts`, `drizzle/0021_team_os.sql`,
`docs/plans/team-os/*`.
Edited: `lib/agents/definitions.ts`, `lib/db/schema.ts`, `lib/db/migrate.ts` (register 0021),
`lib/runtime/agent-runs.ts`, `lib/research/worker.ts`.

## Tests executed — exact results

- Acceptance `lib/agents/team.test.ts`: **11 passed** (10 for the 17 cases + [15b] retry-honesty).
- Single-agent slice `lib/agents/instrument-research.test.ts`: **7 passed** (single path unchanged).
- Dissent-survival: proven to bite by a revert-checked mutation (mine) AND independently by the verifier.
- Gap-1 fix (`onConflictDoUpdate`): proven by [15b] — a FAILED→retry→SUCCESS member ends COMPLETED,
  one row, no stale failure.
- `tsc --noEmit`: exit 0 (repeatedly).
- Full suite: verifier's fresh run **150 files / 1769 passed / 2 skipped**; a confirmatory run after
  the two gap fixes (see 00-status / the session log) — both green, 0 failures.
- MCP integration: 4 passed. `next build`: exit 0.

## Independent verification

`verifier` subagent → VERIFIED / 0 blockers, having read every file, diffed against HEAD (single path
zero-diff), reproduced all 17 cases, and mutation-tested dissent itself. Its two actionable residual
risks (stale-FAILED row; unguarded member throw) were CLOSED and re-verified; the inherited "exactly
once across a whole-process crash" characteristic is documented at the Job OS level (see below).

## Known limitations (not defects of this slice)

- **Exactly-once across a whole-process crash between the team's emit+completeTeamRun and the Job OS's
  completeJob** is not guaranteed — the single-agent path (`bridge.ts:556`) has the identical
  unguarded pattern. This is a systemic Job-OS-level concern (an idempotent job-completion checkpoint)
  and a candidate follow-up, not a Team OS defect.
- **Crash-retry re-executes members** (idempotent by id, so no duplication) rather than checkpoint-
  resuming completed members — a spend optimization for later.
- **Deterministic synthesizer** (no model call for the chief) — a model-based synthesizer is a config
  swap that bumps the TeamDefinition version.
- No UI surface yet for TeamRun/artifacts (ledgers are queryable and ready).

## Rollback

Delete `lib/agents/{teams,team-runtime,team-runs,artifacts,team.test}.ts`; revert the worker branch,
`definitions.ts` roles/teamPolicy, `agent-runs.ts` teamRunId+conflict clause, `schema.ts` tables.
Migration 0021 is additive/nullable — safe to leave applied. No data migration.

## Readiness

**VERIFIED** for the Team OS leg. The wider system stays PARTIALLY_VERIFIED — 1-5 model routing (rung
4) and the rest of the durable quant chain remain ahead. Owner status wording:
**Agent/Team OS Core — VERIFIED_INTEGRATION.**
