# Gate 4 — Vertical Slices

Built end-to-end, not horizontally. Each slice below was completed and left the suite green before
the next began.

## Slice 1 — schema + ledger provenance (tracer)

`drizzle/0020` (agent_id/agent_version/job_id, all nullable) → schema.ts → migrate.ts registration →
`RecordAgentRunInput` optional provenance + insert values. Verified: tsc clean; existing agent-runs
consumers unchanged (fields optional); every prior AgentRun row keeps NULL. This established the
real end-to-end persistence path the rest of the slice writes into.

## Slice 2 — the static AgentDefinition contract

`lib/agents/definitions.ts`: `AgentDefinition` (readonly, versioned) + `RESEARCH_INSTRUMENT_V1`
(READ + RECOMMEND_ONLY, gatewayCapability RESEARCH, teamPolicy SINGLE, verificationPolicy
SOURCE_VERIFIED) + `resolveAgentDefinition` (throws AGENT_UNKNOWN). This is the "what it was" that
every run pins by version. Verified: tsc clean; `Object.freeze` on the literal removed because it
widened `permissions` to `string[]` (TS2322) — readonly interface fields carry the immutability.

## Slice 3 — the handler (real happy path + failure mappings)

`lib/agents/runtime.ts` `runInstrumentResearch`: resolves the definition, calls an injectable
research core (default = real bridge with `record:false`), records ONE AgentRun with provenance,
and maps outcomes:
- success → COMPLETED + outcome;
- provider/contract failure → FAILED + coded throw (Job OS retry);
- INSTRUMENT_UNKNOWN → REFUSED + throw (kill);
- NO_STORED_DATA → REFUSED + `resolveDataRequirement` (ingest) + dependent research job → deferred.
Plus the `record` flag on the bridge and the enriched failure variant (provider/model survive).
Verified: tsc clean.

## Slice 4 — wire the durable kind

`JOB_KINDS += "instrument_research"` (queue.ts) + `case "instrument_research"` (worker.ts) that
validates the payload and delegates to the handler. Verified: tsc clean; the queue can now carry
agent work.

## Slice 5 — acceptance (owner §15) + verification

`lib/agents/instrument-research.test.ts`: 5 handler-logic tests (injected fake core) + 1 full-path
test (real bridge, gateway mocked). After each slice the focused suite and full regression ran.

Evidence recorded in 06-verification.md.

## What each slice deliberately did NOT add

No team layer, no debate, no model routing, no second agent, no privileged capability, no UI. Those
are named as later rungs and are out of scope for the first slice by owner direction.
