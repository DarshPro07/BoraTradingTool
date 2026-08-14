import { describe, expect, it } from "vitest";
import { resolveAttachment } from "./attachment";
import type { ParsedToken, SyntaxParse } from "./resolver";

/**
 * Parses recorded from the REAL parser (`en_core_web_sm` 3.8.0, spaCy 3.8.15) on the prose that
 * produced the live defects. Recorded rather than live so the suite stays fast and hermetic; the
 * end-to-end path against the running worker is proved by
 * `scripts/verify-syntax-attachment.mts`.
 */
const FEATURE_WORDS = ["close", "price", "sma", "ema", "vwap", "rsi", "macd", "atr", "average"];
const isFeature = (token: ParsedToken): boolean =>
  FEATURE_WORDS.some((word) => token.text.toLowerCase().includes(word) || token.lemma.toLowerCase() === word);

function parse(tokens: ParsedToken[], text: string): SyntaxParse {
  return {
    parser: "spacy",
    model: "en_core_web_sm",
    modelVersion: "3.8.0",
    sentences: [{ start: 0, end: text.length, text }],
    tokens,
  };
}

const t = (
  index: number, text: string, lemma: string, pos: string, dep: string, headIndex: number,
): ParsedToken => ({ index, text, lemma, pos, tag: "", dep, headIndex, start: 0, end: 0 });

// "Enter when close is above SMA20 and below SMA50."
const COORDINATION = parse([
  t(0, "Enter", "enter", "VERB", "ROOT", 0),
  t(1, "when", "when", "SCONJ", "advmod", 2),
  t(2, "close", "close", "ADJ", "acomp", 3),
  t(3, "is", "be", "AUX", "ccomp", 0),
  t(4, "above", "above", "ADP", "prep", 3),
  t(5, "SMA20", "SMA20", "PROPN", "pobj", 4),
  t(6, "and", "and", "CCONJ", "cc", 5),
  t(7, "below", "below", "ADP", "conj", 5),
  t(8, "SMA50", "SMA50", "PROPN", "pobj", 7),
], "Enter when close is above SMA20 and below SMA50.");

// "Enter when close is above both its 20-day and 50-day SMAs with RSI-14 between 50 and 70."
const BAND = parse([
  t(0, "Enter", "enter", "VERB", "ROOT", 0),
  t(1, "when", "when", "SCONJ", "advmod", 2),
  t(2, "close", "close", "ADJ", "acomp", 3),
  t(3, "is", "be", "AUX", "ccomp", 0),
  t(4, "above", "above", "ADP", "prep", 3),
  t(5, "both", "both", "CCONJ", "det", 14),
  t(6, "its", "its", "PRON", "poss", 14),
  t(7, "20", "20", "NUM", "nummod", 9),
  t(8, "-", "-", "PUNCT", "punct", 9),
  t(9, "day", "day", "NOUN", "nmod", 14),
  t(10, "and", "and", "CCONJ", "cc", 9),
  t(11, "50", "50", "NUM", "nummod", 13),
  t(12, "-", "-", "PUNCT", "punct", 13),
  t(13, "day", "day", "NOUN", "conj", 9),
  t(14, "SMAs", "sma", "NOUN", "pobj", 4),
  t(15, "with", "with", "ADP", "prep", 3),
  t(16, "RSI-14", "RSI-14", "PROPN", "pobj", 15),
  t(17, "between", "between", "ADP", "quantmod", 18),
  t(18, "50", "50", "NUM", "nummod", 16),
  t(19, "and", "and", "CCONJ", "cc", 18),
  t(20, "70", "70", "NUM", "conj", 18),
], "Enter when close is above both its 20-day and 50-day SMAs with RSI-14 between 50 and 70.");

