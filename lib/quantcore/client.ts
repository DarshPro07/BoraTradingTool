import {
  CONTRACT_VERSION,
  RESOURCE_SCHEMAS,
  failure,
  success,
  type QuantErrorCode,
  type QuantFailure,
  type QuantResource,
  type QuantResult,
  type ResourceData,
} from "./contract";
import { quantCoreRoot, readFromFilesystem } from "./filesystem";

const DEFAULT_TIMEOUT_MS = 1_500;

function failureAt(
  resource: QuantResource,
  code: QuantErrorCode,
  message: string,
  source: string,
  now: number,
): QuantFailure {
  return { ...failure(resource, code, message, source), retrievedAt: new Date(now).toISOString() };
}

export function quantCoreBaseUrl(): string | null {
  const configured = process.env.QUANT_CORE_URL?.trim();
  if (configured === "off") return null;
  return configured || "http://127.0.0.1:8787";
}

interface HttpEnvelope {
  ok?: boolean;
  version?: string;
  generatedAt?: string | null;
  data?: unknown;
  code?: string;
  message?: string;
}

async function readFromHttp<R extends QuantResource>(
  resource: R,
  baseUrl: string,
  now: number,
  timeoutMs: number,
): Promise<QuantResult<ResourceData[R]> | null> {
  const url = `${baseUrl.replace(/\/$/, "")}/${CONTRACT_VERSION}/${resource}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) return null;

    const envelope = (await response.json()) as HttpEnvelope;
    if (envelope.version && envelope.version !== CONTRACT_VERSION) {
      return failureAt(
        resource,
        "CONTRACT_VERSION_MISMATCH",
        `Quant core served contract ${envelope.version}; this client speaks ${CONTRACT_VERSION}.`,
        url,
        now,
      );
    }
    if (envelope.ok === false) {
      return failureAt(resource, "RESOURCE_NOT_PROVIDED", envelope.message ?? "Quant core reported no data.", url, now);
    }

    const parsed = RESOURCE_SCHEMAS[resource].safeParse(envelope.data);
    if (!parsed.success) {
      return failureAt(resource, "RESOURCE_MALFORMED", parsed.error.message, url, now);
    }
    return success(resource, "http", url, envelope.generatedAt ?? null, parsed.data as ResourceData[R], now);
  } catch {
    // Connection refused, DNS failure, abort — fall through to the filesystem transport.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchOptions {
  root?: string;
  baseUrl?: string | null;
  now?: number;
  timeoutMs?: number;
}

/**
 * Reads a quant-core resource, preferring the live HTTP service and falling back to the
 * artifacts the quant core already writes to disk. Never fabricates: if neither transport
 * yields valid data the caller receives an explicit failure code.
 */
export async function fetchQuantResource<R extends QuantResource>(
  resource: R,
  options: FetchOptions = {},
): Promise<QuantResult<ResourceData[R]>> {
  const now = options.now ?? Date.now();
  const baseUrl = options.baseUrl === undefined ? quantCoreBaseUrl() : options.baseUrl;

  if (baseUrl) {
    const viaHttp = await readFromHttp(resource, baseUrl, now, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (viaHttp) return viaHttp;
  }

  return readFromFilesystem(resource, options.root ?? quantCoreRoot(), now);
}

export interface QuantCoreStatus {
  reachable: boolean;
  transport: "http" | "filesystem" | "none";
  mode: string | null;
  liveExecution: boolean;
  stale: boolean;
  source: string | null;
  message: string | null;
  /**
   * True when the owner set `QUANT_CORE_URL=off`.
   *
   * Without this, a quant core deliberately switched off and one that has crashed produce byte
   * for byte the same report: `reachable: false`. So the learning cycle printed "Quant core
   * unreachable" every pass on a machine where no quant core was ever meant to run, which reads
   * as a fault to fix rather than a component that is not part of this install.
   */
  disabled: boolean;
}

/**
 * A single call the UI header can make to decide what to show. `liveExecution: true`
 * from the quant core is a hard fault — this system has no execution path and treats
 * that signal as something to surface loudly, never as permission.
 */
export async function quantCoreStatus(options: FetchOptions = {}): Promise<QuantCoreStatus> {
  const baseUrl = options.baseUrl === undefined ? quantCoreBaseUrl() : options.baseUrl;
  const disabled = baseUrl === null;

  const health = await fetchQuantResource("health", options);
  if (!health.ok) {
    return {
      reachable: false,
      transport: "none",
      mode: null,
      liveExecution: false,
      stale: false,
      source: health.source ?? null,
      // Even switched off, the filesystem transport is still tried — artifacts on disk are valid
      // without a running service. So `disabled` narrows the message rather than replacing it.
      message: disabled
        ? "The quant core is switched off (QUANT_CORE_URL=off) and no artifacts were found on disk."
        : health.message,
      disabled,
    };
  }
  return {
    reachable: true,
    transport: health.transport,
    mode: health.data.mode,
    liveExecution: health.data.safety.liveExecution,
    stale: health.stale,
    source: health.source,
    message: null,
    disabled,
  };
}
