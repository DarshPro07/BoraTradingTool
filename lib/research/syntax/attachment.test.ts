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
