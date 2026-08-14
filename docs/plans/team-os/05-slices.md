# Gate 4 — Vertical Slices (Team OS)

Built end-to-end and left green at each step; verified per slice.

## Slice 1 — schema + ledgers (tracer)

`drizzle/0021` (team_runs, agent_artifacts, agent_runs.team_run_id — all additive/nullable) →
`schema.ts` tables → `migrate.ts` registration → `agent-runs.ts` gains `teamRunId` +
`onConflictDoNothing` (deterministic-id idempotency) → `team-runs.ts` + `artifacts.ts` ledgers. This
laid the durable spine every later slice writes into. tsc clean; existing agent-runs consumers
unchanged (field optional); the single-agent path writes none of it.

## Slice 2 — the static team contract + roles

`definitions.ts`: four role AgentDefinitions (chief_of_staff / researcher / source_verifier / critic),
all READ + RECOMMEND_ONLY; `RESEARCH_INSTRUMENT_V1.teamPolicy → OPTIONAL_TEAM`. `teams.ts`:
`TeamDefinition` + `RESEARCH_TEAM_V1` (3 members + chief, budget maxAgents 4 / maxParallel 3 /
maxModelCalls 3) + role systemPrompts (each demands strict JSON) + `AgentBudgetPolicy` +
`resolveTeamDefinition` + `decideTeamExecution`. The "what it was", pinned by version.

## Slice 3 — the Chief-of-Staff runtime (real happy path + failure + budget)

`team-runtime.ts` `runInstrumentResearchTeam`: budget pre-guard → shared packet (NO_STORED_DATA
defers via the dependency grammar, single-path parity) → deterministic teamRunId → createTeamRun +
persist plan BEFORE members → members in bounded parallel (each an AgentRun + persisted artifact,
deterministic ids) → any failure fails the TeamRun and throws a coded error for the Job OS → all-ok
deterministic synthesis with dissent preserved → chief AgentRun + SYNTHESIS artifact → completeTeamRun
→ emit RESEARCH_COMPLETED once. tsc clean.

## Slice 4 — wire the deterministic escalation

`worker.ts` `case instrument_research`: `decideTeamExecution(payload)` → REQUIRED_TEAM runs the team,
else the verified single path, byte-for-byte unchanged. This is the only change to the existing
dispatch, and it is guarded so a non-deep job is untouched (acceptance #1).

## Slice 5 — acceptance (owner's 17) + verification

`team.test.ts` (10 tests). Each critical assertion's known-failure-mode:
- **[1] single unchanged** — a regression that always teamed would create a team_run for a plain job
  and fail the "no team_runs" assertion.
- **[2/3] one versioned TeamRun** — a missing/duplicate TeamRun, or an unpinned version, fails the row/version match.
- **[4] plan-before-members** — reading the persisted plan proves it exists; a runtime that planned
  after members would leave `plan` null at member time.
- **[5] member runs** — the four agentIds (3 roles + chief) are asserted by exact set.
- **[6] overlap** — the concurrency counter would read 1 if members ran serially. PROVEN ≥2.
- **[7/8] artifacts by id** — the persisted verifier artifact's `concern` must equal the value that
  survives into the TeamResult; a copied-blob synthesizer would diverge.
- **[9] dissent survives** — PROVEN TO BITE: emptying `dissent` in the synthesizer fails [9] (reverted).
- **[10/11] exactly once** — job `succeeded` and RESEARCH_COMPLETED count === 1; a double-emit fails.
- **[12] dependent wakes** — the dependent transitions waiting_dependency → succeeded on the team's success.
- **[13] provider fail → Job OS** — the job settles `dead` (maxAttempts 1) with the provider's code.
- **[14] invalid output → CONTRACT_VIOLATION** — a non-JSON member reply fails the team with that code.
- **[15] no duplication on retry** — a second run at the same jobId keeps row counts stable.
- **[16] budget** — the guard throws before any member runs; agent_runs/team_runs stay empty.
- **[17] no privilege** — every role's permissions ⊆ {READ_MARKET_DATA, READ_RESEARCH_DB, RECOMMEND_ONLY}.

Evidence recorded in 06-verification.md.
