import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx|mts)$/.test(entry.name) ? [absolute] : [];
  });
}

describe("the NSE security master is the only production universe", () => {
  it("contains no hardcoded XNSE declarations in the static catalog", () => {
    const catalog = fs.readFileSync(path.join(process.cwd(), "lib/market/catalog.ts"), "utf8");
    expect(catalog).not.toMatch(/instrument\(\{\s*market:\s*"IN",\s*exchange:\s*"XNSE"/);
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
