# Gate 2/3 — Architecture + Program Design (Team OS)

## The separation that is non-negotiable

```
BRAIN KERNEL (deterministic authority) — decides work EXISTS
        │
     JOB OS — owns lifecycle: lease/retry/dependency/dedupe/wake
        │  case "instrument_research"
        ▼
  decideTeamExecution(payload)  ── deterministic ──▶ SINGLE ▶ runInstrumentResearch  (UNCHANGED)
        │ REQUIRED_TEAM
        ▼
  Chief-of-Staff (lib/agents/team-runtime.ts)  — coordinates a BOUNDED semantic team only
        │  build shared EvidencePacket ONCE (reused across roles)
        │  create TeamRun (pins versioned TeamDefinition) + persist TeamExecutionPlan
        ▼
  parallel members (same model, role-specific systemPrompt), each within AgentBudgetPolicy
        ├─ Researcher     → AgentRun + ResearchArtifact
        ├─ Source Verifier→ AgentRun + VerificationArtifact   (reuses verifyProposalSources)
        └─ Critic         → AgentRun + CritiqueArtifact
        ▼
  Synthesizer (CoS) — consumes ARTIFACT IDs (never copied transcripts)
        ▼
  TeamResult { conclusion, supportingEvidence[], contradictoryEvidence[], unresolvedQuestions[],
               dissent[], confidenceBasis }   — dissent preserved
        ▼
  Job OS: job succeeds ONCE → RESEARCH_COMPLETED once → dependent wakes
```

CoS holds no privileged authority: its strongest output is a `recommendation` (e.g.
`GENERATE_STRATEGY_CANDIDATE`) that a later Job/Brain may act on. It never spends a trial, places an
order, or mutates governance/risk.

## New files

| File | Purpose |
|---|---|
| `lib/agents/teams.ts` | `TeamDefinition` (static/versioned) + `RESEARCH_TEAM_V1` + `AgentBudgetPolicy` + role→AgentDefinition map + `resolveTeamDefinition` + `decideTeamExecution(payload)` |
| `lib/agents/artifacts.ts` | `AgentArtifact` type + `recordArtifact` / `getArtifact` / `listArtifactsForTeamRun` |
| `lib/agents/team-runs.ts` | TeamRun ledger + `TeamExecutionPlan` persistence + `TeamResult` type: `createTeamRun` / `persistPlan` / `completeTeamRun` / `failTeamRun` / `getTeamRun` |
| `lib/agents/team-runtime.ts` | `runInstrumentResearchTeam(instrumentId, jobId, deps?)` — the Chief-of-Staff orchestration; `deps` injects the gateway/core for tests |
| `lib/agents/team.test.ts` | the 17-point acceptance suite |
| `drizzle/0021_team_os.sql` | new tables + `team_run_id` on agent_runs |

## Edited files

| File | Change |
|---|---|
| `lib/agents/definitions.ts` | add role AgentDefinitions (chief_of_staff, researcher, source_verifier, critic — all READ+RECOMMEND_ONLY); set `RESEARCH_INSTRUMENT_V1.teamPolicy = "OPTIONAL_TEAM"` |
| `lib/db/schema.ts` | `teamRuns`, `agentArtifacts` tables; `agentRuns.teamRunId` (nullable) |
| `lib/db/migrate.ts` (protected) | register `0021_team_os.sql` |
| `lib/runtime/agent-runs.ts` | `recordAgentRun` accepts optional `teamRunId` |
| `lib/research/worker.ts` | `case "instrument_research"` branches via `decideTeamExecution` |

## Schema (migration 0021 — additive; new tables + one nullable column)

```
team_runs(
  id TEXT PK, team_id TEXT, team_version TEXT, job_id INTEGER, instrument_id TEXT,
  status TEXT,                    -- RUNNING | COMPLETED | FAILED
  chief_agent_run_id TEXT,
  member_agent_run_ids TEXT,      -- JSON string[]
  artifact_ids TEXT,              -- JSON string[]
  plan TEXT,                      -- JSON TeamExecutionPlan (persisted before members run)
  result TEXT,                    -- JSON TeamResult (dissent preserved)
  tokens INTEGER, cost REAL, cost_currency TEXT,
  error TEXT,
  started_at INTEGER, completed_at INTEGER )

agent_artifacts(
  id TEXT PK, team_run_id TEXT, job_id INTEGER, role TEXT, kind TEXT,
  agent_run_id TEXT,             -- the member run that produced it
  content TEXT,                  -- JSON structured artifact (NOT chat)
  created_at INTEGER )

ALTER TABLE agent_runs ADD COLUMN team_run_id TEXT;   -- member/chief runs point back; NULL for solo
```

