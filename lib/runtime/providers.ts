/**
 * The provider registry (owner directive 2026-08-10 22:29 — AI RUNTIME BOOT GATE).
 *
 * MarketPulse must never hardcode one model. Integrations are DESCRIBED here and discovered at
 * boot; nothing else in the codebase may name a vendor model literal. Two rules make this
 * honest rather than decorative:
 *
 *   1. **A subscription is not free.** Reporting "Claude Max: ₹0" would be a lie — the plan is
 *      already paid for and quota-limited. Cost class is explicit: SUBSCRIPTION (paid, quota
 *      limited) vs API (incremental metered spend) vs LOCAL (compute only) vs SERVICE.
 *   2. **Detection reports what it found, never what it hopes.** An undetected provider is
 *      UNAVAILABLE with a reason; a rate-limited one is QUOTA_EXHAUSTED with its reset — the
 *      429 that stopped research on 2026-08-10 is a first-class state, not an exception.
 */

export const PROVIDER_IDS = [
  "claude-code",
  "codex",
  "anthropic-api",
  "openai-api",
  "deepseek",
  "scout",
  "kronos",
  "local-model",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** How MarketPulse reaches it. Determines who owns the credential. */
export type ProviderTransport = "CLI" | "AGENT_SDK" | "API" | "LOCAL_MODEL" | "HTTP_SERVICE";

export type ProviderAuth = "SUBSCRIPTION" | "API_KEY" | "OAUTH" | "LOCAL" | "NONE";

/** What spending a call actually consumes. Never collapse these into "free". */
export type CostClass = "SUBSCRIPTION" | "API" | "LOCAL" | "SERVICE";

/** A provider's family. Kronos is NOT a chatbot and must not be offered as one. */
export type ProviderKind = "LLM" | "FINANCIAL_MODEL" | "RESEARCH_SERVICE";

export type ProviderStatus =
  | "READY"
  | "UNAUTHENTICATED"
  | "QUOTA_EXHAUSTED"
  | "UNAVAILABLE"
  | "UNHEALTHY"
  | "NOT_DETECTED";

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  kind: ProviderKind;
  transport: ProviderTransport;
  auth: ProviderAuth;
  costClass: CostClass;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsMcp: boolean;
  supportsStructuredOutput: boolean;
  /** How a human enables it when detection says it is missing. Shown verbatim in the UI. */
  enableHint: string;
}

/**
 * Capability declarations only — no model names, no versions. What each provider can actually
 * serve today is discovered at boot and lives in DetectedProvider.models.
 */
export const PROVIDER_REGISTRY: Readonly<Record<ProviderId, ProviderDescriptor>> = Object.freeze({
  "claude-code": {
    id: "claude-code",
    displayName: "Claude Code",
    kind: "LLM",
    transport: "CLI",
    auth: "SUBSCRIPTION",
    costClass: "SUBSCRIPTION",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: true,
    supportsStructuredOutput: true,
    enableHint: "Sign in to Claude Code on this machine (the CLI owns its own credential).",
  },
  codex: {
    id: "codex",
    displayName: "Codex (ChatGPT)",
    kind: "LLM",
    transport: "CLI",
    auth: "OAUTH",
    costClass: "SUBSCRIPTION",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: true,
    supportsStructuredOutput: true,
    enableHint: "Run the provider's ChatGPT OAuth login; no API key is used.",
  },
  "anthropic-api": {
    id: "anthropic-api",
    displayName: "Anthropic API",
    kind: "LLM",
    transport: "API",
    auth: "API_KEY",
    costClass: "API",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: false,
    supportsStructuredOutput: true,
    enableHint: "Set ANTHROPIC_API_KEY in the local environment — never in the browser or chat.",
  },
  "openai-api": {
    id: "openai-api",
    displayName: "OpenAI API",
    kind: "LLM",
    transport: "API",
    auth: "API_KEY",
    costClass: "API",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: false,
    supportsStructuredOutput: true,
    enableHint: "Set OPENAI_API_KEY in the local environment.",
  },
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek API",
    kind: "LLM",
    transport: "API",
    auth: "API_KEY",
    costClass: "API",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: false,
    supportsStructuredOutput: true,
    enableHint: "Set DEEPSEEK_API_KEY. Model ids are discovered, never hardcoded — they change.",
  },
  scout: {
    id: "scout",
    displayName: "Scout (research service)",
    kind: "RESEARCH_SERVICE",
    transport: "HTTP_SERVICE",
    auth: "NONE",
    costClass: "SERVICE",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: true,
    supportsStructuredOutput: true,
    enableHint: "Start the Scout service; it carries its own LLM provider underneath.",
  },
  kronos: {
    id: "kronos",
    displayName: "Kronos (financial time-series)",
    kind: "FINANCIAL_MODEL",
    transport: "LOCAL_MODEL",
    auth: "LOCAL",
    costClass: "LOCAL",
    supportsStreaming: false,
    supportsTools: false,
    supportsMcp: false,
    supportsStructuredOutput: true,
    enableHint: "Place the checkpoint where the forecast runner expects it.",
  },
  "local-model": {
    id: "local-model",
    displayName: "Local model (Ollama)",
    kind: "LLM",
    transport: "LOCAL_MODEL",
    auth: "LOCAL",
    costClass: "LOCAL",
    supportsStreaming: true,
    supportsTools: false,
    supportsMcp: false,
    supportsStructuredOutput: false,
    enableHint: "Install Ollama and pull a model; it serves on 127.0.0.1:11434.",
  },
});

/** A model the boot probe actually saw. Names are DISCOVERED — never literals in our source. */
export interface CatalogModel {
  provider: ProviderId;
  modelId: string;
  /** Relative, not absolute: absolute pricing goes stale faster than any release cycle. */
  relativeQuality: "BASIC" | "STRONG" | "FRONTIER";
  relativeCost: "LOW" | "MEDIUM" | "HIGH";
  supportsThinking: boolean;
}

export interface ProviderQuota {
  /** Null when the provider does not report it — never guess a number. */
  resetsAt: string | null;
  detail: string;
}

export interface DetectedProvider {
  id: ProviderId;
  status: ProviderStatus;
  /** Why the status is what it is — rendered verbatim, so it must be a sentence a human reads. */
  reason: string;
  models: CatalogModel[];
  quota: ProviderQuota | null;
  detectedAt: string;
}

export function descriptorFor(id: ProviderId): ProviderDescriptor {
  return PROVIDER_REGISTRY[id];
}

/** Usable = detected READY. Everything else is a stated unavailability, never a silent skip. */
export function isUsable(provider: DetectedProvider): boolean {
  return provider.status === "READY";
}
