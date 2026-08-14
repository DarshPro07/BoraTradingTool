import { describe, expect, it } from "vitest";
import {
  authenticateGovernedActor,
  createLocalSession,
  isLoopbackHost,
  requireMutationAccess,
  requireOwnerMutationAccess,
} from "./request";

const TOKEN = "a".repeat(64);

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers });
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
  // Helper: a fully valid local mutation request (loopback + origin + session + header).
  function validMutationRequest(url = "http://127.0.0.1:3000/api/test"): Request {
    const origin = new URL(url).origin;
    return request(url, {
      origin,
      "x-marketpulse-mutation": "1",
      cookie: `marketpulse_local_session=${createLocalSession()}`,
    });
  }

  it("allows a valid local mutation (loopback + origin + session + header)", () => {
    expect(requireMutationAccess(validMutationRequest())).toBeNull();
  });

  it("allows IPv6 loopback mutations with valid session", () => {
    expect(requireMutationAccess(validMutationRequest("http://[::1]:3000/api/test"))).toBeNull();
  });

  it("rejects non-loopback URLs and forwarded hosts", () => {
    expect(requireMutationAccess(validMutationRequest("http://192.168.1.20:3000/api/test"))?.status).toBe(403);
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", {
          origin: "http://127.0.0.1:3000",
          "x-forwarded-host": "public.example",
          "x-marketpulse-mutation": "1",
          cookie: `marketpulse_local_session=${createLocalSession()}`,
        }),
      )?.status,
    ).toBe(403);
  });

  it("rejects missing session cookie", () => {
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", {
          origin: "http://127.0.0.1:3000",
          "x-marketpulse-mutation": "1",
        }),
      )?.status,
    ).toBe(401);
  });

  it("rejects missing mutation header", () => {
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", {
          origin: "http://127.0.0.1:3000",
          cookie: `marketpulse_local_session=${createLocalSession()}`,
        }),
      )?.status,
    ).toBe(403);
  });

  it("rejects cross-origin browser requests", () => {
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", {
          origin: "https://evil.example",
          "x-marketpulse-mutation": "1",
          cookie: `marketpulse_local_session=${createLocalSession()}`,
        }),
      )?.status,
    ).toBe(403);
  });

  it("allows same-origin loopback mutations without a HUMAN-TYPED token", () => {
    // No human-typed token — the server auto-generates the session.
    expect(
      requireMutationAccess(
        request("http://127.0.0.1:3000/api/test", {
          origin: "http://127.0.0.1:3000",
          "x-marketpulse-mutation": "1",
          cookie: `marketpulse_local_session=${createLocalSession()}`,
        }),
      ),
    ).toBeNull();
  });
});

describe("owner mutation access", () => {
  const env = { MARKETPULSE_AGENT_TOKEN: TOKEN };
  const now = Date.parse("2026-08-06T12:00:00Z");

  function ownerRequest(): Request {
    return request("http://127.0.0.1:3000/api/learning", {
      origin: "http://127.0.0.1:3000",
      "x-marketpulse-mutation": "1",
      cookie: `marketpulse_local_session=${createLocalSession()}`,
    });
  }

  it("rejects an agent token as owner authority", () => {
    // Bearer token is no longer valid — local session is the auth.
    // Without a local session cookie → 401 (first layer to fail).
    const denied = requireOwnerMutationAccess(
      request("http://127.0.0.1:3000/api/learning", {
        origin: "http://127.0.0.1:3000",
        "x-marketpulse-mutation": "1",
      }),
      env,
      now,
    );
    expect(denied?.status).toBe(401);
  });

  it("does not require a typed owner token when the local boundary is valid", () => {
    expect(requireOwnerMutationAccess(ownerRequest(), env, now)).toBeNull();
  });

  it("still refuses a mutation that is not loopback-bound", () => {
    // The boundary that actually matters now. Dropping the owner session must not have widened
    // anything reachable from off this machine.
    const remote = request("http://192.168.1.50:3000/api/learning", {
      origin: "http://192.168.1.50:3000",
      "x-marketpulse-mutation": "1",
      cookie: `marketpulse_local_session=${createLocalSession()}`,
    });
    expect(requireOwnerMutationAccess(remote, env, now)).not.toBeNull();
  });

  it("authenticates local requests as autonomous_worker regardless of owner-token configuration", () => {
    // The owner removed the token ceremony. A stale MARKETPULSE_OWNER_TOKEN left in someone's
    // .env.local must not silently re-arm a gate the product no longer exposes any way to satisfy
    // — that is exactly how every control on /learning and /settings became dead again.
    for (const candidate of [env, { ...env, MARKETPULSE_OWNER_TOKEN: "o".repeat(64) }]) {
      const local = authenticateGovernedActor(
        request("http://127.0.0.1:3000/api/proposals", {
          origin: "http://127.0.0.1:3000",
          "x-marketpulse-mutation": "1",
          cookie: `marketpulse_local_session=${createLocalSession()}`,
        }),
        candidate,
        now,
      );
      expect(local.ok && local.actor).toBe("autonomous_worker");
    }
  });

  it("does not let a configured owner token re-arm the removed unlock gate", () => {
    const withToken = { ...env, MARKETPULSE_OWNER_TOKEN: "o".repeat(64) };
    expect(requireOwnerMutationAccess(ownerRequest(), withToken, now)).toBeNull();
  });
});
