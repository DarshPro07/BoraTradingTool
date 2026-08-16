import { describe, expect, it } from "vitest";
import { compileStrategy, StrategyDslSchema } from "@/lib/strategy/dsl";
import { collectFeatures } from "@/lib/backtest/engine";
import { isDerivable } from "@/lib/backtest/features";
import { NSE_QC_001 } from "./nse-qc-001";
import { runCrossSectionalBacktest } from "@/lib/backtest/cross-sectional";
import {
  ENTRY_CUTOFF_MINUTE,
  NSE_QC_001_SEEDS,
  NSE_QC_001_XSEC_SEED,
  UNSEEDED_FAMILIES,
} from "./nse-qc-001-seeds";

/**
 * Measured 2026-08-16: all five declared families held ZERO specs, and the factory is a breeder
 * that inherits a parent's family and refuses to invent one — so a family with no seed could
 * never receive a descendant. The campaign was structurally unable to begin.
 *
 * These tests hold the seeds to the contract they claim to implement. A seed that drifts outside
 * its family's declared variant space is a silently widened search box, which is the exact failure
 * the pinned contract exists to prevent.
 */

describe("every declared family is accounted for", () => {
  it("is either seeded or explicitly listed as un-seeded, never forgotten", () => {
    const declared = NSE_QC_001.families.map((family) => family.familyId).sort();
    const covered = [
      ...NSE_QC_001_SEEDS.map((seed) => seed.familyId),
      ...Object.keys(UNSEEDED_FAMILIES),
    ].sort();
    expect(covered).toEqual(declared);
  });

  it("names why the un-filed family is not yet a spec row", () => {
    // Deferring is legitimate; deferring silently is not. The family is now EXECUTABLE — what is
    // deferred is filing it into a lifecycle written against a different representation.
    expect(UNSEEDED_FAMILIES.fam_qc001_xsec_momentum).toMatch(/lifecycle|StrategyDsl/i);
  });

  it("the cross-sectional family has an executable seed, even without a spec row", () => {
    expect(NSE_QC_001_XSEC_SEED.familyId).toBe("fam_qc001_xsec_momentum");
    expect(NSE_QC_001_XSEC_SEED.strategy.universe.resolution).toBe("D");
  });
});

describe("each seed is a valid, executable strategy", () => {
  for (const seed of NSE_QC_001_SEEDS) {
    it(`${seed.familyId}: parses and compiles`, () => {
      const parsed = StrategyDslSchema.safeParse(seed.dsl);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      const compiled = compileStrategy(seed.dsl);
      expect(compiled.ok, compiled.ok ? "" : compiled.message).toBe(true);
    });

    it(`${seed.familyId}: uses only features this engine can derive`, () => {
      // The whole point of the exercise. A seed referencing an underivable feature would sit in
      // draft looking untested when it was never testable — which is how three hand-authored
      // strategies spent a week blocked on `market_cap`.
      const required = new Set<string>();
      collectFeatures(seed.dsl.entry, required);
      if (seed.dsl.exit.condition) collectFeatures(seed.dsl.exit.condition, required);
      const underivable = [...required].filter((feature) => !isDerivable(feature));
      expect(underivable).toEqual([]);
    });

    it(`${seed.familyId}: matches its family's declared resolution`, () => {
      const family = NSE_QC_001.families.find((f) => f.familyId === seed.familyId)!;
      const wantsIntraday = family.dataRequirement.resolution === "INTRADAY_5M";
      expect(seed.dsl.universe.resolution).toBe(wantsIntraday ? "5m" : "D");
    });

    it(`${seed.familyId}: states why every declared dimension took its value`, () => {
      expect(seed.rationale.length).toBeGreaterThan(80);
    });
  }
});

