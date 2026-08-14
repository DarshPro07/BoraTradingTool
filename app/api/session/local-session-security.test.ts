import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLocalSession,
  getLocalSessionSecret,
  LOCAL_SESSION_COOKIE,
  MUTATION_HEADER,
  requireMutationAccess,
} from "@/lib/security/request";

/**
 * Adversarial proof of the invisible local-session boundary — the owner's gate before any
 * autonomy expansion is built on top of it.
 *
 * ## Why forged requests, not a browser
 *
 * The boundary is a pure `Request → Response|null` function, and that is exactly why forged
 * requests are the STRONGER adversarial test here. A real browser physically refuses to send a
 * cross-site request carrying a spoofed `Sec-Fetch-Site`, a forged cross-origin `Origin` beside
 * a custom `X-` header, or a SameSite=Strict cookie it will not attach cross-site — that refusal
 * IS the defense. A browser test would therefore prove "the attack could not launch", not "the
 * server rejects the attack". These tests construct precisely the requests a non-browser attacker
 * (curl, local malware in another process, a malicious page's server-side proxy) WOULD craft, and
 * assert the server rejects every one.
 *
 * The legitimate happy path (real cookie issued by /api/session, real mutationFetch attaching
 * credentials + header, a real same-origin mutation succeeding) is already exercised end-to-end
 * by the existing green e2e mutation flows — a 403 at this boundary would break them. What no
 * browser can exercise, and what is proven here, is the rejection matrix.
 *
 * OWASP's CSRF guidance is defense-in-depth: SameSite + Origin + Fetch-Metadata + a custom header,
 * no single layer trusted alone. Each test below isolates one layer by satisfying the others.
 */

const VALID_URL = "http://127.0.0.1:3000/api/proposals";

/** A request satisfying every layer — the control that must be ALLOWED (returns null). */
function validRequest(overrides: Record<string, string | null> = {}): Request {
  const headers: Record<string, string> = {
    origin: "http://127.0.0.1:3000",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    [MUTATION_HEADER]: "1",
    cookie: `${LOCAL_SESSION_COOKIE}=${createLocalSession()}`,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete headers[key];
    else headers[key] = value;
  }
  return new Request(VALID_URL, { method: "POST", headers });
}

describe("local-session boundary — the legitimate path is allowed", () => {
  it("allows a fully valid same-origin loopback mutation (the boundary must not reject real use)", () => {
    expect(requireMutationAccess(validRequest())).toBeNull();
  });
});

