import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Owner test 12 (13b): "Reintroducing provider fallback causes regression tests to fail."
 *
 * A source pin, in the same spirit as the governance path tests: the research-evaluation modules
 * must not even IMPORT the provider machinery. Behavioral tests can be satisfied by a fallback
 * that only fires on a path the test doesn't walk; an import ban cannot. If a future change needs
 * one of these tokens here, it is changing the historical-research data contract and must update
 * this test — and `docs/plans/snapshot-evaluation/` — deliberately, in the open.
 */

const EVALUATION_MODULES = [
  "lib/learning/rehearsal.ts",
  "lib/strategy/gauntlet.ts",
  "lib/strategy/auto-gauntlet.ts",
  "app/api/strategy/gauntlet/route.ts",
  "lib/research-data/snapshot.ts",
  "lib/research-data/manifest.ts",
];

// `@/lib/providers/types` is deliberately NOT banned: it is a pure data shape (what a candle
// looks like), not machinery that can fetch one.
const PROVIDER_TOKENS = [
  "marketCandleLoader",
  "fetchMarketSample",
  "fetchInstrumentBars",
  "getNormalizedCandles",
  'from "@/lib/providers"',
  'from "@/lib/providers/yahoo',
  'from "@/lib/providers/finnhub',
  'from "@/lib/providers/indian',
  'from "@/lib/learning/dataset"', // the live/ingestion loader home
];

describe("research evaluation cannot reach a provider", () => {
  for (const module of EVALUATION_MODULES) {
    it(`${module} imports no provider machinery`, () => {
      const source = fs.readFileSync(path.join(process.cwd(), module), "utf8");
      for (const token of PROVIDER_TOKENS) {
        expect(source.includes(token), `${module} must not contain "${token}"`).toBe(false);
      }
    });
  }

  it("the snapshot module reads only the canonical store", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/research-data/snapshot.ts"), "utf8");
    expect(source).toContain("loadStoredCandles");
    expect(source).not.toContain("fetch(");
  });
});