describe("the declared session rules are actually enforced", () => {
  const intradaySeeds = NSE_QC_001_SEEDS.filter((s) => s.dsl.universe.resolution === "5m");

  it("every intraday seed respects the 14:30 IST entry cutoff", () => {
    // NSE opens 09:15, so 14:30 is minute 315. Every intraday family declares this cutoff, and a
    // seed that ignored it would be trading a different contract from the one pinned.
    for (const seed of intradaySeeds) {
      const json = JSON.stringify(seed.dsl.entry);
      expect(json, seed.familyId).toContain(`"minutes_since_open"`);
      expect(json, seed.familyId).toContain(String(ENTRY_CUTOFF_MINUTE));
    }
    expect(intradaySeeds.length).toBe(3);
  });

  it("the midday-fade seed does not trade the open or the close", () => {
    const mr = NSE_QC_001_SEEDS.find((s) => s.familyId === "fam_qc001_intraday_mr")!;
    const json = JSON.stringify(mr.dsl.entry);
    expect(json).toContain("105"); // 11:00 IST
    expect(json).toContain("315"); // 14:30 IST
  });

  it("the midday-fade seed fades only NORMAL volume, as declared", () => {
    // "stretched moves WITHOUT abnormal volume revert" — the rvol CEILING is the hypothesis, not
    // a detail. A seed that dropped it would be testing a different claim.
    const mr = NSE_QC_001_SEEDS.find((s) => s.familyId === "fam_qc001_intraday_mr")!;
    const entry = JSON.stringify(mr.dsl.entry);
    expect(entry).toMatch(/"feature":"rvol","op":"lte"/);
  });

  it("the swing seed keeps its long-trend filter", () => {
    // "provided the longer trend remains intact" is part of the declared mechanism.
    const swing = NSE_QC_001_SEEDS.find((s) => s.familyId === "fam_qc001_swing_mr")!;
    expect(JSON.stringify(swing.dsl.entry)).toContain("sma200");
  });
});

describe("the cross-sectional seed sits inside its declared variant space", () => {
  const seed = NSE_QC_001_XSEC_SEED.strategy;

  /**
   * `fam_qc001_xsec_momentum` declares: lookback 20-120 trading days, skip_recent 0-5, top_n 5-20,
   * rebalance every 5-10, ranking raw or volatility-scaled, regime filter optional. A seed outside
   * that box is a silently widened search, which is exactly what the pinned contract prevents.
   */
  it("keeps every parameter within the pinned ranges", () => {
    expect(seed.lookbackDays).toBeGreaterThanOrEqual(20);
    expect(seed.lookbackDays).toBeLessThanOrEqual(120);
    expect(seed.skipRecentDays).toBeGreaterThanOrEqual(0);
    expect(seed.skipRecentDays).toBeLessThanOrEqual(5);
    expect(seed.topN).toBeGreaterThanOrEqual(5);
    expect(seed.topN).toBeLessThanOrEqual(20);
    expect(seed.rebalanceDays).toBeGreaterThanOrEqual(5);
    expect(seed.rebalanceDays).toBeLessThanOrEqual(10);
    expect(["RAW_RETURN", "VOL_SCALED_RETURN"]).toContain(seed.ranking);
  });

  it("holds the TOP of the ranking, as a momentum family must", () => {
    // BOTTOM would be a reversal strategy wearing the momentum family's name.
    expect(seed.direction).toBe("TOP");
  });

  it("skips recent days, because the declared mechanism says to", () => {
    expect(seed.skipRecentDays).toBeGreaterThan(0);
  });

  it("actually runs, over a universe wide enough to be a cross-section", () => {
    const dataset: Record<string, { time: number; open: number; high: number; low: number; close: number; volume: number }[]> = {};
    for (let i = 0; i < 20; i += 1) {
      const drift = 1 + (i - 10) * 0.002;
      dataset[`IN:XNSE:X${i}`] = Array.from({ length: 150 }, (_unused, day) => {
        const close = 100 * drift ** day;
        return { time: 1_700_000_000 + day * 86_400, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1_000 };
      });
    }
    const result = runCrossSectionalBacktest(seed, dataset as never);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.instrumentsRanked).toBe(20);
  });
});
