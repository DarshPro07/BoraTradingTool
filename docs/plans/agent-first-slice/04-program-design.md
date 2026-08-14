# Gate 3 — Program Design

## Files

| File | Change | Why |
|---|---|---|
| `drizzle/0020_agent_run_provenance.sql` | NEW | 3 nullable columns on agent_runs |
| `lib/db/schema.ts` | agentRuns += agentId/agentVersion/jobId | drizzle mapping |
| `lib/db/migrate.ts` (protected) | register "0020_agent_run_provenance.sql" | applied via MIGRATIONS array |
| `lib/runtime/agent-runs.ts` | RecordAgentRunInput += optional provenance; insert values | ledger carries provenance |
| `lib/agents/definitions.ts` | NEW | static versioned AgentDefinition + RESEARCH_INSTRUMENT_V1 |
| `lib/agents/runtime.ts` | NEW | runInstrumentResearch handler |
| `lib/research/bridge.ts` | researchInstrument gains `record?`; BridgeResult failure carries provider/model/tokens/cost | avoid double-record; keep failure provenance |
| `lib/research/queue.ts` | JOB_KINDS += "instrument_research" | durable kind exists |
| `lib/research/worker.ts` | case "instrument_research" | wire kind → handler |
| `lib/agents/instrument-research.test.ts` | NEW | §15 acceptance |

## Types and contracts

```
type AgentPermission = "READ_MARKET_DATA" | "READ_RESEARCH_DB" | "RECOMMEND_ONLY";
type TeamPolicy = "SINGLE" | "OPTIONAL_TEAM" | "REQUIRED_TEAM";
interface AgentDefinition {
  agentId; version; name; role; description;
  capabilities: readonly string[]; allowedTools: readonly string[];
  permissions: readonly AgentPermission[];
  gatewayCapability; defaultModelProfile;
  maxCost|null; maxTokens|null; maxDurationMs|null;
  teamPolicy; criticRequired; verificationPolicy: "SOURCE_VERIFIED" | "NONE";
}
resolveAgentDefinition(agentId): AgentDefinition   // throws AGENT_UNKNOWN
type ResearchCore = (instrumentId: string) => Promise<BridgeResult>;
interface InstrumentResearchOutcome { ok; agentRunId; agentId; agentVersion; instrumentId; verification; deferred? }
```

## Call flow (happy path)

worker.claimNextJob → runJob(case instrument_research) → runInstrumentResearch(id, job.id)
→ resolveAgentDefinition("research.instrument")
→ research core = defaultResearchCore → import bridge → researchInstrument(id, {record:false})
→ (bridge) buildEvidencePacket → detectProviders → runAgent → verifyProposalSources → envelope
→ (handler) recordAgentRun{ status:COMPLETED, agentId, agentVersion, jobId, trigger:LEARNING, envelope }
→ return outcome → completeJob → emit JOB_COMPLETED → unblockDependents → dependent claimable.

## State transitions

Job: queued→running→succeeded (happy / deferred) | failed→(retry|dead).
Dependent: waiting_dependency → queued (on parent success) → running → succeeded.
AgentRun: single terminal row per attempt — COMPLETED | REFUSED | FAILED.

## Error model

`coded(code, message)` → `Error("<CODE>: <message>")`, so the queue's failure taxonomy classifies by
prefix (PERMANENT dies; RETRYABLE backs off). NO_STORED_DATA is NOT thrown — it defers via the
dependency resolver. Every non-happy path still writes an AgentRun first, so nothing fails silently.

## Test design (lib/agents/instrument-research.test.ts)

Handler-logic (injected fake core, deterministic — no model, no network):
1. success → AgentRun COMPLETED with agentId/version/jobId; verificationStatus derived from envelope.
2. provider failure (AGENT_TIMEOUT) → FAILED row + THROWS /AGENT_TIMEOUT/.
3. CONTRACT_VIOLATION → FAILED row + throws.
4. INSTRUMENT_UNKNOWN → REFUSED row + throws (permanent).
5. NO_STORED_DATA → REFUSED row + ingest_history job + dependent instrument_research (waiting_dependency); outcome.deferred set.

Full path (mock ONLY the gateway; real bridge runs):
6. seed 70 daily bars + mock runAgent → enqueue instrument_research + a dependent memory_validate →
   drain → gateway called exactly once, both jobs succeeded, AgentRun COMPLETED linked to jobId with
   verificationStatus SOURCE_VERIFIED, RESEARCH_COMPLETED emitted.

### Known failure mode each critical assertion guards
- Provenance (agentId/version/jobId): a run that records without provenance = irreproducible history.
  PROVEN TO BITE — nulling `jobId` in the handler fails tests #1 and #6 (mutation run, then reverted).
- gateway-called-once: a double-invoke would double-spend a real model call.
- dependent wake: the whole continuous-chain premise (no owner clicks Next).
- NO_STORED_DATA deferral: proves failures route to the dependency grammar, not a blind retry loop.

## Playwright journeys

None — this slice has no UI surface. Acceptance is the durable-job integration test above.

## Least-confident decisions

- Mocking strategy: hoisted `vi.mock` of the gateway is required because the worker's import chain
  pulls the real gateway before any in-test `vi.doMock` — an unmocked run spawns the CLI and times
  out. (Discovered empirically; the first attempt timed out at 30s.)
- Seeding: the bridge reads DAILY bars, so the full-path test seeds resolution "D" directly via
  persistCandles rather than the TEST_MODE provider path.

## Rollback

Delete `lib/agents/*`, revert the worker `case`, remove `"instrument_research"` from JOB_KINDS,
revert the bridge `record` flag and agent-runs provenance fields. Migration 0020 is additive and
nullable — it can stay applied harmlessly, or a 0021 could drop the columns. No data migration.
