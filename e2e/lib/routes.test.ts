import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverRoutes } from "./routes";

/**
 * The defect this guards
 * ----------------------
 * `e2e/all-routes.spec.ts` carried a hand-written route list. It drifted:
 *
 *   - it named `/factory`, which does not exist (the real page is `/edge-factory`);
 *   - it named `/forward`, which does not exist either — and because the only status assertion
 *     was `toBeLessThan(500)`, the resulting 404 PASSED;
 *   - it omitted `/edge-factory` entirely, so a real page went untested.
 *
 * The first describe below fails against that old hand-written inventory and passes against the
 * filesystem derivation, which is the whole point of the change.
 */

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Build a throwaway `app/` tree from a list of files, and return its path. */
function scaffold(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mp-routes-"));
  tempDirs.push(root);
  for (const file of files) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "export default function Page() { return null; }\n");
  }
  return root;
}

describe("route inventory — the real application", () => {
  const patterns = discoverRoutes().map((route) => route.pattern);

  it("finds the page that the old hand-written list omitted", () => {
    expect(patterns).toContain("/edge-factory");
  });

  it("does not invent routes that have no page on disk", () => {
    // Both appeared in the old hand-written list. Neither has a directory under app/.
    expect(patterns).not.toContain("/factory");
    expect(patterns).not.toContain("/forward");
  });

  it("serves a root page and reports a plausible number of routes", () => {
    expect(patterns).toContain("/");
    expect(patterns.length).toBeGreaterThan(20);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("substitutes a real value into every dynamic segment", () => {
    const dynamic = discoverRoutes().filter((route) => route.pattern.includes("["));
    expect(dynamic.length).toBeGreaterThan(0);
    for (const route of dynamic) {
      expect(route.url, `${route.pattern} still contains an unsubstituted segment`).not.toContain("[");
      expect(route.url).not.toContain("]");
    }
  });
});

describe("route inventory — derivation rules", () => {
  it("maps nested pages to nested URLs and the root page to /", () => {
    const dir = scaffold(["page.tsx", "brain/page.tsx", "settings/ai/page.tsx"]);
    expect(discoverRoutes(dir).map((r) => r.pattern)).toEqual(["/", "/brain", "/settings/ai"]);
  });

  it("ignores api handlers, private folders and parallel slots", () => {
    const dir = scaffold([
      "page.tsx",
      "api/health/route.ts",
      "api/health/page.tsx", // even a page under api/ is not a user route
      "_internal/page.tsx",
      "@modal/page.tsx",
    ]);
    expect(discoverRoutes(dir).map((r) => r.pattern)).toEqual(["/"]);
  });

  it("treats a route group as organisational — it contributes no URL segment", () => {
    const dir = scaffold(["(marketing)/pricing/page.tsx"]);
    expect(discoverRoutes(dir).map((r) => r.pattern)).toEqual(["/pricing"]);
  });

  it("throws on a dynamic segment with no sample value rather than guessing one", () => {
    const dir = scaffold(["reports/[reportId]/page.tsx"]);
    // A guessed placeholder would exercise a not-found path while reporting the page as covered.
    expect(() => discoverRoutes(dir)).toThrow(/no sample value/);
  });

  it("percent-encodes the sample so a colon-bearing instrument id survives the URL", () => {
    const route = discoverRoutes().find((r) => r.pattern === "/analyze/[ticker]");
    expect(route?.url).toBe("/analyze/IN%3AXNSE%3ARELIANCE");
  });
});
