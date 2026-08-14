# 00 — Status: First Agent Slice (Agent/Team rung 3)

**Feature:** one durable `instrument_research` job that runs a versioned specialist agent through
the existing gateway/bridge and records it in the AgentRun ledger with full provenance — proving the
Job-OS → Agent → Model → Ledger → Event → dependent-wake seam, with all failures routed back to the
Job OS / Dependency Resolver.

**Owner direction:** build the first Agent slice now; AgentDefinition (static, versioned) MUST be
distinct from AgentRun; no team/debate/model-routing yet; agents recommend, deterministic governance
decides; failures return to the dependency grammar.

## Gate progress

- Gate 0 Reality — DONE (01-reality.md)
- Gate 1 Product — DONE (02-product.md)
- Gate 2 Architecture — DONE (03-architecture.md)
- Gate 3 Program Design — DONE (04-program-design.md)
- Gate 4 Vertical Slices — DONE (05-slices.md)
- Gate 5 Independent Verification — IN PROGRESS (independent `verifier` subagent dispatched; 06/07 pending its verdict)

## Evidence so far (self-run, pre-independent-verification)

- Focused acceptance suite `lib/agents/instrument-research.test.ts`: **6 passed**.
- Provenance assertions **proven to bite** by a revert-checked mutation (nulling `jobId` fails the
  success + full-path tests).
- Full vitest suite: **148 files, 1754 passed / 2 skipped**, exit 0.
- `tsc --noEmit`: exit 0.
- MCP integration (`mcp/server.integration.test.ts`): 4 passed; bundle rebuilt on new schema.
- `next build`: exit 0.

## Files changed

New: `lib/agents/definitions.ts`, `lib/agents/runtime.ts`, `lib/agents/instrument-research.test.ts`,
`drizzle/0020_agent_run_provenance.sql`.
Edited: `lib/db/schema.ts`, `lib/db/migrate.ts` (protected — registered 0020),
`lib/runtime/agent-runs.ts`, `lib/research/bridge.ts`, `lib/research/queue.ts`,
`lib/research/worker.ts`.

## Next action

Await the independent verifier verdict → write 06-verification.md + 07-final.md → update
`docs/autonomous-build/WORK_QUEUE.md` (first agent slice done; Job OS Core Mechanics:
VERIFIED_INTEGRATION) → surface the result to the owner. Deferred to owner steer: Chief-of-Staff /
team layer, then 1-5 model routing.
