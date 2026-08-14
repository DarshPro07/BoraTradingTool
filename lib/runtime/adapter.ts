import type { ProviderId, CatalogModel } from "./providers";
import type { Capability } from "./routing";

export interface ModelCapabilities {
  reasoning: boolean;
  coding: boolean;
  research: boolean;
  toolUse: boolean;
  structuredOutput: boolean;
  vision: boolean;
  longContext: boolean;
  financialTimeseries: boolean;
}

/**
 * ModelProviderAdapter — the common contract for all AI providers.
 *
 * Each provider implements this interface. The CapabilityRouter selects
 * the best provider+model for each task, then calls execute().
 *
 * Supported adapters:
 * - ClaudeCodeMcpAdapter (via `claude mcp serve` or `claude -p`)
 * - AnthropicApiAdapter (direct API)
 * - OpenAIAdapter (direct API)
 * - OpenAICompatibleAdapter (Ollama, etc.)
 */

export interface AdapterHealth {
  status: "READY" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED";
  reason: string;
  lastCheckedAt: string;
}

export interface AdapterModel {
  modelId: string;
  capabilities: ModelCapabilities;
  contextWindow: number;
  costClass: "SUBSCRIPTION" | "API" | "LOCAL" | "SERVICE";
  latencyClass: "FAST" | "MEDIUM" | "SLOW";
}

export interface AdapterRequest {
  capability: Capability;
  prompt: string;
  systemPrompt?: string;
  modelId?: string;
  timeoutMs?: number;
}

export interface AdapterResponse {
  ok: boolean;
  text: string;
  provider: ProviderId;
  model: string;
  tokens: number | null;
  cost: number | null;
  durationMs: number;
  fallbackReason: string | null;
}

export interface ModelProviderAdapter {
  readonly providerId: ProviderId;
  readonly displayName: string;

  /** Check if this provider is available and healthy. */
  health(): Promise<AdapterHealth>;

  /** List available models and their capabilities. */
  listModels(): Promise<AdapterModel[]>;

  /** Execute a task through this provider. */
  execute(request: AdapterRequest): Promise<AdapterResponse>;

  /** Dispose of any resources. */
  dispose?(): Promise<void>;
}

/**
 * Claude Code adapter — uses the official Claude Code CLI.
 *
 * Claude Code supports:
 * - `claude -p` for programmatic (headless) use
 * - `claude mcp serve` to expose Claude Code as an MCP server
 *
 * This adapter uses `claude -p` for direct calls.
 */
export class ClaudeCodeMcpAdapter implements ModelProviderAdapter {
  readonly providerId = "claude-code" as const;
  readonly displayName = "Claude Code";

  async health(): Promise<AdapterHealth> {
    // Probe claude --version using child_process directly.
    try {
      const { spawn } = await import("node:child_process");
      const result = await new Promise<{ ok: boolean; stdout: string; message: string }>((resolve) => {
        const proc = spawn("claude", ["--version"], { timeout: 20_000 });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d) => { stdout += d.toString(); });
        proc.stderr.on("data", (d) => { stderr += d.toString(); });
        proc.on("close", (code) => {
          if (code === 0) resolve({ ok: true, stdout, message: "" });
          else resolve({ ok: false, stdout, message: stderr || `exit ${code}` });
        });
        proc.on("error", (err) => resolve({ ok: false, stdout, message: err.message }));
      });

      if (result.ok) {
        return {
          status: "READY",
          reason: `Claude Code CLI present: ${result.stdout.trim()}`,
          lastCheckedAt: new Date().toISOString(),
        };
      }
      return {
        status: "UNAVAILABLE",
        reason: result.message,
        lastCheckedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "NOT_CONFIGURED",
        reason: error instanceof Error ? error.message : String(error),
        lastCheckedAt: new Date().toISOString(),
      };
    }
  }

  async listModels(): Promise<AdapterModel[]> {
    // Claude Code doesn't enumerate models; they're discovered at runtime.
    // Return the alias as the model.
    return [
      {
        modelId: "sonnet",
        capabilities: {
          reasoning: true,
          coding: true,
          research: true,
          toolUse: true,
          structuredOutput: true,
          vision: true,
          longContext: true,
          financialTimeseries: false,
        },
        contextWindow: 200_000,
        costClass: "SUBSCRIPTION",
        latencyClass: "MEDIUM",
      },
    ];
  }

  async execute(request: AdapterRequest): Promise<AdapterResponse> {
    // Delegates to the existing gateway's runClaudeCode.
    const { runAgent } = await import("./gateway");
    const { detectProviders } = await import("./gateway");
    const { defaultProfile } = await import("./routing");

    const profile = defaultProfile("SUBSCRIPTION_FIRST", `boot_${Date.now()}`) as Parameters<typeof runAgent>[0]["profile"];
    const detected = await detectProviders();

    const run = await runAgent({
      capability: request.capability,
      prompt: request.prompt,
      systemPrompt: request.systemPrompt ?? "You are a financial research assistant.",
      profile,
      detected,
      timeoutMs: request.timeoutMs,
    });

    if (!run.ok) {
      return {
        ok: false,
        text: "",
        provider: "claude-code",
        model: "none",
        tokens: null,
        cost: null,
        durationMs: 0,
        fallbackReason: run.message,
      };
    }

    return {
      ok: true,
      text: run.text,
      provider: run.provider,
      model: run.model,
      tokens: run.tokens,
      cost: run.cost,
      durationMs: new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime(),
      fallbackReason: run.fallbackReason,
    };
  }
}