describe("cross-site POST rejection", () => {
  it("rejects a cross-origin Origin at the origin layer", () => {
    const denied = requireMutationAccess(validRequest({ origin: "https://evil.example" }));
    expect(denied?.status).toBe(403);
  });

  it("rejects an explicit Sec-Fetch-Site: cross-site even if every other header is forged loopback", () => {
    // Isolates layer 3: a browser sets this header itself and an attacker page cannot suppress it.
    const denied = requireMutationAccess(validRequest({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" }));
    expect(denied?.status).toBe(403);
  });
});

describe("missing / wrong custom header rejection", () => {
  it("rejects a request with no mutation header — an attacker's simple request cannot set it cross-site", () => {
    expect(requireMutationAccess(validRequest({ [MUTATION_HEADER]: null }))?.status).toBe(403);
  });

  it("rejects a wrong mutation-header value", () => {
    expect(requireMutationAccess(validRequest({ [MUTATION_HEADER]: "0" }))?.status).toBe(403);
  });
});

describe("origin mismatch — protocol and port are part of identity", () => {
  it("rejects the same loopback host on a DIFFERENT port", () => {
    // 127.0.0.1:9999 is a different origin than the :3000 the request hit — a second local
    // service must not mutate this one.
    const denied = requireMutationAccess(validRequest({ origin: "http://127.0.0.1:9999" }));
    expect(denied?.status).toBe(403);
  });

  it("rejects a DIFFERENT protocol (https origin against an http request)", () => {
    const denied = requireMutationAccess(validRequest({ origin: "https://127.0.0.1:3000" }));
    expect(denied?.status).toBe(403);
  });
});

describe("session tampering and forgery", () => {
  it("rejects a signature with a single flipped hex character", () => {
    const token = createLocalSession();
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    const denied = requireMutationAccess(validRequest({ cookie: `${LOCAL_SESSION_COOKIE}=${flipped}` }));
    expect(denied?.status).toBe(401);
  });

  it("rejects a token whose HMAC was computed with a FOREIGN secret", () => {
    // A non-browser attacker who omits Sec-Fetch (passing layer 3 via the CLI branch) and forges
    // a loopback Origin still cannot mint a cookie: the HMAC secret lives only in this server's
    // memory. This is the real backstop against local malware in another process.
    const expiresAt = Date.now() + 60_000;
    const foreignSig = createHmac("sha256", "attacker-does-not-have-the-real-secret")
      .update(`local-session:${expiresAt}`)
      .digest("hex");
    const forged = `local.${expiresAt}.${foreignSig}`;
    const denied = requireMutationAccess(
      validRequest({ cookie: `${LOCAL_SESSION_COOKIE}=${forged}`, "sec-fetch-site": null, "sec-fetch-mode": null }),
    );
    expect(denied?.status).toBe(401);
  });

  it("rejects a structurally invalid token", () => {
    for (const junk of ["not-a-token", "local.abc.def", "local.123.tooshort", ""]) {
      const denied = requireMutationAccess(validRequest({ cookie: `${LOCAL_SESSION_COOKIE}=${junk}` }));
      expect(denied?.status, `junk token "${junk}" must be rejected`).toBe(401);
    }
  });
});

describe("simple-form POST (a cross-site <form> cannot carry our client's proofs)", () => {
  it("rejects a cross-site form POST — foreign Origin, no custom header, no cookie", () => {
    // What a malicious page's auto-submitting form actually produces against a local service.
    const formPost = new Request(VALID_URL, {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "no-cors",
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    expect(requireMutationAccess(formPost)?.status).toBe(403);
  });

  it("rejects even a SAME-origin request that lacks the custom header — the header is a real gate, not decoration", () => {
    expect(requireMutationAccess(validRequest({ [MUTATION_HEADER]: null }))?.status).toBe(403);
  });
});

describe("expired and restart-invalidated sessions", () => {
  it("rejects an expired token", () => {
    // Signed with the REAL secret but already past expiry — verifyLocalSession checks expiry first.
    const expiredAt = Date.now() - 60_000;
    const sig = createHmac("sha256", getLocalSessionSecret()).update(`local-session:${expiredAt}`).digest("hex");
    const expired = `local.${expiredAt}.${sig}`;
    expect(requireMutationAccess(validRequest({ cookie: `${LOCAL_SESSION_COOKIE}=${expired}` }))?.status).toBe(401);
  });

  it("rejects a pre-restart cookie — a server restart rotates the in-memory secret", () => {
    // The secret is randomBytes(64) generated once per process; after a restart it differs, so a
    // cookie minted by the previous process is a token signed with a now-foreign secret. Modelled
    // exactly by signing with a different secret and asserting rejection — fail-closed, so a
    // restart forces a fresh /api/session issue before mutations resume.
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    const preRestartSig = createHmac("sha256", "the-previous-process-secret")
      .update(`local-session:${expiresAt}`)
      .digest("hex");
    const preRestart = `local.${expiresAt}.${preRestartSig}`;
    expect(requireMutationAccess(validRequest({ cookie: `${LOCAL_SESSION_COOKIE}=${preRestart}` }))?.status).toBe(401);
  });
});

describe("network reachability — the boundary that matters most", () => {
  it("rejects a non-loopback destination outright, before any session check", () => {
    const remote = new Request("http://192.168.1.50:3000/api/proposals", {
      method: "POST",
      headers: {
        origin: "http://192.168.1.50:3000",
        "sec-fetch-site": "same-origin",
        [MUTATION_HEADER]: "1",
        cookie: `${LOCAL_SESSION_COOKIE}=${createLocalSession()}`,
      },
    });
    expect(requireMutationAccess(remote)?.status).toBe(403);
  });

  it("rejects a spoofed X-Forwarded-Host pointing off-machine", () => {
    const denied = requireMutationAccess(validRequest({ "x-forwarded-host": "public.example" }));
    expect(denied?.status).toBe(403);
  });
});
