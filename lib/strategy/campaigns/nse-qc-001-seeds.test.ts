import { describe, expect, it } from "vitest";
import { compileStrategy, StrategyDslSchema } from "@/lib/strategy/dsl";
import { collectFeatures } from "@/lib/backtest/engine";
import { isDerivable } from "@/lib/backtest/features";
import { NSE_QC_001 } from "./nse-qc-001";
import { ENTRY_CUTOFF_MINUTE, NSE_QC_001_SEEDS, UNSEEDED_FAMILIES } from "./nse-qc-001-seeds";

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

  it("names why the un-seeded family cannot be expressed", () => {
    // Deferring is legitimate; deferring silently is not.
    expect(UNSEEDED_FAMILIES.fam_qc001_xsec_momentum).toMatch(/ranking/i);
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
