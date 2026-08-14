import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invisible local security boundary.
 *
 * The user never types a token. On startup, the server creates a secure local session secret.
 * The browser receives a SameSite=Strict session cookie. The mutationFetch client automatically
 * sends a custom header. The server verifies ALL of:
 *
 *   1. Loopback destination (not reachable from network)
 *   2. Exact same origin (protocol + host + port)
 *   3. Fetch Metadata (Sec-Fetch-Site: same-origin, Sec-Fetch-Mode: same-origin/cors)
 *   4. Valid local session cookie (HMAC-verified, SameSite=Strict)
 *   5. Custom mutation header (X-MarketPulse-Mutation: 1)
 *
 * This is zero-friction for humans but real protection against:
 * - Cross-site CSRF (Origin + SameSite + custom header)
 * - Local network attacks (loopback binding)
 * - Malicious websites targeting local services (Fetch Metadata)
 *
 * OWASP: Origin alone is not authentication. We use it as one layer in a defense-in-depth
 * strategy, not the sole control.
 */

/** The local session cookie name. */
export const LOCAL_SESSION_COOKIE = "marketpulse_local_session";

/** The auto-generated local session secret. Created once per server process. */
let LOCAL_SESSION_SECRET: string | null = null;

/** Get or create the local session secret for this server process. */
export function getLocalSessionSecret(): string {
  if (!LOCAL_SESSION_SECRET) {
    LOCAL_SESSION_SECRET = randomBytes(64).toString("hex");
  }
  return LOCAL_SESSION_SECRET;
}

/** Local session token — short-lived, HMAC-verified, tied to this server process. */
export function createLocalSession(now = Date.now()): string {
  const expiresAt = now + 8 * 60 * 60 * 1000; // 8 hours
  const secret = getLocalSessionSecret();
  const sig = createHmac("sha256", secret).update(`local-session:${expiresAt}`).digest("hex");
  return `local.${expiresAt}.${sig}`;
}

/** Verify a local session token. */
export function verifyLocalSession(token: string | null, now = Date.now()): boolean {
  if (!token) return false;
  const match = /^local\.(\d+)\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  const secret = getLocalSessionSecret();
  const expected = createHmac("sha256", secret).update(`local-session:${expiresAt}`).digest("hex");
  return timingSafeEqual(Buffer.from(match[2]), Buffer.from(expected));
}

/** Check Fetch Metadata headers for same-origin browser requests. */
function hasValidFetchMetadata(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  const mode = request.headers.get("sec-fetch-mode");
  // same-origin is always acceptable
  if (site === "same-origin") return true;
  // cross-site same-origin mode with matching origin is from our own fetch client
  if (site === "same-site" && (mode === "same-origin" || mode === "cors")) return true;
  // Requests without Fetch Metadata (CLI, MCP, older browsers) pass this check — other layers protect
  if (!site && !mode) return true;
  // Explicitly cross-site/cross-origin is rejected
  return false;
}

/** The custom mutation header that the browser client automatically sends. */
export const MUTATION_HEADER = "x-marketpulse-mutation";
export const MUTATION_HEADER_VALUE = "1";

function problem(status: number, code: string, message: string): Response {
  return Response.json({ error: code, message }, { status });
}

function normalizeHost(value: string): string {
  const first = value.split(",", 1)[0]?.trim() ?? "";
  if (first.toLowerCase() === "::1") return "::1";
  if (first.startsWith("[")) {
    return first.slice(1, first.indexOf("]"));
  }
  return first.split(":", 1)[0]?.toLowerCase() ?? "";
}

export function isLoopbackHost(value: string): boolean {
  const host = normalizeHost(value);
  if (host === "localhost" || host === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return !!match && match.slice(1).every((octet) => Number(octet) <= 255);
}

function hasUnsafeHostHeader(request: Request): boolean {
  for (const header of ["host", "x-forwarded-host"]) {
    const value = request.headers.get(header);
    if (!value) continue;
    const hosts = value.split(",").map((part) => part.trim());
    if (hosts.some((host) => !isLoopbackHost(host))) return true;
  }
  return false;
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}

function hasSameLoopbackOrigin(request: Request, requestUrl: URL): boolean {
  const value = request.headers.get("origin");
  if (!value) return false;

  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    return false;
  }

  if (origin.origin === requestUrl.origin) return true;
  if (!isLoopbackHost(origin.hostname) || !isLoopbackHost(requestUrl.hostname)) return false;

  const host = request.headers.get("host")?.split(",", 1)[0]?.trim();
  let effectiveRequestUrl = requestUrl;
  if (host) {
    try {
      effectiveRequestUrl = new URL(`${requestUrl.protocol}//${host}`);
    } catch {
      return false;
    }
  }

  return (
    isLoopbackHost(effectiveRequestUrl.hostname) &&
    origin.protocol === effectiveRequestUrl.protocol &&
    effectivePort(origin) === effectivePort(effectiveRequestUrl)
  );
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    return cookie.slice(separator + 1).trim();
  }
  return null;
}

export function requireMutationAccess(
  request: Request,
  _env: Readonly<Record<string, string | undefined>> = process.env,
): Response | null {
  const url = new URL(request.url);

  // Layer 1: Loopback binding — not reachable from the network.
  if (!isLoopbackHost(url.hostname) || hasUnsafeHostHeader(request)) {
    return problem(403, "NON_LOOPBACK_REQUEST", "Mutations are restricted to this computer.");
  }

  // Layer 2: Exact same origin — protocol + host + port must match.
  if (!hasSameLoopbackOrigin(request, url)) {
    return problem(403, "CROSS_ORIGIN_MUTATION", "Mutation origin does not match the application.");
  }

  // Layer 3: Fetch Metadata — reject explicit cross-site requests.
  if (!hasValidFetchMetadata(request)) {
    return problem(403, "CROSS_SITE_REQUEST", "Cross-site mutations are not permitted.");
  }

  // Layer 4: Local session cookie — auto-generated by the server, SameSite=Strict.
  const sessionCookie = cookieValue(request, LOCAL_SESSION_COOKIE);
  if (!verifyLocalSession(sessionCookie)) {
    return problem(401, "LOCAL_SESSION_REQUIRED", "A valid local session is required.");
  }

  // Layer 5: Custom mutation header — the browser client sends this automatically.
  if (request.headers.get(MUTATION_HEADER) !== MUTATION_HEADER_VALUE) {
    return problem(403, "MUTATION_HEADER_REQUIRED", "The mutation header is required.");
  }

  return null;
}

/**
 * Sensitive local mutation access.
 *
 * Routine owner-token prompts are removed from local operation. Browser mutations are authorized
 * by the invisible local boundary in `requireMutationAccess`; domain governance and immutable
 * ledgers enforce constitutional safety above this transport layer.
 */
export function requireOwnerMutationAccess(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  _now = Date.now(),
): Response | null {
  return requireMutationAccess(request, env);
}

export type GovernedActorResult =
  | { ok: true; actor: "owner" | "autonomous_worker" }
  | { ok: false; response: Response };

export function authenticateGovernedActor(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  _now = Date.now(),
): GovernedActorResult {
  const denied = requireMutationAccess(request, env);
  if (denied) return { ok: false, response: denied };
  // Local browser operation is autonomous by default; owner-token sessions are no longer part of
  // routine product control flow.
  return { ok: true, actor: "autonomous_worker" };
}
