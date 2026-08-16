import { describe, expect, it } from "vitest";
import { NSE_QC_001_SEEDS, NSE_QC_001_XSEC_SEED } from "./campaigns/nse-qc-001-seeds";
import {
  crossSectionalRecord,
  parseStrategyDefinition,
  strategyKindOf,
} from "./definition";

/**
 * The lifecycle has to hold two typed strategy representations without either pretending to be the
 * other. Before this existed, every reader `safeParse`d the stored JSON as a DSL and skipped on
 * failure — safe, but silent: a cross-sectional spec would never appear in a rehearsal, a funnel
 * or a family count, and its absence would look like a strategy nobody had tried rather than one
 * the reader could not read.
 */

describe("routing a stored definition to the right engine", () => {
  it("reads an instrument DSL, and every campaign seed is one", () => {
    for (const seed of NSE_QC_001_SEEDS) {
      const result = parseStrategyDefinition(JSON.stringify(seed.dsl));
      expect(result.ok, seed.dsl.name).toBe(true);
      if (!result.ok) continue;
      expect(result.definition.kind).toBe("INSTRUMENT");
    }
  });

  it("reads the cross-sectional IR when it carries its marker", () => {
    const json = JSON.stringify(crossSectionalRecord(NSE_QC_001_XSEC_SEED.strategy));
    const result = parseStrategyDefinition(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.kind).toBe("CROSS_SECTIONAL");
    if (result.definition.kind !== "CROSS_SECTIONAL") return;
    expect(result.definition.strategy.topN).toBe(NSE_QC_001_XSEC_SEED.strategy.topN);
    expect(result.definition.strategy.lookbackDays).toBe(NSE_QC_001_XSEC_SEED.strategy.lookbackDays);
  });

  it("treats a row with no marker as an instrument DSL — history is not rewritten", () => {
    // Every spec written before the discriminator existed is a DSL. Backfilling a `kind` field
    // into those rows would edit history to make a parser's life easier.
    const legacy = JSON.stringify(NSE_QC_001_SEEDS[0].dsl);
    expect(JSON.parse(legacy).kind).toBeUndefined();
    expect(strategyKindOf(legacy)).toBe("INSTRUMENT");
  });
});

describe("refusing rather than guessing", () => {
  it("refuses a row marked CROSS_SECTIONAL that lacks the ranking fields", () => {
    // A mislabelled row must not reach the ranking engine and dereference undefined.
    const broken = JSON.stringify({ kind: "CROSS_SECTIONAL", universe: { market: "NSE" } });
    const result = parseStrategyDefinition(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNREADABLE_DEFINITION");
    expect(result.message).toMatch(/lookbackDays/);
  });

  it("refuses an unparseable row as a fact about that row, without throwing", () => {
    // One bad spec must not take down a rehearsal pass over all the others.
    expect(() => parseStrategyDefinition("{ not json")).not.toThrow();
    expect(parseStrategyDefinition("{ not json").ok).toBe(false);
    expect(parseStrategyDefinition("null").ok).toBe(false);
  });

  it("refuses a DSL that is not valid, naming what was wrong", () => {
    const result = parseStrategyDefinition(JSON.stringify({ name: "x" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/instrument DSL/i);
  });

  it("does not let a cross-sectional IR pass as a DSL when its marker is missing", () => {
    // The IR has no `entry`/`exit`, so DSL validation rejects it. Without the marker it is simply
    // unreadable — which is the honest answer, not a silent reinterpretation.
    const unmarked = JSON.stringify(NSE_QC_001_XSEC_SEED.strategy);
    expect(parseStrategyDefinition(unmarked).ok).toBe(false);
  });
});
