export type CapabilityClass =
  | "READ"
  | "WRITE_LOCAL"
  | "EXTERNAL_WRITE"
  | "FINANCIAL_MUTATION"
  | "UNKNOWN";

export type Actor = "owner" | "claude_interactive" | "autonomous_worker" | "research_agent";

export type LearningMode = "off" | "observing" | "learning" | "evolving";

export interface AutonomousAction {
  readonly id: string;
  readonly capability: CapabilityClass;
  readonly summary: string;
  readonly minimumMode: LearningMode;
}

export interface ProhibitedAction {
  readonly id: string;
  readonly capability: CapabilityClass;
  readonly reason: string;
}

export type GovernanceDecision =
  | { allowed: true; action: AutonomousAction }
  | { allowed: false; code: GovernanceDenialCode; reason: string };

export type GovernanceDenialCode =
  | "ACTION_PROHIBITED"
  | "ACTION_UNKNOWN"
  | "ACTOR_FORBIDDEN"
  | "MODE_INSUFFICIENT"
  | "CAPABILITY_FORBIDDEN";

const MODE_RANK: Readonly<Record<LearningMode, number>> = Object.freeze({
  off: 0,
  observing: 1,
  learning: 2,
  evolving: 3,
});

/**
 * Actions an autonomous worker may take without a human in the loop.
 * Anything absent from this list is denied by default — see `evaluateAutonomousAction`.
 */
export const AUTONOMOUS_PERMITTED: readonly AutonomousAction[] = Object.freeze([
  { id: "discover_source", capability: "READ", summary: "Discover papers, videos and repositories", minimumMode: "observing" },
  { id: "extract_claim", capability: "WRITE_LOCAL", summary: "Extract claims and code links from a source", minimumMode: "learning" },
  { id: "propose_strategy_spec", capability: "WRITE_LOCAL", summary: "Propose a bounded Strategy DSL specification", minimumMode: "learning" },
  { id: "generate_feature", capability: "WRITE_LOCAL", summary: "Generate a feature implementation", minimumMode: "learning" },
  { id: "write_test", capability: "WRITE_LOCAL", summary: "Write tests for generated code", minimumMode: "learning" },
  { id: "run_historical_replay", capability: "READ", summary: "Run historical replay over stored data", minimumMode: "learning" },
  { id: "run_monte_carlo", capability: "READ", summary: "Run Monte Carlo simulation", minimumMode: "learning" },
  { id: "diagnose_strategy_failure", capability: "READ", summary: "Diagnose why a strategy failed", minimumMode: "learning" },
  { id: "breed_child_strategy", capability: "WRITE_LOCAL", summary: "Generate a safer or simpler child strategy", minimumMode: "evolving" },
  { id: "create_worktree_branch", capability: "WRITE_LOCAL", summary: "Create an isolated git worktree and branch", minimumMode: "evolving" },
  { id: "submit_reviewed_change", capability: "WRITE_LOCAL", summary: "Submit a code change for human review", minimumMode: "evolving" },
  { id: "improve_dashboard_page", capability: "WRITE_LOCAL", summary: "Improve a dashboard page", minimumMode: "evolving" },
  { id: "update_verified_memory", capability: "WRITE_LOCAL", summary: "Write a verified finding to durable memory", minimumMode: "learning" },
  { id: "retire_degraded_strategy", capability: "WRITE_LOCAL", summary: "Retire a strategy whose edge has decayed", minimumMode: "evolving" },
  // `run_gauntlet` is DELIBERATELY ABSENT from this generic allowlist (owner decision 2026-08-14).
  // Spending a permanent statistical trial is treated like spending money: the trial ledger
  // carries the multiple-testing denominator that every future candidate in a family is measured
  // against, so a broad allowlist entry — reachable by any autonomous actor, and soon by an
  // Agent/Team layer — is too coarse an authority for it. The SOLE authorizer of a trial is the
  // deterministic Trial Budget Governor (`lib/strategy/trial-governor.ts`): off by default,
  // enabled only through a dedicated owner-set switch, and never influenced by an LLM.
  {
    id: "research_instrument",
    capability: "READ",
    summary: "Research an NSE instrument: evidence packet, LLM proposal, source verification",
    minimumMode: "learning",
  },
  {
    id: "author_strategy",
    capability: "WRITE_LOCAL",
    summary: "Author a strategy DSL from a research hypothesis",
    minimumMode: "learning",
  },
  {
    id: "run_backtest",
    capability: "READ",
    summary: "Run a backtest for a strategy against canonical store data",
    minimumMode: "learning",
  },
]);

/**
 * Actions no autonomous actor may ever take, in any mode.
 * These are enforced by tests and by the pre-tool-use hook, not by prompt instruction.
 */
