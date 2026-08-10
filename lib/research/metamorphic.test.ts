import { describe, expect, it } from "vitest";
import { compileResearchProse, type CompiledStrategy } from "./semantic-compiler";

/**
 * Metamorphic semantic tests.
 *
 * ## Why these exist
 *
 * 1,500 example-based tests passed while the compiler was producing `close > 20`,
 * `50 <= sma20 <= 70` and `rsi14 >= 2473.7` on real prose. Example tests only ever check the
 * inputs someone thought of. These check a RELATION between inputs instead:
 *
 *     adding words that do not change the trading meaning must not change the Strategy IR.
 *
 * That relation is what every defect this compiler has had would have violated. A current price, a
 * percentage, an indicator period, a parenthetical aside, a reordered sentence — each of them is
 * decoration, and decoration that moves a threshold is a bug by definition, whatever the mechanism.
 *
 * ## Reading a failure
 *
 * A failure here does not say "this case is wrong". It says "these two paragraphs mean the same
 * thing to a trader and different things to the compiler", which is a much stronger claim and
 * always worth acting on.
 */

/** The IR reduced to what a trader would call the rule — order-independent, scope-preserving. */
function canonical(result: CompiledStrategy): string {
  const scopes = (["ENTRY", "EXIT", "STOP", "INVALIDATION"] as const)
    .map((scope) => {
      const inScope = result.conditions
        .filter((condition) => condition.scope === scope)
        .map((condition) => condition.interpreted)
        .sort();
      return inScope.length > 0 ? `${scope}[${inScope.join(" & ")}]` : "";
    })
    .filter(Boolean);
  return scopes.join(" ") || `<${result.verdict}>`;
}

const CANONICAL_RULE = "Enter while RSI-14 is between 55 and 70 and close is above SMA20.";

/**
 * Each variant adds only DECORATION: current values, percentages, periods, asides, commentary.
 * None of them changes what a trader would do. All must compile identically.
 */
const MEANING_PRESERVING_VARIANTS: { why: string; prose: string }[] = [
  {
    why: "a current reading is added",
    prose: "RSI-14 is currently 64.1. Enter while RSI-14 is between 55 and 70 and close is above SMA20.",
  },
  {
    why: "a current price and a percentage are added",
    prose:
      "RSI-14 is currently 64.1 and price sits 1.6% above its 20-day SMA. " +
      "Enter while RSI-14 is between 55 and 70 and close is above SMA20.",
  },
  {
    why: "a parenthetical aside is added",
    prose:
      "Enter while RSI-14 is between 55 and 70 (currently 64.1, +2.3 today) and close is above SMA20.",
  },
  {
    why: "market commentary is added after the rule",
    prose:
      "Enter while RSI-14 is between 55 and 70 and close is above SMA20. " +
      "The 50-day SMA is rising and breadth has improved recently.",
  },
  {
    why: "market commentary is added before the rule",
    prose:
      "The 20-day and 50-day SMAs are both rising and momentum has been constructive. " +
      "Enter while RSI-14 is between 55 and 70 and close is above SMA20.",
  },
  {
    why: "a rationale clause is added",
    prose:
      "Enter while RSI-14 is between 55 and 70 and close is above SMA20, because trends tend to " +
      "persist while momentum is positive but not extended.",
  },
];

describe("PROPERTY: decoration cannot change the trading rules", () => {
  const baseline = canonical(compileResearchProse(CANONICAL_RULE));

  it("the canonical rule compiles to the expected IR", () => {
    expect(baseline).toBe("ENTRY[55 <= rsi14 <= 70 & close gt sma20]");
  });

  for (const variant of MEANING_PRESERVING_VARIANTS) {
    it(`is unchanged when ${variant.why}`, () => {
      expect(canonical(compileResearchProse(variant.prose)), variant.prose).toBe(baseline);
    });
  }
});

describe("PROPERTY: no decorative number can become a threshold", () => {
  const decorated =
    "RSI-14 is currently 64.1 and price is 1.6% above its 20-day SMA, which sits at 1071.4. " +
    "The 50-day SMA is at 1027.7. Enter while RSI-14 is between 55 and 70 and close is above SMA20.";

  it("only 55 and 70 survive as levels", () => {
    const result = compileResearchProse(decorated);
    const levels = result.conditions.flatMap((condition) =>
      condition.kind === "SCALAR"
        ? [condition.value as number]
        : condition.kind === "RANGE"
          ? [condition.low as number, condition.high as number]
          : [],
    );

    expect(levels.sort((a, b) => a - b)).toEqual([55, 70]);
  });
});

describe("PROPERTY: entry and exit never collapse", () => {
  it("holds however much decoration surrounds them", () => {
    const bare = compileResearchProse("Enter while RSI-14 is above 55. Exit when RSI-14 falls below 45.");
    const decorated = compileResearchProse(
      "RSI-14 currently reads 64.1, comfortably above its recent range. " +
        "Enter while RSI-14 is above 55. Momentum has been improving all week. " +
        "Exit when RSI-14 falls below 45.",
    );

    expect(canonical(bare)).toBe("ENTRY[rsi14 gt 55] EXIT[rsi14 lt 45]");
    expect(canonical(decorated)).toBe(canonical(bare));
  });
});

describe("PROPERTY: reordering descriptive clauses cannot change the IR", () => {
  it("commentary before and after the rule compile identically", () => {
    const before = compileResearchProse(
      "Breadth has improved and the 50-day SMA is rising. Enter while close is above SMA20.",
    );
    const after = compileResearchProse(
      "Enter while close is above SMA20. Breadth has improved and the 50-day SMA is rising.",
    );

    expect(canonical(before)).toBe(canonical(after));
  });
});

describe("PROPERTY: an equivalent phrasing compiles to an equivalent rule", () => {
  // Same trade, different words. Where the compiler cannot yet see the equivalence it must REFUSE,
  // never produce a different rule — so a mismatch here is only acceptable as a refusal.
  const phrasings = [
    "Enter while close is above SMA20.",
    "Enter when the close is above the 20-day SMA.",
    "Enter when price is above its 20-day moving average.",
  ];

  it("either matches the canonical rule or refuses, never silently differs", () => {
    const target = "ENTRY[close gt sma20]";
    for (const prose of phrasings) {
      const result = compileResearchProse(prose);
      const shape = canonical(result);
      const acceptable = shape === target || result.verdict !== "EXPRESSIBLE";
      expect(acceptable, `"${prose}" compiled to ${shape}, which is neither ${target} nor a refusal`).toBe(true);
    }
  });
});

describe("PROPERTY: incompatible dimensions never compile", () => {
  it("an oscillator is never compared with a price, however the prose is arranged", () => {
    for (const prose of [
      "Enter when RSI-14 is above SMA20.",
      "Enter when RSI-14 rises above the 20-day SMA.",
      "Enter when the 20-day SMA is above RSI-14.",
    ]) {
      const result = compileResearchProse(prose);
      expect(result.verdict, prose).not.toBe("EXPRESSIBLE");
    }
  });
});
