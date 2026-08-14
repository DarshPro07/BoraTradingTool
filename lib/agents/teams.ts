import type { ArtifactKind } from "./artifacts";
import {
  CHIEF_OF_STAFF_V1,
  CRITIC_V1,
  RESEARCHER_V1,
  SOURCE_VERIFIER_V1,
  type AgentDefinition,
} from "./definitions";

/**
 * TeamDefinition — the STATIC, versioned identity of a bounded semantic team.
 *
 * Mirrors AgentDefinition: a TeamRun pins it by version, so changing a team's roles or budget never
 * makes a historical team run irreproducible. The team is a MANAGER pattern — a Chief-of-Staff that
 * coordinates members and synthesizes their artifacts. It is NOT the Brain; it decides nothing about
 * whether work exists, and it holds no privileged authority.
 */

/**
 * The deterministic envelope the Chief-of-Staff operates INSIDE. The CoS cannot widen it — it cannot
 * decide "I need 17 more agents". Values are config on the definition, not constitutional constants.
 */
export interface AgentBudgetPolicy {
  maxAgents: number;
  maxParallel: number;
  maxModelCalls: number;
  maxTokens: number | null;
  maxCost: number | null;
  maxDurationMs: number;
}

/** One model-driven member: which agent it is, what it outputs, and how it is prompted. */
export interface TeamMemberSpec {
  role: string;
  definition: AgentDefinition;
  artifactKind: ArtifactKind;
  systemPrompt: string;
  /** Fields that MUST be present in the parsed output, or the member's output is a CONTRACT_VIOLATION. */
  requiredFields: string[];
}

export interface TeamDefinition {
  teamId: string;
  version: string;
  purpose: string;
  /** The model-driven members, run in parallel over the shared evidence packet. */
  members: readonly TeamMemberSpec[];
  /** The coordinator: builds the plan and synthesizes the artifacts. Deterministic in this slice. */
  chief: AgentDefinition;
  budget: AgentBudgetPolicy;
  coordinationPolicy: "MANAGER";
  verificationPolicy: "SOURCE_VERIFIED";
}

const JSON_ONLY = "You output ONLY a single JSON object and no other text — no markdown fences, no commentary.";
const PACKET_BOUND =
  "You reason over the supplied evidence packet ONLY. You may cite only strings that appear verbatim " +
  "in its citableSources. You never compute an indicator yourself — every number is already in the packet.";

const RESEARCHER: TeamMemberSpec = {
  role: "researcher",
  definition: RESEARCHER_V1,
  artifactKind: "RESEARCH",
  requiredFields: ["thesis", "direction", "rationale", "sources", "confidence"],
  systemPrompt: [
    "You are a securities researcher on a bounded research team.",
    PACKET_BOUND,
    JSON_ONLY,
    "Output shape:",
    '{"thesis": "one testable sentence", "direction": "LONG|SHORT|NEUTRAL", "timeframe": "INTRADAY|SWING|POSITIONAL",',
    '"rationale": "why, citing only supplied features", "requiredFeatures": ["feature_name"],',
    '"sources": ["only strings from citableSources"], "confidence": 0.5, "missingEvidence": ["what you could not establish"]}',
    "If the evidence does not support a directional view, use direction NEUTRAL — abstaining is valid.",
  ].join("\n"),
};

const SOURCE_VERIFIER: TeamMemberSpec = {
  role: "source_verifier",
  definition: SOURCE_VERIFIER_V1,
  artifactKind: "VERIFICATION",
  requiredFields: ["assessment", "concern"],
  systemPrompt: [
    "You are a source and evidence verifier on a bounded research team.",
    PACKET_BOUND,
    "Independently of any thesis, judge whether the packet's evidence could support a directional claim.",
    JSON_ONLY,
    "Output shape:",
    '{"assessment": "STRONG|MODERATE|WEAK", "corroboratingSources": ["strings from citableSources"],',
    '"unsupportedClaims": ["a claim this packet could NOT establish"], "concern": "one sentence: the single biggest evidentiary weakness"}',
  ].join("\n"),
};

const CRITIC: TeamMemberSpec = {
  role: "critic",
  definition: CRITIC_V1,
  artifactKind: "CRITIQUE",
  requiredFields: ["concern"],
  systemPrompt: [
    "You are a skeptical critic on a bounded research team.",
    PACKET_BOUND,
    "Make the STRONGEST case against taking a directional position on this instrument from this evidence.",
    JSON_ONLY,
    "Output shape:",
    '{"weaknesses": ["a specific weakness"], "failureModes": ["how a position here would fail"],',
    '"concern": "one sentence: your single strongest objection"}',
  ].join("\n"),
};

/**
 * The first team. Three model-driven members reason in parallel over one shared evidence packet; the
 * Chief-of-Staff plans and synthesizes. Same capability (RESEARCH) → same model for every member, so
 * this proves TEAM ORCHESTRATION without also exercising multi-provider model selection (a later rung).
 */
export const RESEARCH_TEAM_V1: TeamDefinition = {
  teamId: "research.instrument.team",
  version: "v1",
  purpose: "Deep/conflicted instrument research: propose, independently verify the evidence, and critique — then synthesize with dissent preserved.",
  members: [RESEARCHER, SOURCE_VERIFIER, CRITIC],
  chief: CHIEF_OF_STAFF_V1,
  budget: {
    maxAgents: 4, // three members + the chief coordinator
    maxParallel: 3,
    maxModelCalls: 3, // one per member; the chief synthesizes deterministically in this slice
    maxTokens: null,
    maxCost: null,
    maxDurationMs: 12 * 60_000,
  },
  coordinationPolicy: "MANAGER",
  verificationPolicy: "SOURCE_VERIFIED",
};

const TEAM_REGISTRY: readonly TeamDefinition[] = Object.freeze([RESEARCH_TEAM_V1]);
const TEAM_BY_ID = new Map(TEAM_REGISTRY.map((team) => [team.teamId, team]));

/** Resolve the current definition for a team id. Throws on an unknown id — a run must name a real team. */
export function resolveTeamDefinition(teamId: string): TeamDefinition {
  const team = TEAM_BY_ID.get(teamId);
  if (!team) {
    throw new Error(`TEAM_UNKNOWN: no TeamDefinition registered for "${teamId}". A run must name a real team.`);
  }
  return team;
}

export function listTeamDefinitions(): readonly TeamDefinition[] {
  return TEAM_REGISTRY;
}

/**
 * The DETERMINISTIC decision of whether an instrument_research job runs as a single agent or a team.
 *
 * Kept out of the agent: the agent never decides to escalate itself. A `depth: "deep"` marker on the
 * durable job (owner/schedule-set) — or an explicit `team: true` — forces REQUIRED_TEAM; everything
 * else stays SINGLE, so the verified single-agent path is unchanged (acceptance #1).
 */
export function decideTeamExecution(payload: Record<string, unknown>): "SINGLE" | "REQUIRED_TEAM" {
  if (payload.team === true) return "REQUIRED_TEAM";
  if (payload.depth === "deep") return "REQUIRED_TEAM";
  return "SINGLE";
}
