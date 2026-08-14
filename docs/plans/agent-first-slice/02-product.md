# Gate 1 — Product

## User problem

The system can research an instrument only when the owner clicks a button in the browser. There is
no way for the **autonomous operating system** — the Job OS that keeps running with Claude Code
closed — to commission a piece of specialist agent work, run it, and keep an auditable record of
what agent (and what version of it) did what, tied to which durable job.

## User

The owner, as operator of an autonomous quant research system. Secondary: a future Chief-of-Staff
layer that will delegate work to specialist agents and needs a ledger + definition contract to build on.

## Current behavior

`researchInstrument` runs only from `POST /api/research/stock`, records an AgentRun with
`trigger: USER` and no agent identity. The Job OS has no agent-family kind.

## Desired outcome

A durable `instrument_research` job can be enqueued (by the owner, a schedule, or a dependency
resolution) and, with no human present:

1. is claimed by the worker,
2. resolves a **static, versioned AgentDefinition**,
3. invokes the specialist through the existing gateway/bridge exactly once,
4. records an **AgentRun** with full provenance (agentId + version + jobId + trigger),
5. persists the verified research result,
6. emits `RESEARCH_COMPLETED`, which **wakes any dependent job**,
7. and on any failure, returns the work to the Job OS / Dependency Resolver rather than looping.

## Success evidence

- One durable job drives gateway → ledger → event → dependent wake, proven in a test that runs the
  REAL bridge (gateway mocked) — `lib/agents/instrument-research.test.ts`.
- The AgentRun row carries agentId `research.instrument`, version `v1`, and the job id.
- Forced failures behave per the Job OS taxonomy: provider-down → FAILED + coded throw (retry);
  invalid output → FAILED (CONTRACT_VIOLATION); permanent code → REFUSED + kill; missing data →
  REFUSED + ingestion + dependent research enqueued (deferred, not retried).
- Full regression suite, typecheck, MCP suite, and production build all green.

## Failure conditions (feature still wrong if any hold)

- An agent can reach a privileged mutation (trial spend / order). (It cannot — READ + RECOMMEND_ONLY.)
- A prompt change would rewrite or invalidate a historical run. (Prevented: AgentRun pins the
  definition by version, never by copying the prompt.)
- A failure silently disappears or loops forever. (Every outcome is a recorded AgentRun; failures
  throw coded errors the queue classifies, or defer through the dependency grammar.)
- The AgentRun double-records (bridge + handler). (Prevented: bridge called with `record:false`.)

## User journeys

1. **Autonomous research**: dependency/schedule enqueues `instrument_research` → result persisted,
   dependent strategy work wakes. (Proven.)
2. **Missing data**: research an un-ingested instrument → refusal recorded, ingestion + dependent
   research auto-queued, resumes when bars land. (Proven.)
3. **Provider outage**: gateway down → job FAILED, retried under Job OS backoff, visible on /jobs.

## Screens / interaction

None new in this slice. The AgentRun ledger already renders on `/brain`; the provenance columns
enrich it. UI surfacing of agent identity is a later, non-blocking item.

## Non-goals

Chief-of-Staff / team coordination; multi-agent debate; 1-5 model routing; a second specialist;
any new privileged capability; any UI change.
