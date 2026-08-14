# Gate 0 — Reality (Chief-of-Staff / Team OS, rung 3 second leg)

Labels: STATICALLY_CONFIRMED unless noted.

## What exists to build ON (do not rebuild)

- **`lib/agents/definitions.ts`** — `AgentDefinition` (static, versioned) ALREADY carries a
  `teamPolicy: "SINGLE" | "OPTIONAL_TEAM" | "REQUIRED_TEAM"` field. `RESEARCH_INSTRUMENT_V1` is
  currently `SINGLE`. `resolveAgentDefinition` throws AGENT_UNKNOWN on a miss. This is the pattern
  the `TeamDefinition` mirrors.
- **`lib/agents/runtime.ts`** — `runInstrumentResearch(instrumentId, jobId, research?)`: the verified
  single-agent path. Records ONE AgentRun with provenance; failures throw coded errors / defer via
  the dependency grammar. Acceptance #1 (single path unchanged) means this function stays byte-identical.
- **`lib/runtime/gateway.ts`** — `runAgent({ capability, prompt, systemPrompt, profile, detected,
  timeoutMs })` → `AgentRunSuccess | AgentRunFailure`. `detectProviders()` probes availability. The
  team calls `runAgent` once PER ROLE with a role-specific systemPrompt, same profile/model for all.
- **`lib/research/bridge.ts`** — `buildEvidencePacket(instrumentId)` (EXPORTED) → the deterministic
  evidence packet (quant-core features + citable sources). The team builds this ONCE and every role
  reasons over the same packet. `verifyProposalSources(proposal, packet)` (EXPORTED) is reused by the
  Source Verifier role. `researchInstrument` is the single-agent bridge.
- **`lib/runtime/agent-runs.ts`** — `recordAgentRun` (each role = one AgentRun) with provenance
  (agentId/agentVersion/jobId). AgentRunStatus COMPLETED|REFUSED|FAILED; trigger includes LEARNING.
- **Durable Job OS** — `lib/research/queue.ts` + `worker.ts`. The `instrument_research` kind dispatches
  to `runInstrumentResearch`. Failure taxonomy, retry, dedupe, `enqueueDependent`, wake — all owned
  by the queue. Team failures reuse this; NO TeamRetryLoop.
- **Event bus** — `lib/brain/event-bus.ts`. `RESEARCH_COMPLETED` wakes dependents. There are already
  `AGENT_STARTED/AGENT_COMPLETED/AGENT_FAILED` event kinds (unused by the single slice) available for
  team observability.

## What does NOT exist (this leg builds it) — greenfield

- No `TeamDefinition`, `TeamRun`, `TeamExecutionPlan`, or `AgentArtifact` — grep of `schema.ts` for
  team/artifact returned nothing. STATICALLY_CONFIRMED.
- `agent_runs` has no parent/team linkage column. A nullable `team_run_id` will be added (additive,
  same pattern as 0020) so a member/chief run points back to its TeamRun.
- No per-role artifact storage. Owner's core rule: agents exchange **structured persisted artifacts**,
  not chat transcripts.

## Constraints taken as ground truth (owner architecture, this message)

1. Brain decides work exists; Job OS owns lifecycle/retry/deps; **Chief-of-Staff only coordinates a
   bounded semantic team.** CoS is NOT the new Brain.
2. Add four concepts, not a framework: `TeamDefinition` (static/versioned), `TeamRun` (runtime),
   `TeamExecutionPlan` (persisted before members run, not silently rewritten), `AgentArtifact`.
3. First slice reuses `instrument_research` with a deterministic policy: normal → SINGLE (unchanged),
   deep/conflicted → REQUIRED_TEAM.
4. First roles: Chief of Staff, Researcher, Source Verifier, Skeptic/Critic. maxAgents=4. CoS
   synthesizes initially. **Same model for every role** (isolate team orchestration from model routing).
5. Artifacts not chat; Synthesizer consumes artifact IDs, not copied transcripts.
6. **Dissent must survive synthesis**: `TeamResult { conclusion, supportingEvidence[],
   contradictoryEvidence[], unresolvedQuestions[], dissent[], confidenceBasis }`.
7. CoS and every member have NO privileged quant authority (no trial/paper/governance/order). They
   RECOMMEND; deterministic governance decides.
8. Team failures go through the existing Job OS grammar (provider fail / AUTH_REQUIRED /
   CONTRACT_VIOLATION reuse the existing codes). No bespoke retry loop.
9. Deterministic team budget: `AgentBudgetPolicy { maxAgents, maxParallel, maxModelCalls, maxTokens,
   maxCost, maxDuration }`. CoS operates INSIDE the envelope; it cannot spawn unlimited work.
10. Independent members run concurrently; maxTeamSize=4, maxParallel=3 (config, not constitutional).

## The 17 acceptance cases (owner) — the definition of done for this leg

1 single path unchanged · 2 REQUIRED_TEAM → exactly one TeamRun · 3 TeamRun pins versioned
TeamDefinition · 4 CoS persists a TeamExecutionPlan · 5 expected member AgentRuns created · 6 members
overlap in wall-clock · 7 each member output is a persisted artifact · 8 Synthesizer consumes artifact
IDs · 9 dissent survives into TeamResult · 10 job completes exactly once · 11 RESEARCH_COMPLETED once ·
12 dependent wakes · 13 provider failure uses Job OS retry semantics · 14 invalid member output →
CONTRACT_VIOLATION · 15 crash/restart cannot duplicate completed member work · 16 team budget cannot
be exceeded · 17 no member possesses trial/paper/governance mutation authority.
