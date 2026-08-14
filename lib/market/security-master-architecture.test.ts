import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INSTRUMENT_CATALOG, NSE_ACCEPTANCE_UNIVERSE } from "./catalog";

/**
 * P0 FINAL PROOF — obsolete-invariant documentation for the first test below.
 *
 * OLD INVARIANT
 *   "The static catalog source file must not declare XNSE instruments at all."
 *   WHY IT EXISTED
 *   When the security master was the only NSE universe, a hardcoded XNSE row in the catalog
 *   could bypass master provenance and serve a symbol the exchange did not actually list.
 *
 * NEW REQUIREMENT
 *   The P0 acceptance requires a pinned, offline-deterministic 30-security XNSE universe.
 *   Declarations are therefore allowed, but ONLY from the pinned acceptance snapshot (plus the
 *   NIFTYBEES regime benchmark that the learning cycle and ticker tape depend on and that must
 *   stay resolvable without the master).
 *   WHY IT SUPERSEDES THE OLD INVARIANT
 *   The old rule made the acceptance universe network-dependent — it "passed or failed on what
 *   NSE happened to publish", which is not a test. The new rule keeps the old safety property
 *   (no arbitrary XNSE declarations) while adding determinism: drift is now a pinned-set
 *   deviation instead of any presence at all.
 *
 * TEST CHANGE
 *   The regex "no XNSE instrument() calls" is replaced by a set-containment check per declared
 *   security. A new XNSE symbol not in the acceptance universe (and not NIFTYBEES) fails
 *   loudly — which is exactly the old test's intent, enforced at the semantic layer.
 */

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx|mts)$/.test(entry.name) ? [absolute] : [];
  });
}

describe("the NSE security master is the provenance layer over a pinned acceptance universe", () => {
  it("restricts static-catalog XNSE declarations to the pinned acceptance universe", () => {
    const declared = INSTRUMENT_CATALOG.filter((item) => item.exchange === "XNSE").map((item) => item.symbol);
    // Exactly 30 acceptance securities, all declared, all unique.
    expect(NSE_ACCEPTANCE_UNIVERSE).toHaveLength(30);
    expect(new Set(NSE_ACCEPTANCE_UNIVERSE).size).toBe(30);
    const authorized = new Set([...NSE_ACCEPTANCE_UNIVERSE, "NIFTYBEES"]);
    const unexpected = declared.filter((symbol) => !authorized.has(symbol));
    expect(unexpected, "XNSE declarations outside the pinned acceptance universe").toEqual([]);
    for (const symbol of NSE_ACCEPTANCE_UNIVERSE) {
      expect(declared, `acceptance security ${symbol} missing from the static catalog`).toContain(symbol);
    }
  });

  it("prevents production consumers from importing the static catalog array directly", () => {
    const allowed = new Set([
      path.normalize("lib/market/catalog.ts"),
      path.normalize("lib/market/instruments.ts"),
    ]);
    const offenders = ["app", "components", "lib", "mcp", "scripts"]
      .flatMap((root) => sourceFiles(path.join(process.cwd(), root)))
      .filter((absolute) => !absolute.includes(".test.") && !absolute.includes("test-fixture"))
      .filter((absolute) => !allowed.has(path.normalize(path.relative(process.cwd(), absolute))))
      .filter((absolute) => /import[^;]*\bINSTRUMENT_CATALOG\b[^;]*from/.test(fs.readFileSync(absolute, "utf8")))
      .map((absolute) => path.relative(process.cwd(), absolute));

    expect(offenders).toEqual([]);
  });

  it("enumerates research snapshots from stored evidence rather than today's listings", () => {
    const snapshot = fs.readFileSync(path.join(process.cwd(), "lib/research-data/snapshot.ts"), "utf8");
    expect(snapshot).toContain("selectDistinct({ ticker: schema.priceCandles.ticker })");
    expect(snapshot).not.toMatch(/from ["']@\/lib\/market\/catalog["']/);
  });
});