describe("the band lands on the oscillator, not on the SMA mentioned earlier", () => {
  // THE defect: positional attachment made the clause's first mention the subject of every
  // operator, so "…20-day and 50-day SMAs with RSI-14 between 50 and 70" authored
  // `50 <= sma20 <= 70` — an oscillator band on a price. It backtested and it was nonsense.
  it("attaches 'between' to RSI-14 through the quantifier chain", () => {
    const result = resolveAttachment(BAND, 17, isFeature);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.subject.text).toBe("RSI-14");
    expect(result.attachment.operand?.text).toBe("50");
    expect(result.attachment.operandConjuncts.map((token) => token.text)).toEqual(["70"]);
  });

  it("attaches 'above' to close even though close is tagged ADJ", () => {
    const result = resolveAttachment(BAND, 4, isFeature);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.subject.text).toBe("close");
    expect(result.attachment.operand?.text).toBe("SMAs");
  });
});

describe("coordination", () => {
  it("the second operator inherits the first operator's subject", () => {
    const result = resolveAttachment(COORDINATION, 7, isFeature);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.subject.text).toBe("close");
    expect(result.attachment.operand?.text).toBe("SMA50");
  });

  /**
   * REGRESSION. `below` is a `conj` of `SMA20`, so an unfiltered conjunct sweep reported it as the
   * upper BOUND of the first comparison — "close above SMA20..below". That is how
   * "between 55 and below" becomes representable. Verified to fail before the pos filter was added
   * to `operandOf`.
   */
  it("a coordinated operator is never collected as a bound", () => {
    const result = resolveAttachment(COORDINATION, 4, isFeature);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.operand?.text).toBe("SMA20");
    expect(result.attachment.operandConjuncts).toEqual([]);
  });
});

describe("split symbolic comparators", () => {
  /**
   * REGRESSION (live e2e). The compiler refused "gap >= 3%" and "relative volume >= 1.5" inside a
   * full clause, because spaCy splits ">=" into ">" and "=" — the ">" gets tagged ADP (and becomes
   * the operator) while the "=" arrives as a SYM child carrying the value as its OWN `nummod`.
   * The direct route read only the operator's children and found nothing. Structure recorded from
   * the live parser (en_core_web_sm 3.8.0) on "gapping with gap >= 3% on the open".
   */
  const SPLIT_GTE_SYM = parse(
    [
      t(0, "where", "where", "SCONJ", "advmod", 1),
      t(1, "close", "close", "ADJ", "acomp", 2),
      t(2, "is", "be", "AUX", "ROOT", 2),
      t(3, ">", ">", "ADP", "dep", 1),
      t(4, "=", "=", "SYM", "dobj", 3),
      t(5, "3", "3", "NUM", "nummod", 4),
      t(6, "%", "%", "NOUN", "appos", 5),
    ],
    "where close >= 3%",
  );

  it("reads the value through the SYM half of a split '>='", () => {
    const result = resolveAttachment(SPLIT_GTE_SYM, 3, isFeature);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.subject.text).toBe("close");
    expect(result.attachment.operand?.text).toBe("3");
  });

  it("reads the value when the model tags the second half NUM instead", () => {
    // Same split, but here the model read "=" as a NUM carrying "1.5" as its nummod. The
    // attachment surfaces "=" with the value as its QUANTIFIER, which the compiler reads as the
    // threshold — this shape already resolved before the widened route; the test guards it.
    const splitGteNum = parse(
      [
        t(0, "where", "where", "SCONJ", "advmod", 1),
        t(1, "close", "close", "ADJ", "acomp", 2),
        t(2, "is", "be", "AUX", "ROOT", 2),
        t(3, ">", ">", "ADP", "prep", 1),
        t(4, "=", "=", "NUM", "appos", 3),
        t(5, "1.5", "1.5", "NUM", "nummod", 4),
      ],
      "where close >= 1.5",
    );
    const result = resolveAttachment(splitGteNum, 3, isFeature);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.subject.text).toBe("close");
    expect(result.attachment.operand?.text).toBe("=");
    expect(result.attachment.operandQuantifier?.text).toBe("1.5");
  });

  it("does not invent an operand from a SYM half with no numeric child", () => {
    // "close >= open" stays unresolved rather than reading the object noun as a level.
    const splitGteNoOperand = parse(
      [
        t(0, "where", "where", "SCONJ", "advmod", 1),
        t(1, "close", "close", "ADJ", "acomp", 2),
        t(2, "is", "be", "AUX", "ROOT", 2),
        t(3, ">", ">", "ADP", "dep", 1),
        t(4, "=", "=", "SYM", "dobj", 3),
        t(5, "open", "open", "NOUN", "dobj", 4),
      ],
      "where close >= open",
    );
    const result = resolveAttachment(splitGteNoOperand, 3, isFeature);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.operand).toBeNull();
  });
});

