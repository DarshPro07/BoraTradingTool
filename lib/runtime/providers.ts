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
  "gemini",
  "openrouter",
  "nvidia-nim",
  "mistral",
  "kimi",
  "glm",
  "vllm-local",
  "lmstudio",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** How MarketPulse reaches it. Determines who owns the credential. */
export type ProviderTransport = "CLI" | "AGENT_SDK" | "API" | "LOCAL_MODEL" | "HTTP_SERVICE";

/**
 * The WIRE FAMILY — which tested transport contract speaks to this provider. This is the owner's
 * scalability rule made concrete: supporting the next provider of an existing family is a
 * REGISTRY ENTRY (base URL + credential source), never new transport code. `NONE` = no runnable
 * adapter yet; detection states that instead of pretending.
 */
export type WireFamily = "OPENAI_CHAT" | "ANTHROPIC_MESSAGES" | "GEMINI_GENERATE" | "CLI_CLAUDE" | "NONE";

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
  /** Which transport contract speaks this provider's wire. NONE = no runnable adapter yet. */
  wire: WireFamily;
  /** Environment variable holding the credential; absent for LOCAL/subscription providers. */
  apiKeyEnv?: string;
  /** Environment variable that OVERRIDES the base URL (self-hosted/local deployments). */
  baseUrlEnv?: string;
  /** The wire's documented default endpoint. Env override wins. */
  defaultBaseUrl?: string;
}

/**
 * Capability declarations only — no model names, no versions. What each provider can actually
 * serve today is discovered at boot and lives in DetectedProvider.models.
 */
export const PROVIDER_REGISTRY: Readonly<Record<ProviderId, ProviderDescriptor>> = Object.freeze({
  "claude-code": {
    wire: "CLI_CLAUDE",
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
    wire: "NONE",
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
    wire: "ANTHROPIC_MESSAGES",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultBaseUrl: "https://api.anthropic.com/v1",
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
    wire: "OPENAI_CHAT",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultBaseUrl: "https://api.openai.com/v1",
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
    wire: "OPENAI_CHAT",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultBaseUrl: "https://api.deepseek.com/v1",
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
    wire: "NONE",
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
    wire: "NONE",
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
    wire: "OPENAI_CHAT",
    baseUrlEnv: "MARKETPULSE_OLLAMA_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
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

  gemini: {
    id: "gemini",
    displayName: "Google Gemini API",
    kind: "LLM",
    wire: "GEMINI_GENERATE",
    apiKeyEnv: "GEMINI_API_KEY",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    transport: "API",
    auth: "API_KEY",
    costClass: "API",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: false,
    supportsStructuredOutput: true,
    enableHint: "Set GEMINI_API_KEY in the local environment.",
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    kind: "LLM",
    wire: "OPENAI_CHAT",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    transport: "API",
    auth: "API_KEY",
    costClass: "API",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: false,
    supportsStructuredOutput: true,
    enableHint: "Set OPENROUTER_API_KEY. One key fronts many hosted models; ids are discovered.",
  },
  "nvidia-nim": {
    id: "nvidia-nim",
    displayName: "NVIDIA NIM",
    kind: "LLM",
    wire: "OPENAI_CHAT",
    apiKeyEnv: "NVIDIA_API_KEY",
    baseUrlEnv: "MARKETPULSE_NIM_BASE_URL",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    transport: "API",
    auth: "API_KEY",
    costClass: "API",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: false,
    supportsStructuredOutput: true,
    enableHint: "Set NVIDIA_API_KEY (cloud) or MARKETPULSE_NIM_BASE_URL for a local NIM container.",
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral API",
    kind: "LLM",
    wire: "OPENAI_CHAT",
    apiKeyEnv: "MISTRAL_API_KEY",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    transport: "API",
    auth: "API_KEY",
    costClass: "API",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: false,
    supportsStructuredOutput: true,
    enableHint: "Set MISTRAL_API_KEY in the local environment.",
  },
  kimi: {
    id: "kimi",
    displayName: "Kimi (Moonshot)",
    kind: "LLM",
    wire: "OPENAI_CHAT",
    apiKeyEnv: "MOONSHOT_API_KEY",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    transport: "API",
    auth: "API_KEY",
    costClass: "API",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: false,
    supportsStructuredOutput: true,
    enableHint: "Set MOONSHOT_API_KEY in the local environment.",
  },
  glm: {
    id: "glm",
    displayName: "GLM (Zhipu)",
    kind: "LLM",
    wire: "OPENAI_CHAT",
    apiKeyEnv: "ZHIPU_API_KEY",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    transport: "API",
    auth: "API_KEY",
    costClass: "API",
    supportsStreaming: true,
    supportsTools: true,
    supportsMcp: false,
    supportsStructuredOutput: true,
    enableHint: "Set ZHIPU_API_KEY in the local environment.",
  },
  "vllm-local": {
    id: "vllm-local",
    displayName: "vLLM (local)",
    kind: "LLM",
    wire: "OPENAI_CHAT",
    baseUrlEnv: "MARKETPULSE_VLLM_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:8000/v1",
    transport: "LOCAL_MODEL",
    auth: "LOCAL",
    costClass: "LOCAL",
    supportsStreaming: true,
    supportsTools: false,
    supportsMcp: false,
    supportsStructuredOutput: false,
    enableHint: "Start a vLLM server (default 127.0.0.1:8000) or set MARKETPULSE_VLLM_BASE_URL.",
  },
  lmstudio: {
    id: "lmstudio",
    displayName: "LM Studio (local)",
    kind: "LLM",
    wire: "OPENAI_CHAT",
    baseUrlEnv: "MARKETPULSE_LMSTUDIO_BASE_URL",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    transport: "LOCAL_MODEL",
    auth: "LOCAL",
    costClass: "LOCAL",
    supportsStreaming: true,
    supportsTools: false,
    supportsMcp: false,
    supportsStructuredOutput: false,
    enableHint: "Start the LM Studio local server (default 127.0.0.1:1234) or set MARKETPULSE_LMSTUDIO_BASE_URL.",
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
