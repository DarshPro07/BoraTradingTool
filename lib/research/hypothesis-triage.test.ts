import { describe, expect, it } from "vitest";
import { compileStrategy, StrategyDslSchema } from "@/lib/strategy/dsl";
import {
  entryConditionFrom,
  hypothesisTriage,
  LEXICON_FEATURES,
  VOCABULARY,
} from "./hypothesis-triage";

/**
 * The three hypotheses this system has actually formed, used verbatim as fixtures.
 *
 * Synthetic examples would prove the code runs. These prove it gets the real cases right — and the
 * real cases are the whole argument for the design, because **two of the three must be refused**.
 * A triage that converted all three would be wrong twice, plausibly and silently.
 */

const GAUNTLET_BLIND_SPOT = {
  title: "Untriggered-signal blind spot in our own gauntlet",
  statement:
    "Our validation gauntlet shares Freqtrade's documented false-negative mode: a strategy whose entry " +
    "condition rarely triggers in the tested range can pass every stage while remaining unverified. " +
    "Coverage of triggered conditions is not recorded.",
  rationale:
    "Freqtrade documents that untriggered signals are never verified. Our gauntlet gates on trade count " +
    "in aggregate (minTradesForEvidence) but does not record which branches of a composite entry " +
    "condition actually fired.",
};

const GAP_AND_RVOL = {
  title: "Gap-and-RVOL screen transferred to NSE liquid mid-caps",
  statement:
    "A pre-market gap screen (gap >= 3%, relative volume >= 1, with price and liquidity floors) applied " +
    "to NSE liquid mid-caps produces candidates whose forward returns beat no-trade after realistic " +
    "Indian round-trip costs.",
  rationale:
    "The source's criteria are US day-trading screens with no validation. The transferable part is the " +
    "shape — gap plus relative volume plus a liquidity floor — not the thresholds.",
};

const MODEL_DISAGREEMENT = {
  title: "Model disagreement as a risk filter",
  statement:
    "On a shared evidence snapshot, instruments where two independently-prompted models reach opposing " +
    "stances resolve worse than instruments where they agree. If so, disagreement is usable as a skip " +
    "filter rather than merely something to display.",
  rationale:
    "The source treats disagreement as something to show the reader. Whether it carries information is " +
    "an empirical question this system can answer.",
};

describe("the two hypotheses that must be refused", () => {
  it("refuses a hypothesis about the validation machinery, not about a trade", () => {
    // The dangerous case. This text contains thresholds-adjacent language and would happily yield a
    // "strategy" from a converter that only looked for features. There is nothing to buy here.
    const result = hypothesisTriage(GAUNTLET_BLIND_SPOT);

    expect(result.verdict).toBe("NOT_A_TRADING_RULE");
    expect(result.conditions).toHaveLength(0);
    expect(result.reason).toMatch(/describes the system rather than a market position/i);
  });

  it("refuses a hypothesis needing a quantity this deployment cannot derive, and names it", () => {
    const result = hypothesisTriage(MODEL_DISAGREEMENT);

    expect(result.verdict).toBe("NEEDS_FEATURE");
    expect(result.missingQuantities.join(" ")).toMatch(/model disagreement/i);
    // "The data is absent" and "the idea is bad" have opposite remedies and must not be conflated.
    expect(result.reason).toMatch(/idea is not refused/i);
  });
});

describe("the one that can be expressed", () => {
  it("reads gap and relative-volume thresholds from the hypothesis's own words", () => {
    const result = hypothesisTriage(GAP_AND_RVOL);

    expect(result.verdict).toBe("EXPRESSIBLE");

    const byFeature = Object.fromEntries(result.conditions.map((c) => [c.feature, c]));
    expect(byFeature.gap_pct).toMatchObject({ op: "gte", value: 3 });
    expect(byFeature.rvol).toMatchObject({ op: "gte", value: 1 });
  });

  it("carries the exact words each condition was read from", () => {
    // A reader must be able to check the reading rather than trust it.
    const result = hypothesisTriage(GAP_AND_RVOL);
    for (const condition of result.conditions) {
      expect(condition.evidence.length).toBeGreaterThan(0);
      expect(GAP_AND_RVOL.statement.toLowerCase()).toContain(condition.evidence.slice(0, 10).toLowerCase());
    }
  });

  it("produces an entry condition the compiler accepts", () => {
    // The end-to-end point: a triage that emitted something `compileStrategy` rejects would have
    // produced a specification that can never be tested.
    const result = hypothesisTriage(GAP_AND_RVOL);
    const dsl = StrategyDslSchema.parse({
      name: "from_hypothesis",
      universe: { market: "NSE", maxPositions: 4, resolution: "D" },
      entry: entryConditionFrom(result.conditions),
      exit: { afterDays: 5, stopLossPct: 2 },
      sizing: { maxPositionPct: 25 },
      costs: { commissionBps: 5, slippageBps: 7 },
    });

    const compiled = compileStrategy(dsl);
    expect(compiled.ok).toBe(true);
  });
});

