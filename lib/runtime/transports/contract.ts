import type { ProviderId } from "../providers";

/**
 * The transport contract — ONE shape for every HTTP wire family.
 *
 * A transport is dumb on purpose: it speaks one wire format, normalizes errors into the
 * provider-status vocabulary the registry already uses, extracts usage, and reports what model
 * actually executed WITH the honesty class of that claim. It never retries (the Job OS owns
 * retry), never falls back (the router owns fallback), and never invents a model id.
 */

export interface HttpProviderConfig {
  providerId: ProviderId;
  /** Normalized WITHOUT a trailing slash; the transport appends its own paths. */
  baseUrl: string;
  apiKey: string | null;
  headers?: Record<string, string>;
}

export interface TransportChatRequest {
  /** The router's CONCRETE assignment. The request body carries exactly this id. */
  model: string;
  systemPrompt: string;
  prompt: string;
  timeoutMs: number;
}

export interface TransportUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * How we know what executed. RESPONSE_REPORTED = the wire named its model in the response;
 * REQUEST_BOUND_ONLY = the wire did not, and the only claim is "we requested exactly this id" —
 * stored as that claim, never dressed up as independent verification.
 */
export type ModelVerification = "RESPONSE_REPORTED" | "REQUEST_BOUND_ONLY";

export type TransportErrorCode =
  | "UNAUTHENTICATED"
  | "QUOTA_EXHAUSTED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "BAD_RESPONSE";

export interface TransportFailure {
  ok: false;
  code: TransportErrorCode;
  message: string;
  /** From Retry-After when the wire supplies it; null means the wire said nothing. */
  retryAfterSeconds: number | null;
}

export interface TransportChatSuccess {
  ok: true;
  text: string;
  executedModel: string | null;
  verification: ModelVerification;
  usage: TransportUsage;
}

export type TransportChatResult = TransportChatSuccess | TransportFailure;

export type ListModelsResult = { ok: true; modelIds: string[] } | TransportFailure;

/** Shared HTTP plumbing: bounded, no retries, network errors named as such. */
export async function boundedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: true; response: Response } | TransportFailure> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { ok: true, response };
  } catch (caught) {
    const aborted = caught instanceof Error && caught.name === "AbortError";
    return {
      ok: false,
      code: aborted ? "TIMEOUT" : "UNAVAILABLE",
      message: aborted
        ? `No response within ${timeoutMs}ms from ${url}.`
        : `Could not reach ${url}: ${caught instanceof Error ? caught.message : String(caught)}`,
      retryAfterSeconds: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Map an HTTP status to the normalized vocabulary. 401/403 is a stated auth state, not a failure. */
export async function normalizeHttpError(response: Response, providerId: string): Promise<TransportFailure> {
  const body = (await response.text().catch(() => "")).slice(0, 300);
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterSeconds =
    retryAfterHeader !== null && Number.isFinite(Number(retryAfterHeader)) ? Number(retryAfterHeader) : null;

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: `${providerId} rejected the credential (HTTP ${response.status}). ${body}`,
      retryAfterSeconds: null,
    };
  }
  if (response.status === 429) {
    return {
      ok: false,
      code: "QUOTA_EXHAUSTED",
      message: `${providerId} is rate-limited (HTTP 429).${retryAfterSeconds !== null ? ` Retry after ${retryAfterSeconds}s.` : ""} ${body}`,
      retryAfterSeconds,
    };
  }
  return {
    ok: false,
    code: "UNAVAILABLE",
    message: `${providerId} answered HTTP ${response.status}. ${body}`,
    retryAfterSeconds,
  };
}
