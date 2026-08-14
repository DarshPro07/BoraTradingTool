/**
 * AgentDefinition — the STATIC, versioned identity of a specialist agent.
 *
 * Deliberately distinct from `AgentRun` (one execution, `lib/runtime/agent-runs.ts`). Changing an
 * agent's prompt or its guardrails MUST NOT make historical runs impossible to reproduce, so the
 * mutable "what it did" (AgentRun) records the immutable "what it was" by version (`agentId` +
 * `version`), never by copying the prompt into the run. A definition is bumped, not edited in place.
 *
 * The runtime constraints (owner architecture, rung 3):
 *   - Brain + Job OS remain authoritative. A definition describes a WORKER, not a decision-maker.
 *   - An agent may NEVER invoke a privileged quant action (spend a trial, place a paper order). It
 *     produces a structured result and RECOMMENDS; deterministic governance decides. That is why
 *     `permissions` is a small READ/recommend allowlist here, and why `research.instrument.v1`
 *     carries only READ capabilities.
 *   - The budget/limits are the agent's own ceiling; the Job OS still owns retry/lease/timeout.
 */

export type AgentPermission = "READ_MARKET_DATA" | "READ_RESEARCH_DB" | "RECOMMEND_ONLY";

/**
 * Whether a job may escalate this agent into a coordinated team. SINGLE for the first slice —
 * the Chief-of-Staff / team layer is deliberately NOT built yet. Kept on the definition so the
 * later team layer reads a declared policy rather than guessing.
 */
export type TeamPolicy = "SINGLE" | "OPTIONAL_TEAM" | "REQUIRED_TEAM";

export interface AgentDefinition {
  /** Stable identity across versions, e.g. "research.instrument". */
  agentId: string;
  /** Immutable version of THIS definition. A prompt/guardrail change bumps it. */
  version: string;
  name: string;
  role: string;
  description: string;

  /** Capability aliases the gateway routes on (never a vendor). */
  capabilities: readonly string[];
  /** Tools the agent may use. Empty = reasons over supplied evidence only (the bridge's bound). */
  allowedTools: readonly string[];
  /** What the agent may touch. Never a privileged mutation — it recommends, governance decides. */
  permissions: readonly AgentPermission[];

  /** The capability the gateway is asked to route (`runAgent({ capability })`). */
  gatewayCapability: string;
  /** The routing profile family (`SUBSCRIPTION_FIRST`, …). Model ROUTING itself is a later rung. */
  defaultModelProfile: string;

  /** The agent's own ceilings. The Job OS still owns retry/lease/timeout independently. */
  maxCost: number | null;
  maxTokens: number | null;
  maxDurationMs: number | null;

  teamPolicy: TeamPolicy;
  criticRequired: boolean;
  /** How a run's output is trusted. "SOURCE_VERIFIED" = the bridge's citation check must pass. */
  verificationPolicy: "SOURCE_VERIFIED" | "NONE";
}

/**
 * The first specialist. It routes RESEARCH through the existing gateway/bridge, which reasons over
 * MarketPulse's own deterministic evidence packet and returns a citation-verified proposal. It
 * spends nothing, places nothing, and validates nothing — it proposes a research thesis.
 */
export const RESEARCH_INSTRUMENT_V1: AgentDefinition = {
  agentId: "research.instrument",
  version: "v1",
  name: "Instrument Researcher",
  role: "Reason over an instrument's deterministic evidence packet and propose a testable thesis.",
  description:
    "Routes the RESEARCH capability through the Agent Gateway. The quant core computes every " +
    "feature; the model interprets and proposes; MarketPulse verifies every citation. Recommends " +
    "READY_FOR_VALIDATION at most — it never spends a trial or places an order.",
  capabilities: ["research.instrument", "research.claims", "research.evidence"],
  allowedTools: [],
  permissions: ["READ_MARKET_DATA", "READ_RESEARCH_DB", "RECOMMEND_ONLY"],
  gatewayCapability: "RESEARCH",
  defaultModelProfile: "SUBSCRIPTION_FIRST",
  maxCost: null,
  maxTokens: null,
  maxDurationMs: 12 * 60_000,
  // OPTIONAL_TEAM: this capability MAY escalate to a bounded team when a durable job asks for depth.
  // The escalation is a deterministic per-job decision (decideTeamExecution), never the agent's.
  teamPolicy: "OPTIONAL_TEAM",
  criticRequired: false,
  verificationPolicy: "SOURCE_VERIFIED",
};

