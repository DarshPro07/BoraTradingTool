import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The expected-skip manifest (owner rule 2026-08-15): an acceptance summary's "N skipped" must be
 * attributable, never a bare number. Every DELIBERATE skip carries a typed classification tag —
 * `EXPECTED_SKIP(<CLASS>): <reason>` — and this test pins exactly where those tags live, so a new
 * expected skip cannot join the count silently: it must be added here, consciously.
 *
 * Scope: only the always-on deliberate skips. Runtime-conditional skips (a stock the ingestion
 * sweep honestly refused, the mobile-project self-skips excluded at the runner) are situational
 * and stay untagged; they fired zero times in the verdict pair (runs 13/14, "2 skipped" = the two
 * app.spec.ts fixture tests below).
 */

const E2E_DIR = path.resolve(__dirname, "..");

/** file (relative to e2e/) → number of EXPECTED_SKIP( source sites it must contain. */
const MANIFEST: Record<string, number> = {
  // One shared reason constant covering the two MARKETPULSE_TEST_MODE fixture tests — the
  // acceptance pair's entire "2 skipped".
  "app.spec.ts": 1,
};

function specFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(full);
    return entry.name.endsWith(".spec.ts") || entry.name.endsWith(".setup.ts") ? [full] : [];
  });
}

describe("the expected-skip manifest", () => {
  it("every EXPECTED_SKIP site in the suite is manifested, and every manifested site exists", () => {
    const found: Record<string, number> = {};
    for (const file of specFiles(E2E_DIR)) {
      const count = (fs.readFileSync(file, "utf8").match(/EXPECTED_SKIP\(/g) ?? []).length;
      if (count > 0) found[path.relative(E2E_DIR, file).replace(/\\/g, "/")] = count;
    }
    expect(
      found,
      "an EXPECTED_SKIP appeared or vanished without editing the manifest — classify it here, deliberately",
    ).toEqual(MANIFEST);
  });

  it("the tagged reason names its class in the machine-readable form", () => {
    const source = fs.readFileSync(path.join(E2E_DIR, "app.spec.ts"), "utf8");
    expect(source).toMatch(/EXPECTED_SKIP\(EXTERNAL_DEPENDENCY\): requires MARKETPULSE_TEST_MODE fixtures/);
  });
});
