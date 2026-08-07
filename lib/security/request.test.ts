import { describe, expect, it } from "vitest";
import {
  authenticateGovernedActor,
  createOwnerSession,
  isLoopbackHost,
  requireMutationAccess,
  requireOwnerMutationAccess,
} from "./request";

const TOKEN = "a".repeat(64);
const OWNER_TOKEN = "o".repeat(64);

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers });
}

function browserRequest(url = "http://127.0.0.1:3000/api/test"): Request {
  return request(url, {
    origin: new URL(url).origin,
    "x-marketpulse-csrf": "1",
  });
}

describe("isLoopbackHost", () => {
  it.each(["localhost", "localhost:3000", "127.0.0.1", "127.24.5.6:3100", "[::1]:3000", "::1"])(
    "accepts %s",
    (host) => expect(isLoopbackHost(host)).toBe(true),
  );

  it.each(["0.0.0.0", "192.168.1.5", "example.com", "127.0.0.999", "localhost.example"])(
    "rejects %s",
    (host) => expect(isLoopbackHost(host)).toBe(false),
  );
});

describe("requireMutationAccess", () => {
  it("allows a same-origin browser mutation with the CSRF header", () => {
    expect(requireMutationAccess(browserRequest())).toBeNull();
  });

  it("allows IPv6 loopback browser mutations", () => {
    expect(requireMutationAccess(browserRequest("http://[::1]:3000/api/test"))).toBeNull();
  });

  it("allows equivalent loopback aliases when protocol and effective port match", () => {
    expect(
      requireMutationAccess(
        request("http://localhost:3000/api/test", {
          host: "127.0.0.1:3100",
          origin: "http://127.0.0.1:3100",
          "x-marketpulse-csrf": "1",
        }),
      ),
    ).toBeNull();
  });

  it("rejects non-loopback URLs and forwarded hosts", () => {
    expect(requireMutationAccess(browserRequest("http://192.168.1.20:3000/api/test"))?.status).toBe(403);
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", {
          origin: "http://127.0.0.1:3000",
          "x-marketpulse-csrf": "1",
          "x-forwarded-host": "public.example",
        }),
      )?.status,
    ).toBe(403);
  });

  it("rejects cross-origin and missing-CSRF browser requests", () => {
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", {
          origin: "https://evil.example",
          "x-marketpulse-csrf": "1",
        }),
      )?.status,
    ).toBe(403);
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", { origin: "http://127.0.0.1:3000" }),
      )?.status,
    ).toBe(403);
    expect(
      requireMutationAccess(
        request("http://localhost:3000/api/test", {
          host: "127.0.0.1:3100",
          origin: "http://127.0.0.1:3101",
          "x-marketpulse-csrf": "1",
        }),
      )?.status,
    ).toBe(403);
  });

  it("accepts a valid bearer capability token", () => {
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", { authorization: `Bearer ${TOKEN}` }),
        { MARKETPULSE_AGENT_TOKEN: TOKEN },
      ),
    ).toBeNull();
  });

  it("rejects missing, short, malformed, and unequal bearer tokens", () => {
    const env = { MARKETPULSE_AGENT_TOKEN: TOKEN };
    expect(requireMutationAccess(request("http://127.0.0.1:3000/api/test"), env)?.status).toBe(403);
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", { authorization: "Basic abc" }),
        env,
      )?.status,
    ).toBe(401);
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", { authorization: "Bearer short" }),
        env,
      )?.status,
    ).toBe(401);
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", { authorization: `Bearer ${"b".repeat(64)}` }),
        env,
      )?.status,
    ).toBe(401);
  });
});

describe("owner mutation access", () => {
  const env = {
    MARKETPULSE_AGENT_TOKEN: TOKEN,
    MARKETPULSE_OWNER_TOKEN: OWNER_TOKEN,
  };
  const now = Date.parse("2026-08-06T12:00:00Z");

  function ownerRequest(cookie: string): Request {
    return request("http://127.0.0.1:3000/api/learning", {
      origin: "http://127.0.0.1:3000",
      "x-marketpulse-csrf": "1",
      cookie: `marketpulse_owner_session=${cookie}`,
    });
  }

  it("rejects an agent token as owner authority", () => {
    const denied = requireOwnerMutationAccess(
      request("http://127.0.0.1:3000/api/learning", { authorization: `Bearer ${TOKEN}` }),
      env,
      now,
    );
    expect(denied?.status).toBe(403);
  });

  it("no longer requires an owner session from the browser", () => {
    // Removed at the owner's explicit instruction: on a single-user, loopback-bound application
    // the fifteen-minute session was pure friction. What it cost is recorded here rather than in
    // a commit message nobody re-reads.
    //
    // Still enforced, and asserted here and above: the request must be loopback-bound, must carry
    // the CSRF header, and must not present a bearer token. That last one is the load-bearing
    // half — it is what stops the autonomous agent raising its own risk ceilings, which is a
    // different question from whether a human has to log in.
    expect(requireOwnerMutationAccess(browserRequest(), env, now)).toBeNull();

    // A session cookie is still honoured when supplied, so the sign-in control and any caller
    // that still sends one keep working rather than failing in some new way.
    const session = createOwnerSession(OWNER_TOKEN, env, now);
    expect(session).not.toBeNull();
    expect(requireOwnerMutationAccess(ownerRequest(session!), env, now)).toBeNull();
  });

  it("still refuses a mutation that is not loopback-bound", () => {
    // The boundary that actually matters now. Dropping the owner session must not have widened
    // anything reachable from off this machine.
    const remote = request("http://192.168.1.50:3000/api/learning", {
      origin: "http://192.168.1.50:3000",
      "x-marketpulse-csrf": "1",
    });
    expect(requireOwnerMutationAccess(remote, env, now)).not.toBeNull();
  });

  it("fails closed when owner and agent capabilities are identical", () => {
    const unsafeEnv = { MARKETPULSE_AGENT_TOKEN: TOKEN, MARKETPULSE_OWNER_TOKEN: TOKEN };
    expect(createOwnerSession(TOKEN, unsafeEnv, now)).toBeNull();
  });

  it("preserves the authenticated actor instead of trusting request data", () => {
    const agent = authenticateGovernedActor(
      request("http://127.0.0.1:3000/api/proposals", { authorization: `Bearer ${TOKEN}` }),
      env,
      now,
    );
    expect(agent.ok && agent.actor).toBe("autonomous_worker");

    const session = createOwnerSession(OWNER_TOKEN, env, now)!;
    const owner = authenticateGovernedActor(ownerRequest(session), env, now);
    expect(owner.ok && owner.actor).toBe("owner");
  });
});
