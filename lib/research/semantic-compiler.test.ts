import { describe, expect, it } from "vitest";
import { parseFixtures } from "./syntax/fixtures";

// The parse is DATA, not a service call: `compileResearchProse` stays synchronous and
// `hypothesisTriage` stays pure. Fixtures are real output from the pinned `en_core_web_sm`,
// recorded once (see lib/research/syntax/fixtures.ts).
const compileResearchProse = (prose: string) => compileWithParse(prose, parseFixtures(prose));

import {
  compileResearchProse as compileWithParse,
  findDimensionErrors,
  findFeatureMentions,
  findParameterSpans,
  verifySourceSpans,
} from "./semantic-compiler";

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

describe("live TCS probe — an exit clause that mentions the entry PRICE", () => {
  // Verbatim from a real claude-sonnet-5 research run, 2026-08-11. The compiler refused this as
  // CONTRADICTORY because "from the entry price" — a reference to an existing position — was read
  // as an entry RULE, so the exit's "rsi_14 crosses above 70" inherited ENTRY scope and conflicted
  // with the entry band 50-70. The prose is coherent; the classification was not.
  const prose =
    "While TCS closes above both its 20-day and 50-day SMAs with RSI-14 in the 50-70 " +
    "neutral-to-bullish band (not overbought), the prevailing uptrend is more likely to persist " +
    "than reverse over a multi-week swing horizon. Entry: Open a long position when close remains " +
    "above sma_20 and sma_20 remains above sma_50 (trend intact) and rsi_14 is between 50 and 70 " +
    "(momentum present but not overbought), ideally on a pullback toward sma_20 rather than at a " +
    "fresh high. Exit: Close the position (stop) if close falls below sma_50, or if a close drops " +
    "more than 2x atr_14 (~133.7 points) from the entry price, or if rsi_14 crosses above 70 and " +
    "then rolls back below it, signalling momentum exhaustion; also exit on close below sma_20 if " +
    "a tighter, trend-following stop is preferred.";

  it("keeps the exit's RSI-70 clause out of the entry scope", () => {
    const result = compileResearchProse(prose);

    const entryRsi = result.conditions.filter(
      (condition) => condition.scope === "ENTRY" && condition.feature.id === "rsi14",
    );
    // The entry states exactly one RSI constraint: the band.
    expect(entryRsi).toHaveLength(1);
    expect(entryRsi[0].kind).toBe("RANGE");
    expect(entryRsi[0].low).toBe(50);
    expect(entryRsi[0].high).toBe(70);
    expect(result.verdict).not.toBe("CONTRADICTORY");
  });

  it("still treats a real entry instruction as a rule", () => {
    expect(compileResearchProse("Entry: enter when close is above SMA20.").scopes.ENTRY).toEqual({
      compare: ["close", "sma20"],
      op: "gt",
    });
    expect(compileResearchProse("Consider entry only while RSI is between 55 and 70.").scopes.ENTRY).toBeDefined();
  });
});

describe("the invariant, closed against its own blind spot", () => {
  /**
   * The earlier version of this invariant only checked periods of features the compiler MANAGED to
   * resolve. "the 20-day and 50-day SMAs" is elliptical — "20-day" has no adjacent indicator, so
   * no mention formed, so its period was not in the list, so the assertion could not see the leak.
   * The live TCS probe then authored `close > 20`.
   *
   * This version reads the periods out of the PROSE, independently of what the compiler
   * understood. It fails whether or not the feature was recognised.
   */
  const REAL_PROSE = [
    "TCS is in an established uptrend (last close above both the 20-day and 50-day SMAs, with " +
      "RSI-14 in a constructive but non-overbought 60 zone), so a pullback toward the 20-day SMA " +
      "is a testable long-continuation entry. Entry: enter when close is above sma_20 and rsi_14 " +
      "is between 45 and 65. Exit: exit when close falls below sma_50.",
    "When NIFTYBEES closes above its 20-day SMA while the 20-day SMA remains above the 50-day SMA " +
      "and RSI-14 is in the 50-70 momentum band, price tends to continue. Entry: enter when close " +
      "is above sma_20 and rsi_14 is between 50 and 70. Exit: exit when rsi_14 falls below 40.",
    "Enter when the close is above both the 20-day and 200-day moving averages.",
    "Hold while price stays above the 50-day and 100-day averages.",
  ];

  it("no threshold is ever SOURCED from a span that names a period", () => {
    // Stated positionally, not by value. The same numeral can legitimately be both: in
    // "the 50-day SMA ... rsi_14 between 50 and 70", 50 is a period in one clause and a real
    // threshold in another. What must never happen is a threshold whose SOURCE SPAN is a period —
    // which is exactly what `close > 20` was. Provenance, not coincidence.
    for (const prose of REAL_PROSE) {
      const result = compileResearchProse(prose);
      const parameterSpans = findParameterSpans(prose);

      for (const condition of result.conditions) {
        if (condition.kind !== "SCALAR" && condition.kind !== "RANGE") continue;
        const overlapping = parameterSpans.find(
          (span) => condition.sourceStart < span.end && span.start < condition.sourceEnd,
        );
        expect(
          overlapping,
          `"${condition.interpreted}" was read from "${overlapping?.text}", which names a period`,
        ).toBeUndefined();
      }
    }
  });

  it("a comparator whose only operand is a period is refused, not guessed", () => {
    const result = compileResearchProse("Enter when the close is above the 20-day and 50-day SMAs.");

    expect(thresholds(result)).not.toContain(20);
    expect(thresholds(result)).not.toContain(50);
    // Either it resolved the comparison to a feature, or it refused. Never a number.
    for (const condition of result.conditions) {
      expect(condition.kind).not.toBe("SCALAR");
    }
  });
});

