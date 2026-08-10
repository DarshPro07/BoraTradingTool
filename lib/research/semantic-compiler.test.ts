import { describe, expect, it } from "vitest";
import { compileResearchProse, findFeatureMentions, verifySourceSpans } from "./semantic-compiler";

/**
 * Paragraph-level adversarial suite.
 *
 * The previous suite tested single clean clauses and passed while the compiler mangled a real
 * paragraph. Every case here is prose of the shape a model actually writes: indicator periods,
 * current values, percentages, parentheticals, entries and exits in one breath.
 *
 * The standing invariant, asserted structurally rather than case by case: **no number that names
 * an indicator's period, and no number describing the present, may become a trading threshold.**
 */

const thresholds = (result: ReturnType<typeof compileResearchProse>) =>
  result.conditions.flatMap((condition) =>
    condition.kind === "SCALAR"
      ? [condition.value as number]
      : condition.kind === "RANGE"
        ? [condition.low as number, condition.high as number]
        : [],
  );

const interpretations = (result: ReturnType<typeof compileResearchProse>) =>
  result.conditions.map((condition) => `${condition.scope}:${condition.interpreted}`);

describe("A — bare conditions", () => {
  it("reads a band and a feature comparison from one sentence", () => {
    const result = compileResearchProse("RSI-14 between 55 and 70 and close above SMA20.");

    expect(result.verdict).toBe("EXPRESSIBLE");
    expect(interpretations(result)).toEqual(
      expect.arrayContaining(["ENTRY:55 <= rsi14 <= 70", "ENTRY:close gt sma20"]),
    );
    expect(thresholds(result)).not.toContain(14);
    expect(thresholds(result)).not.toContain(20);
  });
});

describe("B — the defect that started this: observations next to rules", () => {
  const prose =
    "RSI is currently 64.1 and price is 1.6% above its 20-day SMA. " +
    "Enter only when RSI is between 55 and 70 and close is above SMA20.";

  it("uses the rules and refuses every descriptive number", () => {
    const result = compileResearchProse(prose);

    expect(result.verdict).toBe("EXPRESSIBLE");
    expect(interpretations(result)).toEqual(
      expect.arrayContaining(["ENTRY:55 <= rsi14 <= 70", "ENTRY:close gt sma20"]),
    );

    // None of the descriptive or parameter numbers may appear as a threshold.
    for (const forbidden of [64.1, 1.6, 20, 14, 50]) {
      expect(thresholds(result), `${forbidden} must never become a threshold`).not.toContain(forbidden);
    }
  });

  it("classifies the descriptive sentence as observation, not as a rule", () => {
    const result = compileResearchProse(prose);
    const observations = result.clauses.filter((clause) => clause.kind === "OBSERVATION");

    expect(observations.length).toBeGreaterThan(0);
    expect(observations[0].text).toContain("currently");
  });
});

describe("C — entry and exit are different scopes, not a contradiction", () => {
  it("keeps an exit threshold below the entry band without refusing", () => {
    const result = compileResearchProse(
      "Enter while RSI is between 55 and 70. Exit if RSI falls below 50.",
    );

    expect(result.verdict).toBe("EXPRESSIBLE");
    expect(result.contradictions).toEqual([]);
    expect(interpretations(result)).toEqual(
      expect.arrayContaining(["ENTRY:55 <= rsi14 <= 70", "EXIT:rsi14 lt 50"]),
    );
    expect(result.scopes.ENTRY).toEqual({
      all: [
        { feature: "rsi14", op: "gte", value: 55 },
        { feature: "rsi14", op: "lte", value: 70 },
      ],
    });
    expect(result.scopes.EXIT).toEqual({ feature: "rsi14", op: "lt", value: 50 });
  });
});

describe("D — a real contradiction is refused, with the conflicting clauses named", () => {
  it("refuses conditions that cannot hold together in one scope", () => {
    const result = compileResearchProse("RSI must be above 60 and below 50.");

    expect(result.verdict).toBe("CONTRADICTORY");
    expect(result.scopes.ENTRY).toBeUndefined();
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0].feature).toBe("rsi14");
    // The unsat core: which clauses conflict, in the author's own words.
    expect(result.contradictions[0].conflicting.length).toBeGreaterThanOrEqual(2);
    expect(result.reason).toContain("never fire");
  });
});