/**
 * Anthropic API adapter — direct API integration via @anthropic-ai/sdk.
 * Supports: claude-sonnet-5, claude-opus-4, claude-haiku-4, etc.
 */
export class AnthropicApiAdapter implements ModelProviderAdapter {
  readonly providerId = "anthropic-api" as const;
  readonly displayName = "Anthropic API";

  async health(): Promise<AdapterHealth> {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) {
      return { status: "NOT_CONFIGURED", reason: "ANTHROPIC_API_KEY not set", lastCheckedAt: new Date().toISOString() };
    }
    return { status: "READY", reason: "API key configured", lastCheckedAt: new Date().toISOString() };
  }

  async listModels(): Promise<AdapterModel[]> {
    return [
      { modelId: "claude-sonnet-5", capabilities: { reasoning: true, coding: true, research: true, toolUse: true, structuredOutput: true, vision: true, longContext: true, financialTimeseries: false }, contextWindow: 200_000, costClass: "API", latencyClass: "MEDIUM" },
      { modelId: "claude-opus-4", capabilities: { reasoning: true, coding: true, research: true, toolUse: true, structuredOutput: true, vision: true, longContext: true, financialTimeseries: false }, contextWindow: 200_000, costClass: "API", latencyClass: "SLOW" },
      { modelId: "claude-haiku-4", capabilities: { reasoning: true, coding: true, research: true, toolUse: true, structuredOutput: true, vision: true, longContext: true, financialTimeseries: false }, contextWindow: 200_000, costClass: "API", latencyClass: "FAST" },
    ];
  }

  async execute(request: AdapterRequest): Promise<AdapterResponse> {
    const startedAt = Date.now();
    try {
      const anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new anthropic();
      const model = request.modelId ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: request.systemPrompt ?? "You are a financial research assistant.",
        messages: [{ role: "user", content: request.prompt }],
      });
      const text = response.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
      return {
        ok: true, text, provider: "anthropic-api", model,
        tokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
        cost: null, durationMs: Date.now() - startedAt, fallbackReason: null,
      };
    } catch (error) {
      return { ok: false, text: "", provider: "anthropic-api", model: "none", tokens: null, cost: null, durationMs: Date.now() - startedAt, fallbackReason: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * OpenAI API adapter — direct API integration via openai SDK.
 * Supports: gpt-5, gpt-4o, gpt-4o-mini, o1, etc.
 */
export class OpenAIApiAdapter implements ModelProviderAdapter {
  readonly providerId = "openai-api" as const;
  readonly displayName = "OpenAI API";

  async health(): Promise<AdapterHealth> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      return { status: "NOT_CONFIGURED", reason: "OPENAI_API_KEY not set", lastCheckedAt: new Date().toISOString() };
    }
    return { status: "READY", reason: "API key configured", lastCheckedAt: new Date().toISOString() };
  }

  async listModels(): Promise<AdapterModel[]> {
    return [
      { modelId: "gpt-5", capabilities: { reasoning: true, coding: true, research: true, toolUse: true, structuredOutput: true, vision: true, longContext: true, financialTimeseries: false }, contextWindow: 128_000, costClass: "API", latencyClass: "MEDIUM" },
      { modelId: "gpt-4o", capabilities: { reasoning: true, coding: true, research: true, toolUse: true, structuredOutput: true, vision: true, longContext: true, financialTimeseries: false }, contextWindow: 128_000, costClass: "API", latencyClass: "FAST" },
      { modelId: "gpt-4o-mini", capabilities: { reasoning: true, coding: true, research: true, toolUse: true, structuredOutput: true, vision: true, longContext: false, financialTimeseries: false }, contextWindow: 128_000, costClass: "API", latencyClass: "FAST" },
    ];
  }

  async execute(request: AdapterRequest): Promise<AdapterResponse> {
    const startedAt = Date.now();
    try {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI();
      const model = request.modelId ?? process.env.OPENAI_MODEL ?? "gpt-4o";
      const response = await client.chat.completions.create({
        model,
        max_tokens: 4096,
        messages: [
          { role: "system", content: request.systemPrompt ?? "You are a financial research assistant." },
          { role: "user", content: request.prompt },
        ],
      });
      const text = response.choices[0]?.message?.content ?? "";
      return {
        ok: true, text, provider: "openai-api", model,
        tokens: response.usage?.total_tokens ?? null,
        cost: null, durationMs: Date.now() - startedAt, fallbackReason: null,
      };
    } catch (error) {
      return { ok: false, text: "", provider: "openai-api", model: "none", tokens: null, cost: null, durationMs: Date.now() - startedAt, fallbackReason: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * Ollama (local model) adapter — OpenAI-compatible local inference.
 * Supports any model pulled into Ollama (llama, mistral, deepseek, etc.)
 */
export class OllamaAdapter implements ModelProviderAdapter {
  readonly providerId = "local-model" as const;
  readonly displayName = "Local model (Ollama)";

  async health(): Promise<AdapterHealth> {
    try {
      const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return { status: "READY", reason: "Ollama is running", lastCheckedAt: new Date().toISOString() };
      return { status: "UNAVAILABLE", reason: `Ollama returned ${res.status}`, lastCheckedAt: new Date().toISOString() };
    } catch {
      return { status: "NOT_CONFIGURED", reason: "Ollama not reachable at 127.0.0.1:11434", lastCheckedAt: new Date().toISOString() };
    }
  }

  async listModels(): Promise<AdapterModel[]> {
    try {
      const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const data: any = await res.json();
      return (data.models ?? []).map((m: any) => ({
        modelId: m.name,
        capabilities: { reasoning: true, coding: true, research: true, toolUse: false, structuredOutput: false, vision: false, longContext: false, financialTimeseries: false },
        contextWindow: m.context_length ?? 8192,
        costClass: "LOCAL" as const,
        latencyClass: "FAST" as const,
      }));
    } catch {
      return [];
    }
  }

  async execute(request: AdapterRequest): Promise<AdapterResponse> {
    const startedAt = Date.now();
    try {
      const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
      const model = request.modelId ?? process.env.OLLAMA_MODEL ?? "llama3";
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: request.systemPrompt ?? "You are a financial research assistant." },
            { role: "user", content: request.prompt },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? 120_000),
      });
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
      const data: any = await res.json();
      return {
        ok: true, text: data.message?.content ?? "", provider: "local-model", model,
        tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        cost: null, durationMs: Date.now() - startedAt, fallbackReason: null,
      };
    } catch (error) {
      return { ok: false, text: "", provider: "local-model", model: "none", tokens: null, cost: null, durationMs: Date.now() - startedAt, fallbackReason: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * OpenAI-compatible adapter — for DeepSeek, OpenRouter, and other compatible APIs.
 * Uses the OpenAI SDK with a custom baseURL.
 */
export class OpenAICompatibleAdapter implements ModelProviderAdapter {
  readonly providerId: ProviderId;
  readonly displayName: string;

  constructor(providerId: ProviderId, displayName: string) {
    this.providerId = providerId;
    this.displayName = displayName;
  }

  async health(): Promise<AdapterHealth> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) {
      return { status: "NOT_CONFIGURED", reason: "OPENAI_API_KEY not set", lastCheckedAt: new Date().toISOString() };
    }
    return { status: "READY", reason: "API key configured", lastCheckedAt: new Date().toISOString() };
  }

  async listModels(): Promise<AdapterModel[]> {
    return [
      { modelId: "deepseek-chat", capabilities: { reasoning: true, coding: true, research: true, toolUse: true, structuredOutput: true, vision: false, longContext: true, financialTimeseries: false }, contextWindow: 64_000, costClass: "API", latencyClass: "MEDIUM" },
      { modelId: "deepseek-reasoner", capabilities: { reasoning: true, coding: true, research: true, toolUse: true, structuredOutput: true, vision: false, longContext: true, financialTimeseries: false }, contextWindow: 64_000, costClass: "API", latencyClass: "SLOW" },
    ];
  }

  async execute(request: AdapterRequest): Promise<AdapterResponse> {
    const startedAt = Date.now();
    try {
      const OpenAI = (await import("openai")).default;
      const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL;
      const client = new OpenAI({ baseURL, apiKey: process.env.OPENAI_API_KEY });
      const model = request.modelId ?? "deepseek-chat";
      const response = await client.chat.completions.create({
        model, max_tokens: 4096,
        messages: [
          { role: "system", content: request.systemPrompt ?? "You are a financial research assistant." },
          { role: "user", content: request.prompt },
        ],
      });
      const text = response.choices[0]?.message?.content ?? "";
      return {
        ok: true, text, provider: this.providerId, model,
        tokens: response.usage?.total_tokens ?? null,
        cost: null, durationMs: Date.now() - startedAt, fallbackReason: null,
      };
    } catch (error) {
      return { ok: false, text: "", provider: this.providerId, model: "none", tokens: null, cost: null, durationMs: Date.now() - startedAt, fallbackReason: error instanceof Error ? error.message : String(error) };
    }
  }
}

/**
 * Get the adapter for a provider ID.
 */
export function getAdapter(providerId: ProviderId): ModelProviderAdapter | null {
  switch (providerId) {
    case "claude-code":
      return new ClaudeCodeMcpAdapter();
    case "anthropic-api":
      return new AnthropicApiAdapter();
    case "openai-api":
      return new OpenAIApiAdapter();
    case "local-model":
      return new OllamaAdapter();
    case "deepseek":
      return new OpenAICompatibleAdapter("deepseek", "DeepSeek API");
    default:
      return null; // Adapter not implemented for this provider
  }
}
