# Gate 3 — Program Design (Team OS)

## Files (see 03-architecture.md for the full table)

New: `teams.ts`, `team-runtime.ts`, `team-runs.ts`, `artifacts.ts`, `team.test.ts`, `0021_team_os.sql`.
Edited: `definitions.ts`, `schema.ts`, `migrate.ts`, `agent-runs.ts`, `worker.ts`.

## Types and contracts

```
AgentBudgetPolicy { maxAgents; maxParallel; maxModelCalls; maxTokens|null; maxCost|null; maxDurationMs }
TeamMemberSpec    { role; definition: AgentDefinition; artifactKind; systemPrompt; requiredFields[] }
TeamDefinition    { teamId; version; purpose; members[]; chief; budget; coordinationPolicy:"MANAGER"; verificationPolicy:"SOURCE_VERIFIED" }
TeamExecutionPlan { objective; roles[]; tasks[]; parallelGroups[][]; artifactContracts[]; stopConditions[]; budget }
TeamResult        { conclusion; supportingEvidence[]; contradictoryEvidence[]; unresolvedQuestions[];
                    dissent:{role,concern}[]; confidenceBasis; recommendation }
AgentArtifact     { id; teamRunId; jobId; role; kind; agentRunId; content:{}; createdAt }
resolveTeamDefinition(id) -> TeamDefinition  // throws TEAM_UNKNOWN
decideTeamExecution(payload) -> "SINGLE" | "REQUIRED_TEAM"   // team:true | depth:"deep" → team
runInstrumentResearchTeam(instrumentId, jobId, deps?) -> TeamResearchOutcome
  deps = { team?, buildPacket?, runMember? }   // injection seam for tests
```

## Call flow (REQUIRED_TEAM)

worker.case instrument_research → decideTeamExecution = REQUIRED_TEAM → runInstrumentResearchTeam:
1. resolve TeamDefinition (throws TEAM_UNKNOWN on miss).
2. budget pre-guard: members.length ≤ maxAgents-1 and ≤ maxModelCalls, else throw TEAM_BUDGET_EXCEEDED.
3. buildEvidencePacket once. NO_STORED_DATA → defer (ingest + dependent deep job); other failure → throw.
4. deterministic teamRunId = tmr_sha(jobId|teamId|version|instrument); createTeamRun(RUNNING) + persist plan (same write).
5. members run via mapWithLimit(maxParallel): each records an AgentRun (COMPLETED/FAILED, teamRunId) and, on success, a persisted artifact (deterministic ids).
6. any member failed → failTeamRun + throw coded(firstFailure.code) → Job OS taxonomy.
7. all ok → deterministic synthesis: platform citation check → TeamResult (dissent from verifier+critic) → chief AgentRun (provider "deterministic") + SYNTHESIS artifact → completeTeamRun → emit RESEARCH_COMPLETED once → return outcome.

## State transitions

TeamRun: RUNNING → COMPLETED | FAILED. Job: queued→running→succeeded | failed→retry/dead (Job OS owns it).
AgentRun (each member/chief): single terminal COMPLETED/FAILED, deterministic id → idempotent.

## Error model

`coded(code,message)` throws `Error("CODE: message")` for the queue's taxonomy. CONTRACT_VIOLATION for
a member that does not return the contracted JSON/fields; the provider's own code (e.g. AGENT_UNAVAILABLE)
for a gateway refusal; TEAM_BUDGET_EXCEEDED for the budget guard; NO_STORED_DATA defers, never throws.

## Test design → the 17 acceptance cases

`lib/agents/team.test.ts` (10 tests). Direct orchestration (injected member runner): [2,3,4,5,7,8,9]
happy, [6] overlap, [16] budget, [13] provider-fail, [15] idempotent. Static: [17] no-privilege.
Full-path through runWorker (gateway mocked): [1] single-unchanged, [2,10,11,12] deep end-to-end,
[14] invalid→CONTRACT_VIOLATION, [13] provider-fail→dead. Known-failure-mode of each critical
assertion documented in 05-slices.md; dissent-survival proven to BITE by a revert-checked mutation.

## Least-confident decisions

- **Deterministic synthesizer.** The chief reconciles by rule (no 4th model call) so dissent survival
  is provable without model variance and the slice isolates team ORCHESTRATION (owner's explicit
  intent). A model-based synthesizer is a later config swap (bump the TeamDefinition version).
- **Members reason over the shared packet independently** (true parallelism) rather than the Verifier/
  Critic consuming the Researcher's thesis (which would serialize them). The synthesizer reconciles.
- **Crash-retry re-runs members** (idempotent by deterministic id) rather than checkpoint-resuming
  completed members — "cannot duplicate" is proven; "does not re-execute" is a later optimization.

## Rollback

Delete `lib/agents/{teams,team-runtime,team-runs,artifacts,team.test}.ts`; revert the worker branch,
`definitions.ts` roles + teamPolicy, `agent-runs.ts` teamRunId, `schema.ts` tables. Migration 0021 is
additive (new tables + nullable column) — safe to leave applied. No data migration.
