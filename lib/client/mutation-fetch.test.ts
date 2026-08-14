import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mutationFetch } from "./mutation-fetch";

/**
 * The bug this pins: JSON mutations posted through the shared helper were refused with
 * "Content-Type must be application/json". The route was fine, and the message described the
 * transport — so product controls looked broken.
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
  it("always sends the mutation header", async () => {
    const spy = capture();
    await mutationFetch("/api/x", { method: "POST" });
    expect(new Headers(spy.mock.calls[0][1]?.headers).get("x-marketpulse-mutation")).toBe("1");
  });

  it("labels a JSON body so the route does not refuse it on transport grounds", async () => {
    const spy = capture();
    await mutationFetch("/api/example", { method: "POST", body: JSON.stringify({ ok: true }) });
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

/**
 * The rule, enforced instead of remembered.
 *
 * `AutonomousControl` shipped a Start button that posted without the CSRF header. Every unit test
 * passed; the button was dead. No amount of backend testing finds that — only clicking it did, and
 * only after the owner reported the whole product as full of dead buttons.
 *
 * Auditing controls by hand finds the ones that exist today. This finds the next one.
 */
const MUTATING_METHOD = /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/;
// `mutationFetch(` is excluded by its capital F; the lookbehind drops `foo.fetch(` and `$fetch(`.
const BARE_FETCH = /(?<![\w.$])fetch\s*\(/g;

function findRawMutations(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(BARE_FETCH)) {
    const index = match.index ?? 0;
    // Options follow the URL immediately; this window cannot reach the next call site in practice.
    if (!MUTATING_METHOD.test(source.slice(index, index + 300))) continue;
    lines.push(source.slice(0, index).split("\n").length);
  }
  return lines;
}

function componentSources(): { file: string; source: string }[] {
  const root = path.join(process.cwd(), "components");
  return fs
    .readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => ({
      file: path.join("components", name).replace(/\\/g, "/"),
      source: fs.readFileSync(path.join(root, name), "utf8"),
    }));
}

describe("no component mutates without the shared helper", () => {
  it("detects a hand-rolled mutating fetch", () => {
    // The exact shape `AutonomousControl` shipped with: no CSRF header, so the route refuses it.
    const offending = `const response = await fetch("/api/system/start", {\n  method: "POST",\n});`;
    expect(findRawMutations(offending)).toEqual([1]);
  });

  it("leaves reads alone", () => {
    // GETs need no CSRF header, and flagging them would train people to ignore this test.
    const reading = `const response = await fetch("/api/system/status", { cache: "no-store" });`;
    expect(findRawMutations(reading)).toEqual([]);
    expect(findRawMutations(`await mutationFetch("/api/x", { method: "POST" });`)).toEqual([]);
  });

  it("finds none in the product", () => {
    const sources = componentSources();
    // A scan that reads nothing passes for the wrong reason, and a moved directory would silently
    // retire this guard rather than fail it.
    expect(sources.length).toBeGreaterThan(20);

    const offenders = sources.flatMap(({ file, source }) =>
      findRawMutations(source).map((line) => `${file}:${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
