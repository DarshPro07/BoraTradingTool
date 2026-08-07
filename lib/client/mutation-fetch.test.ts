import { afterEach, describe, expect, it, vi } from "vitest";
import { mutationFetch } from "./mutation-fetch";

/**
 * The bug this pins: the owner sign-in posted a valid token and was refused with
 * "Content-Type must be application/json". The token was fine, the route was fine, and the
 * message described the transport — so the whole learning-mode control looked broken.
 *
 * Two separate call sites had the same omission, which is what says the default belonged in the
 * shared helper rather than in each caller's headers.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function capture() {
  const spy = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("mutationFetch", () => {
  it("always sends the CSRF header", async () => {
    const spy = capture();
    await mutationFetch("/api/x", { method: "POST" });
    expect(new Headers(spy.mock.calls[0][1]?.headers).get("x-marketpulse-csrf")).toBe("1");
  });

  it("labels a JSON body so the route does not refuse it on transport grounds", async () => {
    const spy = capture();
    await mutationFetch("/api/owner/session", { method: "POST", body: JSON.stringify({ token: "x" }) });
    expect(new Headers(spy.mock.calls[0][1]?.headers).get("content-type")).toBe("application/json");
  });

  it("sets no content type when there is no body", async () => {
    // A bodyless POST declaring a JSON content type is a small lie, and some routes check it.
    const spy = capture();
    await mutationFetch("/api/learning/cycle", { method: "POST" });
    expect(new Headers(spy.mock.calls[0][1]?.headers).has("content-type")).toBe(false);
  });

  it("never overrides a content type the caller chose", async () => {
    // A caller sending FormData or a blob has a different type and must keep it — defaulting
    // over the top would corrupt uploads to fix a JSON convenience.
    const spy = capture();
    await mutationFetch("/api/upload", {
      method: "POST",
      body: "raw",
      headers: { "content-type": "text/plain" },
    });
    expect(new Headers(spy.mock.calls[0][1]?.headers).get("content-type")).toBe("text/plain");
  });
});