describe("an operator belongs to the feature nearest its LEFT", () => {
  // Live TCS/NIFTYBEES probes, 2026-08-11: taking the clause's FIRST mention as the subject of
  // every operator put the RSI band on sma20 — `50 <= sma20 <= 70` — comparing a price in the
  // thousands to an oscillator level. It authored cleanly, which is what made it dangerous.
  it("puts an RSI band on RSI, not on the SMA mentioned earlier in the clause", () => {
    const result = compileResearchProse(
      "Enter when close is above both its 20-day and 50-day SMAs with RSI-14 between 50 and 70.",
    );

    const band = result.conditions.find((condition) => condition.kind === "RANGE");
    expect(band?.feature.id).toBe("rsi14");
    // And nothing price-like carries an oscillator level.
    for (const condition of result.conditions) {
      if (condition.feature.id.startsWith("sma") || condition.feature.id === "close") {
        expect(condition.kind).not.toBe("RANGE");
      }
    }
  });

  it("keeps a scalar threshold on the feature the comparator follows", () => {
    const result = compileResearchProse("Enter when the 50-day SMA is rising and RSI-14 is above 55.");
    const scalar = result.conditions.find((condition) => condition.kind === "SCALAR");

    expect(scalar?.feature.id).toBe("rsi14");
    expect(scalar?.value).toBe(55);
  });
});

describe("dimensional analysis — the guard that makes attachment failures safe", () => {
  // Live probes, 2026-08-11: misattached operators produced `rsi14 >= 2473.7` (a share price on an
  // oscillator) and `compare: [rsi14, sma20]` (an oscillator against a moving average). Both are
  // perfectly SATISFIABLE, so no contradiction check could catch them — they are simply not about
  // anything. This guard cannot fix attachment; it refuses to author when attachment is wrong.
  it("refuses an oscillator carrying a price-scale level", () => {
    const errors = findDimensionErrors([
      {
        kind: "SCALAR", scope: "ENTRY", clauseId: "c0",
        feature: { id: "rsi14", indicator: "RSI", parameters: { period: 14 } },
        op: "gte", value: 2473.7,
        sourceText: "rsi_14 above 2473.7", sourceStart: 0, sourceEnd: 19,
        evidence: "EXPLICIT", interpreted: "rsi14 gte 2473.7",
      },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("DIMENSION_MISMATCH");
    expect(errors[0].reason).toMatch(/bounded to 0-100/);
  });

  it("refuses a comparison between an oscillator and a price", () => {
    const errors = findDimensionErrors([
      {
        kind: "COMPARE", scope: "ENTRY", clauseId: "c0",
        feature: { id: "rsi14", indicator: "RSI", parameters: { period: 14 } },
        right: { id: "sma20", indicator: "SMA", parameters: { period: 20 } },
        op: "gt",
        sourceText: "rsi_14 above sma_20", sourceStart: 0, sourceEnd: 19,
        evidence: "EXPLICIT", interpreted: "rsi14 gt sma20",
      },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/OSCILLATOR with a PRICE/);
  });

  it("accepts comparisons within one dimension", () => {
    expect(
      findDimensionErrors([
        {
          kind: "COMPARE", scope: "ENTRY", clauseId: "c0",
          feature: { id: "close", indicator: "CLOSE", parameters: {} },
          right: { id: "sma20", indicator: "SMA", parameters: { period: 20 } },
          op: "gt",
          sourceText: "close above sma20", sourceStart: 0, sourceEnd: 17,
          evidence: "EXPLICIT", interpreted: "close gt sma20",
        },
      ]),
    ).toEqual([]);
  });
});

describe("a band bound is guarded exactly like every other operand", () => {
  /**
   * REGRESSION. The band path read its two numbers straight from the regex and never asked whether
   * they were periods, so "between 20 and 50 days of range" compiled to `20 <= rsi14 <= 50`. Every
   * other operand route ran the parameter guard; this one predated it and nothing rechecked.
   *
   * Verified to FAIL before the guard was added to the band branch.
   */
  it("refuses a range whose bound is a lookback length", () => {
    const prose = "Enter when RSI-14 is between 20 and 50 days of range.";
    const result = compileResearchProse(prose);

    expect(thresholds(result), "a period must never become a band bound").not.toContain(50);
    expect(result.conditions.filter((condition) => condition.kind === "RANGE")).toHaveLength(0);
    expect(result.rejected.map((entry) => entry.code)).toContain("INDICATOR_PARAMETER_NOT_A_THRESHOLD");
  });

  it("still reads a genuine band that names no period", () => {
    const result = compileResearchProse("Enter while RSI-14 is between 55 and 70.");

    const band = result.conditions.find((condition) => condition.kind === "RANGE");
    expect(band?.feature.id).toBe("rsi14");
    expect(band?.low).toBe(55);
    expect(band?.high).toBe(70);
  });
});