## Types

```
type TeamPolicy = "SINGLE" | "OPTIONAL_TEAM" | "REQUIRED_TEAM"   // reused from definitions.ts
interface AgentBudgetPolicy { maxAgents; maxParallel; maxModelCalls; maxTokens|null; maxCost|null; maxDurationMs }
interface TeamRole { role; agentId; capability; systemPrompt(packet); artifactKind }
interface TeamDefinition { teamId; version; purpose; allowedRoles[]; budget: AgentBudgetPolicy;
                           coordinationPolicy: "MANAGER"; verificationPolicy: "SOURCE_VERIFIED" }
interface TeamExecutionPlan { objective; roles[]; tasks[]; parallelGroups[][]; artifactContracts[]; stopConditions; budget }
interface AgentArtifact { id; teamRunId; jobId; role; kind; agentRunId; content; createdAt }
interface TeamResult { conclusion; supportingEvidence[]; contradictoryEvidence[];
                       unresolvedQuestions[]; dissent: {role,concern}[]; confidenceBasis;
                       recommendation: "GENERATE_STRATEGY_CANDIDATE" | "ABSTAIN" | ... }
```

## Call flow (REQUIRED_TEAM)

1. worker `case instrument_research` → `decideTeamExecution(payload)` = REQUIRED_TEAM → `runInstrumentResearchTeam(id, jobId)`.
2. `resolveTeamDefinition("research.instrument.team")` (throws TEAM_UNKNOWN on miss).
3. `buildEvidencePacket(id)` — one shared packet. If NO_STORED_DATA → defer via dependency grammar
   (same as single path), record nothing privileged.
4. `createTeamRun` (RUNNING, pins teamId+version, jobId) → `persistPlan(TeamExecutionPlan)` BEFORE any member runs.
5. `detectProviders()` once; run the 3 members via `parallel`-style `Promise.all` (bounded by
   `maxParallel`), each: `runAgent(role.systemPrompt, packet)` → parse structured output → `recordArtifact`
   + `recordAgentRun(member, status, teamRunId, jobId)`. A member failure → the whole TeamRun fails
   with that member's code (thrown coded → Job OS taxonomy). Invalid member output → CONTRACT_VIOLATION.
6. Synthesizer (CoS) reads the artifacts BY ID → `TeamResult` (dissent from the Critic/Verifier
   preserved) → `recordAgentRun(chief, COMPLETED, teamRunId)` → `completeTeamRun(result)`.
7. Return an outcome the worker maps to job success. The team path emits `RESEARCH_COMPLETED` exactly
   once (guarded so a synthesis retry cannot double-emit).

## Idempotency / crash-recovery (acceptance 15)

Each member's AgentRun id is deterministic: `sha256(teamRunId|role|instrumentId)` — a re-run after a
crash reuses the id, so a completed member cannot be logically duplicated. On restart the Job OS
re-claims the job; a TeamRun left RUNNING is reconciled (its completed member artifacts are reused by
id, incomplete members re-run). First slice proves the deterministic-id guard; full lease-reclaim
reuses the existing job lease machinery.

## Failure model (acceptance 13/14) — reuses the existing grammar

- provider unavailable → member AgentRun FAILED → TeamRun FAILED → handler throws `coded(code)` →
  Job OS retry/dead. No TeamRetryLoop.
- invalid structured member output → `CONTRACT_VIOLATION` (same code the bridge uses).
- NO_STORED_DATA (shared packet) → deferral via `resolveDataRequirement` + dependent job (single-path parity).

## Budget (acceptance 16)

`AgentBudgetPolicy` is on the `TeamDefinition` (deterministic, not CoS-chosen). The runtime refuses to
start more than `maxAgents` roles or more than `maxModelCalls`; exceeding `maxTokens`/`maxCost`/
`maxDurationMs` fails the TeamRun with `TEAM_BUDGET_EXCEEDED`. CoS cannot widen its own envelope.

## No privileged authority (acceptance 17)

Every role AgentDefinition has `permissions ⊆ {READ_MARKET_DATA, READ_RESEARCH_DB, RECOMMEND_ONLY}` —
enforced by the `AgentPermission` type (no privileged value exists to assign). A test asserts every
`allowedRoles` definition carries no permission outside that set.

## Alternatives considered

- **CoS as a new authority that can enqueue/spend** — rejected; violates the Brain/Job-OS separation.
- **Agents exchanging chat history** — rejected; artifacts-by-id is the owner's explicit rule (tokens,
  reproducibility, crash recovery, knowledge-graph integration).
- **A generic team dispatcher keyed on payload agentId** — deferred; one concrete team proves the seam.
