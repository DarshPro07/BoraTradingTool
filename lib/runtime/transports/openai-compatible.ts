import {
  boundedFetch,
  normalizeHttpError,
  type HttpProviderConfig,
  type ListModelsResult,
  type TransportChatRequest,
  type TransportChatResult,
} from "./contract";

/**
 * The OpenAI-compatible wire — the family that unlocks the widest roster (OpenAI, OpenRouter,
 * DeepSeek, Mistral, Kimi, GLM, NVIDIA NIM, vLLM, LM Studio, …). One tested contract; each
 * provider contributes only registry configuration (base URL, credential source, headers).
 *
 * "Compatible" is a WIRE claim, not an identical-API claim — this transport uses only the
 * lowest-common-denominator surface (list models, non-streaming chat completions with a system
 * message) and reports usage/model exactly as the wire does, never assuming provider-specific
 * extensions exist.
 */

function authHeaders(config: HttpProviderConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    ...(config.headers ?? {}),
  };
}

/** GET {base}/models → data[].id */
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
      message: `${config.providerId} /models returned a body that is not the expected JSON shape.`,
      retryAfterSeconds: null,
    };
  }
}

/** POST {base}/chat/completions — the request body carries EXACTLY the assigned model id. */
export async function chat(config: HttpProviderConfig, request: TransportChatRequest): Promise<TransportChatResult> {
  const fetched = await boundedFetch(
    `${config.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.prompt },
        ],
        stream: false,
      }),
    },
    request.timeoutMs,
  );
  if (!fetched.ok) return fetched;
  if (!fetched.response.ok) return normalizeHttpError(fetched.response, config.providerId);

  let payload: {
    model?: unknown;
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  try {
    payload = (await fetched.response.json()) as typeof payload;
  } catch {
    return {
      ok: false,
      code: "BAD_RESPONSE",
      message: `${config.providerId} chat response was not JSON.`,
      retryAfterSeconds: null,
    };
  }

  const text = payload.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    return {
      ok: false,
      code: "BAD_RESPONSE",
      message: `${config.providerId} chat response carried no message content.`,
      retryAfterSeconds: null,
    };
  }

  const executedModel = typeof payload.model === "string" && payload.model.length > 0 ? payload.model : null;
  return {
    ok: true,
    text,
    executedModel,
    // The wire either NAMED what ran, or the only claim is our own bound request — stored as such.
    verification: executedModel !== null ? "RESPONSE_REPORTED" : "REQUEST_BOUND_ONLY",
    usage: {
      inputTokens: typeof payload.usage?.prompt_tokens === "number" ? payload.usage.prompt_tokens : null,
      outputTokens: typeof payload.usage?.completion_tokens === "number" ? payload.usage.completion_tokens : null,
    },
  };
}

/** Health = the models listing answering. Cheap, credential-exercising, side-effect free. */
export async function health(config: HttpProviderConfig, timeoutMs = 4_000): Promise<ListModelsResult> {
  return listModels(config, timeoutMs);
}
