# Gate 0 — Reality (Agent/Team rung 3, first slice)

Labels: REPRODUCED / STATICALLY_CONFIRMED / OBSERVED / INFERRED.

## What already existed before this slice (the seam we build ON, not around)

- **`lib/runtime/gateway.ts`** — the Agent Gateway. `runAgent({ capability, prompt, systemPrompt,
  profile, detected })` spawns the licensed Claude Code binary in headless mode and returns
  `{ ok, provider, model, text, runId, tokens, cost, costCurrency, startedAt, completedAt,
  fallbackReason }` or a refusal with an attempt trail. `detectProviders()` probes what the
  machine can serve. Only claude-code has an adapter; every other provider reports NOT_DETECTED
  with a reason. STATICALLY_CONFIRMED (gateway.ts:1-45, 419-427 call site in the bridge).
- **`lib/runtime/agent-runs.ts`** — the AgentRun ledger (§28). `recordAgentRun`, `latestResearchRun`,
  `listAgentRuns`. Status COMPLETED|REFUSED|FAILED; trigger USER|SCHEDULE|MARKET_EVENT|LEARNING|
  FAILURE. Refusals recorded with the same weight as completions. STATICALLY_CONFIRMED.
- **`lib/research/bridge.ts`** — `researchInstrument(id)`: evidence packet (quant-core features) →
  fingerprint → `runAgent` → `verifyProposalSources` → typed envelope. Three verification outcomes
  (SOURCE_VERIFIED / CONFLICTED / INSUFFICIENT_EVIDENCE). It recorded its OWN AgentRun with
  trigger USER. STATICALLY_CONFIRMED (bridge.ts:346-559).
- **Durable Job OS** — `lib/research/queue.ts` (leases, dependencies, dedupe, failure taxonomy,
  revival, `enqueueDependent`, `blockDependentsOnFailure`) + `lib/research/worker.ts` (kind →
  handler). REPRODUCED green across 147 files before this slice.
- **Dependency resolver** — `lib/brain/dependency-resolver.ts` `resolveDataRequirement` maps a
  DATA gap to a durable `ingest_history` job with six truthful states. STATICALLY_CONFIRMED.

## The gap this slice closes

The gateway/bridge existed but were reachable **only from the browser** (`POST /api/research/stock`).
Nothing let the **autonomous Job OS** invoke a specialist agent and have its run land in the ledger
with provenance. There was:

- **no AgentDefinition** — no static, versioned identity for a specialist; the bridge's run recorded
  provider/model but never *which agent, which version*. A prompt change would silently make old
  runs irreproducible (the exact "individually correct, wrong model of reality" failure class this
  repo guards against). INFERRED from agent-runs schema pre-0020: no agent_id/agent_version/job_id.
- **no `instrument_research` durable kind** — the queue could not carry agent work at all.
  STATICALLY_CONFIRMED (JOB_KINDS pre-slice had no agent-family entry).

## Constraints taken as ground truth (owner architecture, 16-section directive)

1. Brain + Job OS remain authoritative; an agent is a WORKER, not a decision-maker.
2. One real `instrument_research` durable job first; one specialist agent first.
3. AgentRun ledger mandatory; **AgentDefinition (static, versioned) MUST be distinct from AgentRun**.
4. No team/debate yet; no 1-5 model routing yet.
5. An agent may NEVER invoke a privileged quant action (spend a trial, place an order). It
   RECOMMENDS; deterministic governance decides.
6. All failures return to the existing Dependency Resolver / Job OS — no new bespoke retry loop.
7. Prove crash/retry/idempotency and provenance before declaring the architecture.

## Reality of the guardrails that stay in force

`/api/trade/place` still returns EXECUTION_ADAPTER_MISSING; the agent has READ + RECOMMEND_ONLY
permissions only; the Trial Budget Governor remains the sole trial authorizer (an agent cannot
reach it). STATICALLY_CONFIRMED (this slice adds no privileged capability).