describe("E — one moving average against another", () => {
  it("compares the two features and never their periods", () => {
    const result = compileResearchProse("20-day SMA above 50-day SMA.");

    expect(result.verdict).toBe("EXPRESSIBLE");
    expect(interpretations(result)).toContain("ENTRY:sma20 gt sma50");
    expect(result.scopes.ENTRY).toEqual({ compare: ["sma20", "sma50"], op: "gt" });
    expect(thresholds(result)).toEqual([]);
  });
});

describe("the parameter guard, stated as one invariant", () => {
  const cases = [
    "20-day SMA above 50-day SMA.",
    "Enter when close is above the 200-day SMA.",
    "Enter when RSI-14 crosses above 70.",
    "Enter when the 12-day EMA crosses above the 26-day EMA.",
    "Enter when close is above SMA20 and RSI-14 is between 55 and 70.",
    "The ETF trades 1.6% above its 20-day SMA and its RSI-14 currently reads 64.1. " +
      "Consider entry only while RSI-14 remains between 55 and 70 and the close stays above SMA20. " +
      "The 50-day SMA is rising.",
  ];

  it("INDICATOR_PARAMETER_NEVER_BECOMES_THRESHOLD", () => {
    for (const prose of cases) {
      const result = compileResearchProse(prose);
      // Every period named by a feature this compiler found.
      const periods = findFeatureMentions(prose)
        .map((mention) => mention.parameters.period)
        .filter((period): period is number => typeof period === "number");

      for (const period of new Set(periods)) {
        expect(
          thresholds(result),
          `"${prose}" turned the period ${period} into a threshold: ${JSON.stringify(result.conditions)}`,
        ).not.toContain(period);
      }
    }
  });

  it("names the refusal when a clause offers only a parameter as its operand", () => {
    const result = compileResearchProse("Enter when close is above the 20-day SMA of 20.");
    expect(result.verdict).not.toBe("CONTRADICTORY");
    // Whatever it concludes, no condition may carry 20 as a level.
    expect(thresholds(result)).not.toContain(20);
  });
});

describe("the real NIFTYBEES paragraph that produced the defect", () => {
  const prose =
    "When NIFTYBEES closes above both its 20-day and 50-day SMAs while RSI-14 sits in the 50-70 " +
    "range (currently 64.1, price +1.6% above SMA20 and +2.76% above SMA50), the resulting uptrend " +
    "regime tends to persist rather than immediately reverse, and this can be tested as a " +
    "trend-continuation rule.";

  it("never reproduces the seven-condition nonsense rule", () => {
    const result = compileResearchProse(prose);

    // The exact defects recorded in FINDINGS 01:40, each asserted individually.
    expect(interpretations(result)).not.toContain("ENTRY:sma50 gt 50");
    expect(interpretations(result)).not.toContain("ENTRY:sma20 lt 50");
    expect(interpretations(result)).not.toContain("ENTRY:close gt 20");
    for (const forbidden of [20, 50, 14, 64.1, 1.6, 2.76]) {
      expect(thresholds(result), `${forbidden} came from a period or an observation`).not.toContain(forbidden);
    }
  });

  it("either compiles something correct or refuses honestly — never something plausible and wrong", () => {
    const result = compileResearchProse(prose);

    expect(["EXPRESSIBLE", "NO_RULE_FOUND", "CONTRADICTORY"]).toContain(result.verdict);
    if (result.verdict === "EXPRESSIBLE") {
      // Anything it did author must be a faithful reading of the prose.
      for (const condition of result.conditions) {
        expect(["close", "sma20", "sma50", "rsi14"]).toContain(condition.feature.id);
      }
    } else {
      expect(result.reason.length).toBeGreaterThan(20);
    }
  });
});

describe("source spans", () => {
  it("every authored condition quotes the prose exactly", () => {
    for (const prose of [
      "Enter while RSI is between 55 and 70. Exit if RSI falls below 50.",
      "RSI-14 between 55 and 70 and close above SMA20.",
      "20-day SMA above 50-day SMA.",
    ]) {
      const result = compileResearchProse(prose);
      expect(verifySourceSpans(result, prose), `span mismatch in "${prose}"`).toEqual([]);
    }
  });
});