describe("it abstains rather than inventing", () => {
  it("refuses prose that mentions a feature but states no threshold", () => {
    // "Gap strategies are interesting" states no number. A strategy built from it would be testing
    // a threshold nobody chose.
    const result = hypothesisTriage({
      title: "Gaps are worth studying",
      statement: "Gap behaviour on Indian mid-caps deserves attention and may carry information.",
    });

    expect(result.verdict).toBe("UNCLEAR");
    expect(result.conditions).toHaveLength(0);
    // The refusal must own its limitation rather than blame the hypothesis.
    expect(result.reason).toMatch(/statement about this lexicon/i);
  });

  it("does not pair a feature with a number from an unrelated clause", () => {
    const result = hypothesisTriage({
      title: "Unrelated numbers",
      statement: "Relative volume matters. Separately, we hold at most 4 positions and 12 instruments.",
    });
    expect(result.conditions.find((c) => c.feature === "rvol")).toBeUndefined();
  });

  it("prefers the longer phrase, so 'relative volume' is not read as 'volume'", () => {
    const result = hypothesisTriage({
      title: "Phrase precedence",
      statement: "Screen for relative volume >= 2 on liquid names.",
    });
    expect(result.conditions.map((c) => c.feature)).toContain("rvol");
  });

  it("asks whether it is a trading rule before reading thresholds", () => {
    // Order matters: a meta-hypothesis containing a real threshold must still be refused as meta.
    const result = hypothesisTriage({
      title: "Our gauntlet and gaps",
      statement: "Our validation gauntlet ignores strategies where gap >= 3% rarely fires.",
    });
    expect(result.verdict).toBe("NOT_A_TRADING_RULE");
    expect(result.conditions).toHaveLength(0);
  });
});

describe("the lexicon cannot invent a feature", () => {
  it("only ever emits names that exist in the DSL vocabulary", () => {
    // The structural guarantee. However the prose is written, the table can only produce features
    // the compiler already knows — so hallucinating a feature is impossible rather than unlikely.
    for (const feature of LEXICON_FEATURES) {
      expect(VOCABULARY).toContain(feature);
    }
  });
});

describe("thresholds are read after the comparator, not from the indicator's period", () => {
  it("reads rsi_14 crosses above 70 as a threshold of 70, never 14", () => {
    // The defect this pins (found 2026-08-11 by the first real research→strategy hand-off):
    // the extractor located the comparator anywhere in the window but then took the FIRST number
    // in that window — which, for a feature written the way every researcher writes it
    // (`rsi_14`, `sma_20`, `atr_14`), is the indicator's PERIOD. The authored strategy's entry
    // rule became `rsi14 > 14`, which is true on essentially every bar. It backtests, it produces
    // trades, and it means nothing: a nonsense rule wearing the costume of a tested one.
    const result = hypothesisTriage({
      title: "TCS trend continuation",
      statement:
        "Open a long position when rsi_14 crosses above 70 and then turns down, evaluated on daily bar close.",
    });

    const rsi = result.conditions.find((condition) => condition.feature === "rsi14");
    expect(rsi, "rsi14 condition should be extracted").toBeDefined();
    expect(rsi?.value).toBe(70);
    expect(rsi?.op).toBe("gt");
  });

  it("still reads a threshold when the feature carries no period digits", () => {
    const result = hypothesisTriage({
      title: "Gap continuation",
      statement: "Enter when the gap is above 3 percent on the opening bar of the session.",
    });

    expect(result.conditions.find((condition) => condition.feature === "gap_pct")?.value).toBe(3);
  });
});