describe("operators hanging off a gerund verb (live e2e clause)", () => {
  /**
   * REGRESSION (live e2e). Recorded from the RUNNING worker (en_core_web_sm 3.8.0) on the actual
   * clause "NSE liquid names gapping with gap >= 3% on relative volume >= 1.5 continue upward …":
   * both ">" land as ADP `dep` children of the gerund `gapping`, the subjects park under the
   * verb's prepositions ("with gap", "on … volume"), the first value is the `nummod` of a "%"
   * that hangs off the verb as `npadvmod`, and the second value is the `nummod` of its "=".
   */
  const GAPPING_CLAUSE = parse(
    [
      t(0, "names", "name", "NOUN", "nsubj", 1),
      t(1, "gapping", "gap", "VERB", "ccomp", 8),
      t(2, "with", "with", "ADP", "prep", 1),
      t(3, "gap", "gap", "NOUN", "pobj", 2),
      t(4, ">", ">", "ADP", "dep", 1),
      t(5, "=", "=", "SYM", "dobj", 1),
      t(6, "3", "3", "NUM", "nummod", 7),
      t(7, "%", "%", "NOUN", "npadvmod", 1),
      t(8, "on", "on", "ADP", "prep", 1),
      t(9, "relative", "relative", "ADJ", "amod", 10),
      t(10, "volume", "volume", "NOUN", "pobj", 8),
      t(11, ">", ">", "ADP", "dep", 1),
      t(12, "=", "=", "SYM", "nsubj", 13),
      t(13, "continue", "continue", "VERB", "ROOT", 13),
      t(14, "1.5", "1.5", "NUM", "nummod", 12),
    ],
    "names gapping with gap >= 3% on relative volume >= 1.5 continue",
  );

  // The real compiler's predicate is MENTION coverage, not substring: "gapping" must not match
  // just because it contains "gap".
  const mentionIsFeature = (token: ParsedToken): boolean =>
    token.text.toLowerCase() === "gap" ||
    token.text.toLowerCase() === "volume" ||
    ["close", "price", "sma", "ema", "vwap", "rsi", "macd", "atr", "average"].some((word) =>
      token.text.toLowerCase().includes(word),
    );

  it("gap >= 3% — subject through the verb's prep object, value through the %-sibling", () => {
    const result = resolveAttachment(GAPPING_CLAUSE, 4, mentionIsFeature);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.subject.text).toBe("gap");
    expect(result.attachment.operand?.text).toBe("%");
    expect(result.attachment.operandQuantifier?.text).toBe("3");
  });

  it("relative volume >= 1.5 — the SECOND comparison takes the SECOND prep phrase, not the first", () => {
    const result = resolveAttachment(GAPPING_CLAUSE, 11, mentionIsFeature);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.subject.text).toBe("volume");
    expect(result.attachment.operand?.text).toBe("1.5");
  });
});

describe("refusal", () => {
  it("returns AMBIGUOUS_ATTACHMENT rather than guessing when nothing names a feature", () => {
    const result = resolveAttachment(COORDINATION, 4, () => false);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AMBIGUOUS_ATTACHMENT");
    expect(result.reason).toContain("no known feature");
  });

  it("refuses an index that is not a token instead of throwing", () => {
    const result = resolveAttachment(COORDINATION, 99, isFeature);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AMBIGUOUS_ATTACHMENT");
  });
});
