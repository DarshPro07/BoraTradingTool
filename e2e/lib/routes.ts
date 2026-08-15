import fs from "node:fs";
import path from "node:path";

/**
 * Route inventory, derived from the filesystem.
 *
 * This lives outside the spec so it can be unit-tested without a browser, and so the derivation
 * itself is verifiable rather than assumed. It replaced a hand-written list in
 * `e2e/all-routes.spec.ts` that had silently drifted: it named `/factory` and `/forward` (neither
 * exists) and omitted `/edge-factory` (which does). A hand-maintained inventory cannot detect a
 * route it does not know about.
 */

const DEFAULT_APP_DIR = path.join(process.cwd(), "app");

/**
 * Concrete values for dynamic segments. A dynamic route cannot be visited without one, and
 * inventing a placeholder would test an error path while pretending to test the page. A new
 * dynamic segment throws until it is given a real value here — deliberately loud.
 */
export const DYNAMIC_SEGMENT_SAMPLES: Record<string, string> = {
  "/analyze/[ticker]": "IN:XNSE:RELIANCE",
  // A TeamRun id that will not exist on an arbitrary database — the page's honest empty state
  // ("No TeamRun … exists in the ledger") is itself the render under test here; real trees are
  // driven by e2e/brain-executions.spec.ts, which mints a live TeamRun and drills it.
  "/brain/executions/[id]": "tmr_route_probe",
};

export interface DiscoveredRoute {
  /** The route pattern as it appears on disk, e.g. `/analyze/[ticker]`. */
  pattern: string;
  /** The URL actually visited, with dynamic segments substituted and encoded. */
  url: string;
}

/**
 * Walk the App Router directory and derive the route each `page` file serves.
 *
 * Route groups `(name)` contribute no URL segment; `api/`, private `_folders` and parallel
 * `@slots` are skipped rather than guessed at (this application uses none of the latter two).
 */
export function discoverRoutes(appDir: string = DEFAULT_APP_DIR): DiscoveredRoute[] {
  const patterns: string[] = [];

  const walk = (dir: string, segments: string[]): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const name = entry.name;
        if (name === "api" || name.startsWith("_") || name.startsWith("@")) continue;
        const isGroup = name.startsWith("(") && name.endsWith(")");
        walk(path.join(dir, name), isGroup ? segments : [...segments, name]);
      } else if (entry.name === "page.tsx" || entry.name === "page.ts") {
        patterns.push(`/${segments.join("/")}`.replace(/\/+$/, "") || "/");
      }
    }
  };

  walk(appDir, []);

  return patterns.sort().map((pattern) => {
    const url = pattern.replace(/\[([^\]]+)\]/g, () => {
      const sample = DYNAMIC_SEGMENT_SAMPLES[pattern];
      if (sample === undefined) {
        throw new Error(
          `Route ${pattern} has a dynamic segment with no sample value. Add one to ` +
            `DYNAMIC_SEGMENT_SAMPLES in e2e/lib/routes.ts — a route cannot be verified without ` +
            `a real value for its parameter.`,
        );
      }
      return encodeURIComponent(sample);
    });
    return { pattern, url };
  });
}
