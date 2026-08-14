import {
  boundedFetch,
  normalizeHttpError,
  type HttpProviderConfig,
  type ListModelsResult,
  type TransportChatRequest,
  type TransportChatResult,
} from "./contract";

/**
 * The Gemini-native wire (`models/{model}:generateContent`). Native rather than Google's
 * OpenAI-compatibility surface, on the owner's instruction: Google itself labels the
 * compatibility layer beta and recommends the native API — and the native usage/identity fields
 * (usageMetadata, modelVersion) are the truthful telemetry this system records.
 */

function authHeaders(config: HttpProviderConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(config.apiKey ? { "x-goog-api-key": config.apiKey } : {}),
    ...(config.headers ?? {}),
  };
}

export async function listModels(config: HttpProviderConfig, timeoutMs = 4_000): Promise<ListModelsResult> {
  const fetched = await boundedFetch(`${config.baseUrl}/models`, { headers: authHeaders(config) }, timeoutMs);
  if (!fetched.ok) return fetched;
  if (!fetched.response.ok) return normalizeHttpError(fetched.response, config.providerId);
  try {
    const payload = (await fetched.response.json()) as { models?: { name?: unknown }[] };
    const modelIds = (payload.models ?? [])
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      // The wire names models "models/<id>"; the id is what a request binds.
      .map((name) => name.replace(/^models\//, ""));
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
    `${config.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`,
    {
      method: "POST",
      headers: authHeaders(config),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      }),
    },
    request.timeoutMs,
  );
  if (!fetched.ok) return fetched;
  if (!fetched.response.ok) return normalizeHttpError(fetched.response, config.providerId);

  let payload: {
    modelVersion?: unknown;
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
  };
  try {
    payload = (await fetched.response.json()) as typeof payload;
  } catch {
    return { ok: false, code: "BAD_RESPONSE", message: `${config.providerId} response was not JSON.`, retryAfterSeconds: null };
  }

  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text)
    .filter((value): value is string => typeof value === "string")
    .join("");
  if (text.length === 0) {
    return {
      ok: false,
      code: "BAD_RESPONSE",
      message: `${config.providerId} response carried no candidate text.`,
      retryAfterSeconds: null,
    };
  }

  const executedModel =
    typeof payload.modelVersion === "string" && payload.modelVersion.length > 0 ? payload.modelVersion : null;
  return {
    ok: true,
    text,
    executedModel,
    verification: executedModel !== null ? "RESPONSE_REPORTED" : "REQUEST_BOUND_ONLY",
    usage: {
      inputTokens:
        typeof payload.usageMetadata?.promptTokenCount === "number" ? payload.usageMetadata.promptTokenCount : null,
      outputTokens:
        typeof payload.usageMetadata?.candidatesTokenCount === "number"
          ? payload.usageMetadata.candidatesTokenCount
          : null,
    },
  };
}

export async function health(config: HttpProviderConfig, timeoutMs = 4_000): Promise<ListModelsResult> {
  return listModels(config, timeoutMs);
}
