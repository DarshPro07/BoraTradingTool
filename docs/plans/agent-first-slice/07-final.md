# 07 — Final Verdict

## Verdict: VERIFIED

The first Agent slice (Agent/Team rung 3) is complete and independently verified.

## Objective

Prove the autonomous seam **Job OS → versioned specialist Agent → Model → AgentRun ledger →
event → dependent-job wake**, with every failure routed back to the Job OS / Dependency Resolver,
and with an agent that recommends but holds no privileged capability — as the foundation the
Chief-of-Staff/team layer and 1-5 model routing will later build on.

## Architecture

The Agent Runtime (`lib/agents/runtime.ts`) is a WORKER the durable worker calls. It resolves a
STATIC, versioned `AgentDefinition` (`lib/agents/definitions.ts`), invokes the existing
gateway/bridge once, and records ONE `AgentRun` with provenance. Lifecycle (retry/lease/dependency/
dedupe/wake) stays owned by the Job OS. The AgentRun pins the definition by version, never by copying
the prompt — so a future prompt change cannot make historical runs irreproducible.

## Implementation summary

- `AgentDefinition` (versioned identity, READ + RECOMMEND_ONLY permissions, SINGLE team policy,
  SOURCE_VERIFIED verification) + `RESEARCH_INSTRUMENT_V1` + `resolveAgentDefinition`.
- `runInstrumentResearch` handler: success → COMPLETED AgentRun (agentId+version+jobId); failure →
  FAILED/REFUSED AgentRun + coded throw (Job OS taxonomy) or deferral through the dependency grammar.
- `instrument_research` durable kind wired queue → worker → handler.
- Bridge `record` flag (durable path records once, in the handler) + failure provenance carried on
  `BridgeResult`.
- `agent_runs` provenance columns (agent_id/agent_version/job_id, nullable) via additive migration
  `0020`, registered in the protected MIGRATIONS array.

## Files changed

New: `lib/agents/definitions.ts`, `lib/agents/runtime.ts`, `lib/agents/instrument-research.test.ts`,
`drizzle/0020_agent_run_provenance.sql`.
Edited: `lib/db/schema.ts`, `lib/db/migrate.ts` (protected), `lib/runtime/agent-runs.ts`,
`lib/research/bridge.ts`, `lib/research/queue.ts`, `lib/research/worker.ts`.

## Tests executed — exact results

- Focused acceptance `lib/agents/instrument-research.test.ts`: **7 passed** (5 handler-logic +
  2 full-path incl. the worker-failure integration).
- Provenance assertions proven non-vacuous by a revert-checked mutation (nulling `jobId` fails the
  success + full-path tests).
- `tsc --noEmit`: exit 0 (twice — after implementation, and after the gap-closing test additions).
- Full vitest suite: independent verifier's fresh run **149 files / 1758 passed / 2 skipped**, and a
  confirmatory run after the two test-only gap-closing additions **1755 passed / 2 skipped, exit 0**
  (the small absolute-count differences are run/environment counting, not failures — both are green).
- MCP integration (`mcp/server.integration.test.ts`): 4 passed; bundle rebuilt on new schema.
- `next build`: exit 0.

## Independent verification

A `verifier` subagent (fresh context, Write disabled) returned VERIFIED / 0 blockers, confirming all
five §15 items with non-tautological evidence and the AgentDefinition≠AgentRun / no-double-record /
no-privileged-capability invariants by full code reading. Its two non-blocking coverage gaps
(success-path provider/model assertion; a worker-driven failure integration) were CLOSED and
re-verified (7/7). Detail in 06-verification.md.

## Failures encountered during build (all resolved)

- First full-path attempt timed out 30s — the worker's eager import loaded the real gateway before an
  in-test `vi.doMock`. Fixed by a hoisted `vi.mock` of the gateway.
- NO_STORED_DATA test initially found no ingest job — RELIANCE was not `known` without a seeded NSE
  master. Fixed by seeding a master row for RELIANCE (mirroring `security-master.test-fixture.ts`).
- Seeding via `applyNseSecurityMasterSync` collided with the TEST_MODE auto-bootstrap's sync date in
  the full-path describe; dropped the redundant explicit seed there (the bridge resolves the id by
  syntax regardless).

## Unresolved limitations

- No UI surfacing of agent identity yet (the AgentRun ledger renders on /brain; the new provenance
  columns are not yet shown). Non-blocking, small, later.
- One specialist, SINGLE team policy — the Chief-of-Staff/team layer and 1-5 model routing are
  deliberately out of scope, deferred to owner steer.

## Rollback

Delete `lib/agents/*`, revert the worker `case`, remove `"instrument_research"` from JOB_KINDS,
revert the bridge `record` flag and the agent-runs provenance fields. Migration `0020` is additive
and nullable — safe to leave applied, or drop via a new migration. No data migration.

## Readiness

**VERIFIED** for the first Agent slice. The wider system remains PARTIALLY_VERIFIED (team layer,
model routing, and the rest of the durable quant chain are still ahead). Owner's status wording:
**Job OS Core Mechanics — VERIFIED_INTEGRATION**, not "complete".
