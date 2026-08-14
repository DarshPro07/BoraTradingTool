import {
  boundedFetch,
  normalizeHttpError,
  type HttpProviderConfig,
  type ListModelsResult,
  type TransportChatRequest,
  type TransportChatResult,
} from "./contract";

/**
 * The Anthropic-native wire (`/v1/messages`) — kept SEPARATE from the OpenAI-compatible family
 * on the owner's instruction: native features (system as a top-level field, content blocks,
 * distinct usage vocabulary, distinct auth headers) differ materially, and forcing them through
 * a compatibility shim would hide exactly the differences that matter.
 */

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * The messages wire REQUIRES max_tokens. A stated ceiling, not a tuning knob: research responses
 * in this system are structured envelopes well under this size, and a truncated answer fails the
 * contract validation loudly rather than silently.
 */
const MAX_TOKENS = 4_096;

function authHeaders(config: HttpProviderConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    ...(config.apiKey ? { "x-api-key": config.apiKey } : {}),
    ...(config.headers ?? {}),
  };
}

export async function listModels(config: HttpProviderConfig, timeoutMs = 4_000): Promise<ListModelsResult> {
  const fetched = await boundedFetch(`${config.baseUrl}/models`, { headers: authHeaders(config) }, timeoutMs);
  if (!fetched.ok) return fetched;
  if (!fetched.response.ok) return normalizeHttpError(fetched.response, config.providerId);
  try {
    const payload = (await fetched.response.json()) as { data?: { id?: unknown }[] };
    const modelIds = (payload.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return { ok: true, modelIds };
  } catch {
    return {
      ok: false,
      code: "BAD_RESPONSE",
      message: `${config.providerId} /models returned an unexpected body.`,
      retryAfterSeconds: null,
    };
  }
}

export async function chat(config: HttpProviderConfig, request: TransportChatRequest): Promise<TransportChatResult> {
  const fetched = await boundedFetch(
    `${config.baseUrl}/messages`,
    {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({
        model: request.model,
        max_tokens: MAX_TOKENS,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.prompt }],
      }),
    },
    request.timeoutMs,
  );
  if (!fetched.ok) return fetched;
  if (!fetched.response.ok) return normalizeHttpError(fetched.response, config.providerId);

  let payload: {
    model?: unknown;
    content?: { type?: unknown; text?: unknown }[];
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  try {
    payload = (await fetched.response.json()) as typeof payload;
  } catch {
    return { ok: false, code: "BAD_RESPONSE", message: `${config.providerId} response was not JSON.`, retryAfterSeconds: null };
  }

  // Content blocks: join the text blocks in order; a response with none is a contract violation.
  const text = (payload.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
  if (text.length === 0) {
    return {
      ok: false,
      code: "BAD_RESPONSE",
      message: `${config.providerId} response carried no text content blocks.`,
      retryAfterSeconds: null,
    };
  }

  const executedModel = typeof payload.model === "string" && payload.model.length > 0 ? payload.model : null;
  return {
    ok: true,
    text,
    executedModel,
    verification: executedModel !== null ? "RESPONSE_REPORTED" : "REQUEST_BOUND_ONLY",
    usage: {
      inputTokens: typeof payload.usage?.input_tokens === "number" ? payload.usage.input_tokens : null,
      outputTokens: typeof payload.usage?.output_tokens === "number" ? payload.usage.output_tokens : null,
    },
  };
}

export async function health(config: HttpProviderConfig, timeoutMs = 4_000): Promise<ListModelsResult> {
  return listModels(config, timeoutMs);
}
