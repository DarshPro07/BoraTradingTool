import { createHmac, timingSafeEqual } from "node:crypto";

const MIN_AGENT_TOKEN_LENGTH = 32;
const OWNER_SESSION_TTL_MS = 365 * 24 * 60 * 60_000;
export const OWNER_SESSION_COOKIE = "marketpulse_owner_session";

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

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function configuredOwnerToken(env: Readonly<Record<string, string | undefined>>): string | null {
  const owner = env.MARKETPULSE_OWNER_TOKEN?.trim() ?? "";
  const agent = env.MARKETPULSE_AGENT_TOKEN?.trim() ?? "";
  if (owner.length < MIN_AGENT_TOKEN_LENGTH || (agent.length > 0 && safeEqual(owner, agent))) return null;
  return owner;
}

function ownerSignature(ownerToken: string, expiresAt: number): string {
  return createHmac("sha256", ownerToken).update(`marketpulse-owner-session:v1:${expiresAt}`).digest("hex");
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

export function createOwnerSession(
  suppliedToken: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  now = Date.now(),
): string | null {
  const ownerToken = configuredOwnerToken(env);
  if (!ownerToken || !safeEqual(suppliedToken.trim(), ownerToken)) return null;
  const expiresAt = now + OWNER_SESSION_TTL_MS;
  return `v1.${expiresAt}.${ownerSignature(ownerToken, expiresAt)}`;
}

function hasValidOwnerSession(
  request: Request,
  env: Readonly<Record<string, string | undefined>>,
  now: number,
): boolean {
  const ownerToken = configuredOwnerToken(env);
  const value = cookieValue(request, OWNER_SESSION_COOKIE);
  if (!ownerToken || !value) return false;
  const match = /^v1\.(\d+)\.([a-f0-9]{64})$/.exec(value);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  return Number.isSafeInteger(expiresAt) && expiresAt > now && safeEqual(match[2], ownerSignature(ownerToken, expiresAt));
}

function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1] ?? "";
}

export function requireMutationAccess(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Response | null {
  const url = new URL(request.url);
  if (!isLoopbackHost(url.hostname) || hasUnsafeHostHeader(request)) {
    return problem(403, "NON_LOOPBACK_REQUEST", "Mutations are restricted to this computer.");
  }

  const authorization = request.headers.get("authorization");
  const bearer = bearerToken(authorization);
  if (authorization !== null) {
    const expected = env.MARKETPULSE_AGENT_TOKEN?.trim() ?? "";
    if (
      bearer === null ||
      bearer.length < MIN_AGENT_TOKEN_LENGTH ||
      expected.length < MIN_AGENT_TOKEN_LENGTH ||
      !safeEqual(bearer, expected)
    ) {
      return problem(401, "INVALID_AGENT_TOKEN", "A valid local agent token is required.");
    }
    return null;
  }

  if (!hasSameLoopbackOrigin(request, url)) {
    return problem(403, "CROSS_ORIGIN_MUTATION", "Mutation origin does not match the application.");
  }
  if (request.headers.get("x-marketpulse-csrf") !== "1") {
    return problem(403, "CSRF_HEADER_REQUIRED", "The MarketPulse CSRF header is required.");
  }
  return null;
}

export function requireOwnerMutationAccess(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  now = Date.now(),
): Response | null {
  const denied = requireMutationAccess(request, env);
  if (denied) return denied;
  if (request.headers.has("authorization")) {
    return problem(403, "OWNER_ROLE_REQUIRED", "A bearer token cannot perform owner actions.");
  }
  return null;
}

export type GovernedActorResult =
  | { ok: true; actor: "owner" | "autonomous_worker" }
  | { ok: false; response: Response };

export function authenticateGovernedActor(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
  now = Date.now(),
): GovernedActorResult {
  const denied = requireMutationAccess(request, env);
  if (denied) return { ok: false, response: denied };
  if (request.headers.has("authorization")) return { ok: true, actor: "autonomous_worker" };
  const ownerDenied = requireOwnerMutationAccess(request, env, now);
  return ownerDenied ? { ok: false, response: ownerDenied } : { ok: true, actor: "owner" };
}
