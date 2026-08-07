import { describe, expect, it } from "vitest";
import { POINT_IN_TIME_FEATURES, UNSUPPORTED_BY_ENGINE, compileStrategy, StrategyDslSchema } from "./dsl";
import { DERIVABLE_FEATURES, UNAVAILABLE_FEATURES } from "@/lib/backtest/features";

/**
 * The defect this file exists to prevent recurring:
 *
 * The DSL permitted `market_cap`, `sector_relative_strength`, `earnings_surprise_pct` and
 * `days_since_earnings`. The compiler accepted them without comment. The failure appeared only
 * when a backtest was attempted, as `FEATURE_NOT_AVAILABLE` — by which point the strategy had
 * been sitting in `draft` looking merely untested rather than untestable.
 *
 * Both strategies in the live database were in exactly that state, and nothing surfaced it until
 * the autonomous rehearsal ran.
 */

function spec(entryFeature: string) {
  return StrategyDslSchema.parse({
    name: "feature_probe",
    universe: { market: "US", maxPositions: 10 },
    entry: { feature: entryFeature, op: "gt", value: 1 },
    exit: { afterDays: 10, stopLossPct: 5 },
    sizing: { maxPositionPct: 5 },
    costs: { commissionBps: 5, slippageBps: 5 },
  });
}

describe("the two feature lists cannot drift apart", () => {
  it("agrees with what the feature panel says it cannot derive", () => {
    // dsl.ts declares this list because features.ts imports from dsl.ts — importing back would
    // be circular. This assertion is what keeps the duplication honest.
    expect([...UNSUPPORTED_BY_ENGINE].sort()).toEqual([...UNAVAILABLE_FEATURES].sort());
  });

  it("partitions the permitted features exactly, leaving none unaccounted for", () => {
    const covered = new Set<string>([...DERIVABLE_FEATURES, ...UNSUPPORTED_BY_ENGINE]);
    for (const feature of POINT_IN_TIME_FEATURES) {
      expect(covered.has(feature), `${feature} is neither derivable nor listed as unsupported`).toBe(true);
    }
    expect(covered.size).toBe(POINT_IN_TIME_FEATURES.length);
  });

  it("never lists a feature as both derivable and unsupported", () => {
    for (const feature of UNSUPPORTED_BY_ENGINE) {
      expect((DERIVABLE_FEATURES as readonly string[]).includes(feature)).toBe(false);
    }
  });
});

describe("the compiler warns at authoring time", () => {
  it("names an unsupported feature rather than compiling silently", () => {
    const result = compileStrategy(spec("market_cap"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((text) => text.includes("market_cap"));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/cannot be backtested/);
  });

  it("blames lookahead, not a missing data source, for forecast features", () => {
    // The distinction is the whole point. `market_cap` needs a source that does not exist.
    // `forecast_return_1d` has a source — one current file per instrument — and replaying it
    // across history would apply today's prediction to last year's decisions. That failure does
    // not error; it produces a spectacular equity curve, which is far more dangerous.
    const result = compileStrategy(spec("forecast_return_1d"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((text) => text.includes("forecast_return_1d")) ?? "";
    expect(warning).toMatch(/lookahead/);
    expect(warning).toMatch(/point-in-time forecast archive/);
    // It must not be lumped in with the "no source supplies them" group.
    expect(warning).not.toMatch(/No engine can derive these from price data/);
  });

  it("still compiles, because the strategy is expressible and the gap is in the data", () => {
    // A hard error would be wrong: the strategy is not malformed, the deployment is incomplete.
    // Refusing to compile it would also silently discard a legitimate research idea.
    expect(compileStrategy(spec("sector_relative_strength")).ok).toBe(true);
  });

  it("says nothing when every feature is derivable", () => {
    const result = compileStrategy(spec("rsi14"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((text) => text.includes("cannot be backtested"))).toBe(false);
  });

  it("lists every unsupported feature a strategy uses, not just the first", () => {
    const result = compileStrategy(
      StrategyDslSchema.parse({
        name: "feature_probe",
        universe: { market: "US", maxPositions: 10 },
        entry: {
          all: [
            { feature: "market_cap", op: "gt", value: 1 },
            { feature: "days_since_earnings", op: "lt", value: 5 },
          ],
        },
        exit: { afterDays: 10, stopLossPct: 5 },
        sizing: { maxPositionPct: 5 },
        costs: { commissionBps: 5, slippageBps: 5 },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((text) => text.includes("cannot be backtested")) ?? "";
    expect(warning).toContain("market_cap");
    expect(warning).toContain("days_since_earnings");
  });
});