/**
 * The team ROLES for the instrument-research team. Each is an ordinary AgentDefinition — same
 * versioning, same READ + RECOMMEND_ONLY guardrail. They are MEMBERS (teamPolicy SINGLE): a member
 * never spawns its own sub-team. The Chief-of-Staff coordinates; it does not decide that work exists.
 */
function researchRole(agentId: string, name: string, role: string, description: string): AgentDefinition {
  return {
    agentId,
    version: "v1",
    name,
    role,
    description,
    capabilities: ["research.instrument"],
    allowedTools: [],
    // No privileged value can even be assigned — AgentPermission has none. Acceptance #17 holds by type.
    permissions: ["READ_MARKET_DATA", "READ_RESEARCH_DB", "RECOMMEND_ONLY"],
    gatewayCapability: "RESEARCH",
    defaultModelProfile: "SUBSCRIPTION_FIRST",
    maxCost: null,
    maxTokens: null,
    maxDurationMs: 6 * 60_000,
    teamPolicy: "SINGLE",
    criticRequired: false,
    verificationPolicy: "SOURCE_VERIFIED",
  };
}

export const CHIEF_OF_STAFF_V1: AgentDefinition = researchRole(
  "research.role.chief_of_staff",
  "Chief of Staff",
  "Plan a bounded research team, then synthesize its artifacts into a dissent-preserving result.",
  "Coordinates a bounded semantic team: builds and persists the execution plan, then synthesizes the " +
    "members' structured artifacts. It recommends at most (e.g. GENERATE_STRATEGY_CANDIDATE) — it never " +
    "spends a trial, places an order, or mutates governance.",
);

export const RESEARCHER_V1: AgentDefinition = researchRole(
  "research.role.researcher",
  "Researcher",
  "Reason over the shared evidence packet and propose a testable thesis with citations.",
  "Produces a ResearchArtifact — a thesis, direction, and citations over the deterministic packet.",
);

export const SOURCE_VERIFIER_V1: AgentDefinition = researchRole(
  "research.role.source_verifier",
  "Source Verifier",
  "Check every claimed citation against the exact evidence packet that was supplied.",
  "Produces a VerificationArtifact — which citations trace to supplied evidence and which do not.",
);

export const CRITIC_V1: AgentDefinition = researchRole(
  "research.role.critic",
  "Skeptic / Critic",
  "Attack the thesis: name what would break it and what the evidence cannot establish.",
  "Produces a CritiqueArtifact — the strongest case against the thesis, preserved as dissent.",
);

const REGISTRY: readonly AgentDefinition[] = Object.freeze([
  RESEARCH_INSTRUMENT_V1,
  CHIEF_OF_STAFF_V1,
  RESEARCHER_V1,
  SOURCE_VERIFIER_V1,
  CRITIC_V1,
]);

const BY_ID = new Map(REGISTRY.map((definition) => [definition.agentId, definition]));

/** Resolve the current definition for an agent id. Throws on an unknown id — a run must name a real agent. */
export function resolveAgentDefinition(agentId: string): AgentDefinition {
  const definition = BY_ID.get(agentId);
  if (!definition) {
    throw new Error(
      `AGENT_UNKNOWN: no AgentDefinition registered for "${agentId}". A run must name a real agent.`,
    );
  }
  return definition;
}

/** Every registered definition — for a /agents surface or a capability audit. */
export function listAgentDefinitions(): readonly AgentDefinition[] {
  return REGISTRY;
}
