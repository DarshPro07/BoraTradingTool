# Gate 2 — Architecture

## Current architecture this fits into

```
Owner / Schedule / Dependency resolution
        │  enqueue({ kind: "instrument_research", payload: { instrumentId } })
        ▼
  Durable Job OS  (queue.ts leases/deps/dedupe/failure-taxonomy · worker.ts kind→handler)
        │  claim → runJob(job)
        ▼
  Agent Runtime  (lib/agents/runtime.ts)  ← resolves AgentDefinition (lib/agents/definitions.ts)
        │  research core (injectable; default = bridge)
        ▼
  Research Bridge (lib/research/bridge.ts, record:false)
        │  evidence packet → gateway → verify citations → envelope
        ▼
  Agent Gateway (lib/runtime/gateway.ts)  → headless claude-code (or refusal)
        │
        ▼
  Ledger: recordAgentRun(provenance)   +   Event bus: RESEARCH_COMPLETED
        │                                        │
   /brain renders                          completeJob → wake dependents
```

Nothing new sits *beside* the Job OS: the Agent Runtime is a WORKER the worker calls, and every
lifecycle concern (retry, lease, dependency, dedupe, timeout, wake) stays owned by the queue.

## Proposed fit — where the new code lives

- **`lib/agents/definitions.ts`** (new) — the STATIC agent contract. `AgentDefinition` = identity
  (agentId + version), capabilities, `allowedTools`, `permissions` (READ/RECOMMEND only),
  `gatewayCapability`, budget ceilings, teamPolicy (SINGLE), verificationPolicy. `RESEARCH_INSTRUMENT_V1`
  is the first entry. `resolveAgentDefinition(id)` throws AGENT_UNKNOWN on a miss.
- **`lib/agents/runtime.ts`** (new) — `runInstrumentResearch(instrumentId, jobId, research?)`. The
  seam. Resolves the definition, calls the research core, records ONE AgentRun with provenance,
  and either returns an outcome or throws a coded error / defers through the dependency grammar.
- **`lib/research/queue.ts`** — `JOB_KINDS += "instrument_research"`.
- **`lib/research/worker.ts`** — `case "instrument_research"` validates the payload and delegates to
  the runtime.
- **`lib/research/bridge.ts`** — `researchInstrument(id, { record })`. `record:false` lets the
  handler own the single ledger write; failures carry provider/model so provenance survives.
- **`lib/runtime/agent-runs.ts` + schema + `drizzle/0020`** — three nullable provenance columns
  (agent_id, agent_version, job_id).

## Data flow

instrumentId (payload) → evidence packet (quant-core computes every feature) → sha256 fingerprint →
model proposal (gateway) → citation verification → `ResearchProposalEnvelope` → AgentRun row
(envelope JSON + provenance) → RESEARCH_COMPLETED → dependent jobs claimable.

## Interfaces / contracts

- `AgentDefinition` (readonly fields; immutable by version — bumped, not edited).
- `ResearchCore = (instrumentId) => Promise<BridgeResult>` — the injection seam for tests.
- `InstrumentResearchOutcome { ok, agentRunId, agentId, agentVersion, instrumentId, verification, deferred? }`.
- `RecordAgentRunInput` extended with optional `agentId? / agentVersion? / jobId?` (browser runs keep them null).

## Data / storage

`agent_runs` gains `agent_id TEXT`, `agent_version TEXT`, `job_id INTEGER`, all **nullable** — every
existing browser-triggered row keeps NULL; only durable-job runs carry the trio. Additive migration
`0020`, registered in the protected `MIGRATIONS` array. No applied migration edited.

## State machine (per durable job)

`queued → running → (succeeded | failed→retry/backoff | dead)`; a NO_STORED_DATA outcome makes the
current job **succeed as deferred** while a new `ingest_history` job + a dependent `instrument_research`
job carry the work forward (`waiting_dependency → queued` on ingestion success).

## Failure paths

| Failure | AgentRun | Job OS effect |
|---|---|---|
| provider down / timeout | FAILED (provider recorded) | handler throws coded error → retry/backoff |
| invalid model output | FAILED (CONTRACT_VIOLATION) | throws → retry (or dead at maxAttempts) |
| INSTRUMENT_UNKNOWN | REFUSED | throws → PERMANENT taxonomy kills it |
| NO_STORED_DATA | REFUSED | defers: ingest + dependent research enqueued; job succeeds |

## Security / trust boundary

The agent holds READ_MARKET_DATA, READ_RESEARCH_DB, RECOMMEND_ONLY — nothing else. It cannot reach
the Trial Budget Governor, the paper engine, or `/api/trade/place` (still EXECUTION_ADAPTER_MISSING).
`MARKETPULSE_AGENT_TOKEN` still grants no owner authority. The gateway still spawns only the licensed
local binary; no consumer token is lifted into the app.

## Observability

Every run — success OR refusal — is one AgentRun row rendered on /brain, now carrying which agent,
which version, which job. The bridge still emits RESEARCH_STARTED / EVIDENCE_PACKET_BUILT /
CITATIONS_VERIFIED / RESEARCH_COMPLETED|FAILED regardless of `record`.

## Compatibility

Additive only. Existing `POST /api/research/stock` path is untouched (still records with trigger
USER, provenance NULL). No consumer of `recordAgentRun` had to change (new fields optional).

## Alternatives considered

- **Bridge records the durable run itself** — rejected: the bridge has no AgentDefinition or jobId,
  so provenance would be lost; and it would double-record. The `record` flag + handler-owned write is
  the smaller correct seam.
- **Copy the prompt into the AgentRun** — rejected: that is exactly the irreproducibility trap. Pin
  by version instead.
- **A generic `agent` kind with an agentId in the payload** — deferred: one concrete kind is enough
  to prove the seam; the generic dispatch belongs with the Chief-of-Staff layer.

## Architecture risks

- If a future definition edits `RESEARCH_INSTRUMENT_V1` in place instead of adding v2, historical
  provenance would point at a changed contract. Mitigated by the doc-comment rule + readonly fields;
  a lint/registry check is a later hardening.