export const AUTONOMOUS_PROHIBITED: readonly ProhibitedAction[] = Object.freeze([
  { id: "modify_risk_kernel", capability: "WRITE_LOCAL", reason: "The risk kernel is the last line of defence and changes only under human review." },
  { id: "change_loss_ceiling", capability: "WRITE_LOCAL", reason: "Loss ceilings bound worst-case outcomes and are owner-set." },
  { id: "change_position_ceiling", capability: "WRITE_LOCAL", reason: "Position ceilings bound concentration risk and are owner-set." },
  { id: "delete_trial_record", capability: "WRITE_LOCAL", reason: "Deleting trials corrupts multiple-testing accounting and hides failures." },
  { id: "requery_locked_holdout", capability: "READ", reason: "Repeated holdout queries destroy the only unbiased estimate the system has." },
  { id: "deploy_unreviewed_code", capability: "EXTERNAL_WRITE", reason: "Every code change reaching the runtime passes human review." },
  { id: "change_mcp_permissions", capability: "WRITE_LOCAL", reason: "Tool permissions define the blast radius and are owner-set." },
  { id: "add_broker_mutation_tool", capability: "FINANCIAL_MUTATION", reason: "No broker mutation capability exists in this system by design." },
  { id: "place_order", capability: "FINANCIAL_MUTATION", reason: "Orders are placed manually by the owner outside this software." },
  { id: "rewrite_verification_rules", capability: "WRITE_LOCAL", reason: "A system that can rewrite its own tests cannot be trusted by them." },
  { id: "mark_failed_strategy_profitable", capability: "WRITE_LOCAL", reason: "Outcomes are recorded from evidence and are never edited to agree with a hypothesis." },
]);

/** Capability classes that autonomous and research actors may never exercise. */
export const FORBIDDEN_CAPABILITIES: readonly CapabilityClass[] = Object.freeze([
  "EXTERNAL_WRITE",
  "FINANCIAL_MUTATION",
  "UNKNOWN",
]);

const PERMITTED_BY_ID: ReadonlyMap<string, AutonomousAction> = new Map(
  AUTONOMOUS_PERMITTED.map((action) => [action.id, action]),
);

const PROHIBITED_BY_ID: ReadonlyMap<string, ProhibitedAction> = new Map(
  AUTONOMOUS_PROHIBITED.map((action) => [action.id, action]),
);

export function classifyAction(id: string): "permitted" | "prohibited" | "unknown" {
  if (PROHIBITED_BY_ID.has(id)) return "prohibited";
  if (PERMITTED_BY_ID.has(id)) return "permitted";
  return "unknown";
}

export function findProhibitedAction(id: string): ProhibitedAction | null {
  return PROHIBITED_BY_ID.get(id) ?? null;
}

const AUTONOMOUS_ACTORS: readonly Actor[] = Object.freeze(["autonomous_worker", "research_agent"]);

export function isAutonomousActor(actor: Actor): boolean {
  return AUTONOMOUS_ACTORS.includes(actor);
}

/**
 * The single decision point for anything an autonomous actor wants to do.
 * Default-deny: an action that is not explicitly permitted is refused.
 */
export function evaluateAutonomousAction(
  actionId: string,
  actor: Actor,
  mode: LearningMode,
): GovernanceDecision {
  const prohibited = PROHIBITED_BY_ID.get(actionId);
  if (prohibited) {
    return { allowed: false, code: "ACTION_PROHIBITED", reason: prohibited.reason };
  }

  const action = PERMITTED_BY_ID.get(actionId);
  if (!action) {
    return {
      allowed: false,
      code: "ACTION_UNKNOWN",
      reason: `Action "${actionId}" is not in the permitted set and is denied by default.`,
    };
  }

  if (FORBIDDEN_CAPABILITIES.includes(action.capability)) {
    return {
      allowed: false,
      code: "CAPABILITY_FORBIDDEN",
      reason: `Capability ${action.capability} is never available to autonomous actors.`,
    };
  }

  if (!isAutonomousActor(actor) && actor !== "owner" && actor !== "claude_interactive") {
    return { allowed: false, code: "ACTOR_FORBIDDEN", reason: `Unknown actor "${actor}".` };
  }

  if (MODE_RANK[mode] < MODE_RANK[action.minimumMode]) {
    return {
      allowed: false,
      code: "MODE_INSUFFICIENT",
      reason: `Action "${actionId}" requires learning mode "${action.minimumMode}" or higher; current mode is "${mode}".`,
    };
  }

  return { allowed: true, action };
}

export interface ToolDescriptor {
  readonly name: string;
  readonly capability: CapabilityClass;
}

export interface ToolAuditResult {
  readonly passed: boolean;
  readonly violations: readonly { name: string; capability: CapabilityClass; reason: string }[];
}

/**
 * Audits an MCP or agent tool set against the capability policy.
 * Used by the MCP policy audit and by tests that assert the served tool set stays read-only.
 */
export function auditToolSet(tools: readonly ToolDescriptor[], actor: Actor): ToolAuditResult {
  if (actor === "owner") return { passed: true, violations: [] };

  const violations = tools
    .filter((tool) => FORBIDDEN_CAPABILITIES.includes(tool.capability))
    .map((tool) => ({
      name: tool.name,
      capability: tool.capability,
      reason:
        tool.capability === "FINANCIAL_MUTATION"
          ? "Financial mutation tools are not available to any non-owner actor."
          : tool.capability === "EXTERNAL_WRITE"
            ? "External-write tools are not available to autonomous or research actors."
          : "Unclassified tools are denied until an owner classifies them.",
    }));

  return { passed: violations.length === 0, violations };
}
