import {
  descriptorFor,
  isUsable,
  type DetectedProvider,
  type ProviderId,
} from "./providers";

/**
 * Capability routing and the runtime profile (owner directive 2026-08-10 22:29).
 *
 * The website asks for a CAPABILITY, never a vendor: `route("DEEP_REASONING", providers, profile)`.
 * Three invariants are enforced here rather than trusted to callers, because each of them is a
 * way the system could quietly become dishonest:
 *
 *   1. **DETERMINISTIC never reaches an LLM.** Fees, P&L, indicators, backtests and risk are
 *      arithmetic. An expensive model being available is not a reason to route mathematics
 *      through it, and a language model producing a number that looks right is worse than no
 *      number at all.
 *   2. **TIME_SERIES only reaches a financial model.** Kronos is a candlestick model, not a
 *      chatbot; and no chatbot is a substitute for it.
 *   3. **Fallback is never silent.** A route records what was requested, what actually ran and
 *      why they differ. The 429 that stopped research on 2026-08-10 must become a visible
 *      "requested Codex → quota exhausted → fell back to Claude Code", not a mystery.
 */

export const CAPABILITIES = [
  "DETERMINISTIC",
  "TIME_SERIES",
  "CHEAP",
  "FAST",
  "RESEARCH",
  "DEEP_REASONING",
  "CODING",
  "INDEPENDENT_REVIEW",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const RUNTIME_PROFILES = [
  "SUBSCRIPTION_FIRST",
  "LOW_COST",
  "BALANCED",
  "MAX_QUALITY",
  "CUSTOM",
] as const;
export type RuntimeProfileName = (typeof RUNTIME_PROFILES)[number];

/** The deterministic engine is not a provider — it is this application's own arithmetic. */
export const DETERMINISTIC_ENGINE = "marketpulse-quant-core" as const;

export interface BudgetPolicy {
  /** Rupees of INCREMENTAL API spend. Subscription usage is not counted here — it is prepaid. */
  dailyApiBudget: number;
  monthlyApiBudget: number;
  maxCostPerJob: number;
  maxParallelAgents: number;
  maxDeepResearchJobsPerHour: number;
  /** When true the router exhausts SUBSCRIPTION/LOCAL providers before spending any API money. */
  subscriptionFirst: boolean;
  fallbackAllowed: boolean;
  /** When true, reaching the daily budget stops API routing entirely rather than overspending. */
  hardBudgetStop: boolean;
}

export interface RuntimeProfile {
  bootId: string;
  name: RuntimeProfileName;
  budget: BudgetPolicy;
  /** Per-capability preference order. The first USABLE entry wins; the rest are the fallbacks. */
  routing: Readonly<Record<Capability, readonly ProviderId[]>>;
  askOnRestart: boolean;
  selectedAt: string;
}

const BUDGET_DEFAULTS: Readonly<Record<RuntimeProfileName, BudgetPolicy>> = Object.freeze({
  SUBSCRIPTION_FIRST: { dailyApiBudget: 0, monthlyApiBudget: 0, maxCostPerJob: 0, maxParallelAgents: 4, maxDeepResearchJobsPerHour: 5, subscriptionFirst: true, fallbackAllowed: true, hardBudgetStop: true },
  LOW_COST: { dailyApiBudget: 100, monthlyApiBudget: 1_500, maxCostPerJob: 15, maxParallelAgents: 3, maxDeepResearchJobsPerHour: 3, subscriptionFirst: true, fallbackAllowed: true, hardBudgetStop: true },
  BALANCED: { dailyApiBudget: 300, monthlyApiBudget: 5_000, maxCostPerJob: 50, maxParallelAgents: 4, maxDeepResearchJobsPerHour: 5, subscriptionFirst: true, fallbackAllowed: true, hardBudgetStop: true },
  MAX_QUALITY: { dailyApiBudget: 1_500, monthlyApiBudget: 20_000, maxCostPerJob: 300, maxParallelAgents: 6, maxDeepResearchJobsPerHour: 10, subscriptionFirst: false, fallbackAllowed: true, hardBudgetStop: true },
  CUSTOM: { dailyApiBudget: 300, monthlyApiBudget: 5_000, maxCostPerJob: 50, maxParallelAgents: 4, maxDeepResearchJobsPerHour: 5, subscriptionFirst: true, fallbackAllowed: true, hardBudgetStop: true },
});

/**
 * Preference orders per profile. Deterministic and time-series rows are deliberately identical
 * everywhere: no budget may buy its way out of arithmetic or into a chatbot forecast.
 */
const ROUTING: Readonly<Record<RuntimeProfileName, Readonly<Record<Capability, readonly ProviderId[]>>>> =
  Object.freeze({
    SUBSCRIPTION_FIRST: {
      DETERMINISTIC: [],
      TIME_SERIES: ["kronos"],
      CHEAP: ["local-model", "claude-code", "codex", "deepseek"],
      FAST: ["codex", "claude-code", "local-model", "deepseek"],
      RESEARCH: ["scout", "claude-code", "codex", "deepseek"],
      DEEP_REASONING: ["claude-code", "codex", "anthropic-api"],
      CODING: ["codex", "claude-code", "anthropic-api"],
      INDEPENDENT_REVIEW: ["codex", "claude-code", "deepseek"],
    },
    LOW_COST: {
      DETERMINISTIC: [],
      TIME_SERIES: ["kronos"],
      CHEAP: ["local-model", "deepseek", "codex", "claude-code"],
      FAST: ["local-model", "deepseek", "codex", "claude-code"],
      RESEARCH: ["deepseek", "scout", "codex", "claude-code"],
      DEEP_REASONING: ["claude-code", "deepseek", "codex"],
      CODING: ["codex", "deepseek", "claude-code"],
      INDEPENDENT_REVIEW: ["deepseek", "codex", "claude-code"],
    },
    BALANCED: {
      DETERMINISTIC: [],
      TIME_SERIES: ["kronos"],
      CHEAP: ["deepseek", "local-model", "codex", "claude-code"],
      FAST: ["deepseek", "codex", "claude-code", "local-model"],
      RESEARCH: ["scout", "claude-code", "deepseek", "codex"],
      DEEP_REASONING: ["claude-code", "anthropic-api", "codex"],
      CODING: ["codex", "claude-code", "deepseek"],
      INDEPENDENT_REVIEW: ["codex", "claude-code", "deepseek"],
    },
    MAX_QUALITY: {
      DETERMINISTIC: [],
      TIME_SERIES: ["kronos"],
      CHEAP: ["deepseek", "codex", "claude-code"],
      FAST: ["codex", "claude-code", "deepseek"],
      RESEARCH: ["claude-code", "scout", "anthropic-api", "codex"],
      DEEP_REASONING: ["claude-code", "anthropic-api", "openai-api", "codex"],
      CODING: ["claude-code", "codex", "anthropic-api"],
      INDEPENDENT_REVIEW: ["codex", "anthropic-api", "claude-code"],
    },
    CUSTOM: {
      DETERMINISTIC: [],
      TIME_SERIES: ["kronos"],
      CHEAP: ["deepseek", "local-model"],
      FAST: ["deepseek", "codex"],
      RESEARCH: ["scout", "claude-code"],
      DEEP_REASONING: ["claude-code"],
      CODING: ["codex", "claude-code"],
      INDEPENDENT_REVIEW: ["codex", "claude-code"],
    },
  });

export function defaultProfile(
  name: RuntimeProfileName,
  bootId: string,
  now = new Date(),
): RuntimeProfile {
  return {
    bootId,
    name,
    budget: { ...BUDGET_DEFAULTS[name] },
    routing: ROUTING[name],
    askOnRestart: true,
    selectedAt: now.toISOString(),
  };
}

export type RouteOutcome =
  | {
      ok: true;
      capability: Capability;
      /** DETERMINISTIC_ENGINE for arithmetic; otherwise the provider that will actually run. */
      resolved: ProviderId | typeof DETERMINISTIC_ENGINE;
      requested: ProviderId | typeof DETERMINISTIC_ENGINE;
      /** Populated only when resolved !== requested. Never null-and-different. */
      fallbackReason: string | null;
      costClass: "SUBSCRIPTION" | "API" | "LOCAL" | "SERVICE" | "NONE";
    }
  | {
      ok: false;
      capability: Capability;
      code: "PROVIDER_UNAVAILABLE" | "BUDGET_EXHAUSTED";
      /** Every candidate and exactly why it could not serve. The UI shows this list. */
      attempted: { provider: ProviderId; reason: string }[];
      message: string;
    };

export interface RouteContext {
  /** Rupees of API spend already committed today. Drives the hard budget stop. */
  apiSpentToday: number;
}

/**
 * Choose who runs this capability, or refuse with the whole attempt trail.
 *
 * `subscriptionFirst` reorders candidates rather than filtering them: an API provider stays
 * eligible as a later fallback, it just never wins while a prepaid one can serve.
 */
export function route(
  capability: Capability,
  detected: readonly DetectedProvider[],
  profile: RuntimeProfile,
  context: RouteContext = { apiSpentToday: 0 },
): RouteOutcome {
  if (capability === "DETERMINISTIC") {
    // Invariant 1. Not a preference — a refusal to make arithmetic routable at all.
    return {
      ok: true,
      capability,
      resolved: DETERMINISTIC_ENGINE,
      requested: DETERMINISTIC_ENGINE,
      fallbackReason: null,
      costClass: "NONE",
    };
  }

  const byId = new Map(detected.map((entry) => [entry.id, entry]));
  const candidates = profile.routing[capability] ?? [];
  const attempted: { provider: ProviderId; reason: string }[] = [];

  const ordered = profile.budget.subscriptionFirst
    ? [...candidates].sort((left, right) => rank(left) - rank(right))
    : [...candidates];

  const budgetGone =
    profile.budget.hardBudgetStop && context.apiSpentToday >= profile.budget.dailyApiBudget;

  let requested: ProviderId | null = null;
  for (const id of ordered) {
    if (requested === null) requested = id;
    const found = byId.get(id);

    if (!found) {
      attempted.push({ provider: id, reason: "not detected on this machine" });
      continue;
    }
    if (!isUsable(found)) {
      attempted.push({ provider: id, reason: `${found.status}: ${found.reason}` });
      continue;
    }
    const costClass = descriptorFor(id).costClass;
    if (costClass === "API" && budgetGone) {
      // Budget is a hard wall for metered spend only — prepaid capacity is unaffected.
      attempted.push({
        provider: id,
        reason: `daily API budget exhausted (₹${context.apiSpentToday} of ₹${profile.budget.dailyApiBudget})`,
      });
      continue;
    }
    if (attempted.length > 0 && !profile.budget.fallbackAllowed) {
      return {
        ok: false,
        capability,
        code: "PROVIDER_UNAVAILABLE",
        attempted,
        message: `${requested} could not serve ${capability} and this profile forbids fallback.`,
      };
    }

    return {
      ok: true,
      capability,
      resolved: id,
      requested: requested ?? id,
      fallbackReason:
        attempted.length === 0
          ? null
          : attempted.map((entry) => `${entry.provider}: ${entry.reason}`).join(" · "),
      costClass,
    };
  }

  // The code names what actually blocked the work, not what merely happened to be true. A
  // zero-API-budget profile (SUBSCRIPTION_FIRST spends no metered money BY DESIGN) satisfies
  // `spent >= budget` from the moment it boots, so testing `budgetGone` here blamed an exhausted
  // budget for every refusal — including "this machine has no research provider installed", which
  // sends the owner to fix the wrong thing entirely.
  const blockedByBudget = attempted.some((entry) => entry.reason.startsWith("daily API budget"));

  return {
    ok: false,
    capability,
    code: blockedByBudget ? "BUDGET_EXHAUSTED" : "PROVIDER_UNAVAILABLE",
    attempted,
    message:
      attempted.length === 0
        ? `No provider is configured for ${capability} in the ${profile.name} profile.`
        : `No provider could serve ${capability}. The work is queued rather than answered by a fabricated response.`,
  };
}

/** Prepaid capacity first, then local compute, then metered spend. */
function rank(id: ProviderId): number {
  const costClass = descriptorFor(id).costClass;
  if (costClass === "SUBSCRIPTION") return 0;
  if (costClass === "LOCAL") return 1;
  if (costClass === "SERVICE") return 2;
  return 3;
}
