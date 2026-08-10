import type { Condition } from "@/lib/strategy/dsl";

/**
 * The Semantic Strategy Compiler.
 *
 * ## Why this exists
 *
 * A regex-per-feature extractor read one real NIFTYBEES research paragraph and produced:
 *
 *     all[ sma50 > 50, sma20 > sma50, sma20 < 50, close > 20,
 *          close < sma20, 50 <= rsi14 <= 70, rsi14 < 50 ]
 *
 * Three distinct defect classes, none fixable by a better pattern:
 *
 *   1. **Parameter leakage** — "20-day and 50-day SMAs" produced thresholds 20 and 50. The number
 *      naming an indicator's period became a trading level.
 *   2. **Descriptive-value leakage** — "currently 64.1, +1.6% above SMA20" is an observation about
 *      today. It became a rule.
 *   3. **Logical contradiction** — `50 <= rsi14 <= 70` was ANDed with `rsi14 < 50`. The rule can
 *      never fire, so it backtests to zero trades and explains nothing.
 *
 * ## The structural answer
 *
 * Each defect is closed by construction rather than by pattern:
 *
 *   1. Feature mentions are located FIRST, with exact source spans that cover their period digits.
 *      A numeric operand whose span overlaps a feature mention is a PARAMETER and is refused. It
 *      is not that "20" is filtered out — it is that "20" in "20-day SMA" is never a candidate.
 *   2. Clauses are CLASSIFIED before any number is read. Only ENTRY/EXIT/RISK/INVALIDATION clauses
 *      may produce conditions; observations and parentheticals cannot, whatever they contain.
 *   3. Conditions are checked for satisfiability WITHIN A SCOPE. "Enter while RSI 55-70, exit
 *      below 50" is not a contradiction — those are different scopes — but "above 60 and below 50"
 *      in one scope is, and it is refused with the exact clauses that conflict.
 *
 * ## What this deliberately is not
 *
 * No language model participates. A model that emits Strategy IR directly gives schema-valid JSON
 * whose semantics nobody checked, which is precisely the failure being fixed. If an LLM is ever
 * added it belongs at the CANDIDATE stage, upstream of the span check, the parameter guard and the
 * satisfiability gate — all of which stay deterministic and stay in this file.
 *
 * Satisfiability uses interval algebra rather than a solver: every contradiction seen so far is a
 * scalar bound on one feature. A general constraint solver (Z3) is the upgrade path if conditions
 * ever span features arithmetically; it is not warranted for bounds on a single number.
 */

export type ClauseKind =
  | "ENTRY_RULE"
  | "EXIT_RULE"
  | "RISK_RULE"
  | "INVALIDATION_RULE"
  | "OBSERVATION"
  | "RATIONALE"
  | "CONTEXT"
  | "UNKNOWN";

/** Lifecycle scope. Contradiction is only meaningful WITHIN one of these. */
export type RuleScope = "ENTRY" | "EXIT" | "STOP" | "INVALIDATION";

const SCOPE_OF: Partial<Record<ClauseKind, RuleScope>> = {
  ENTRY_RULE: "ENTRY",
  EXIT_RULE: "EXIT",
  RISK_RULE: "STOP",
  INVALIDATION_RULE: "INVALIDATION",
};

export interface Clause {
  id: string;
  text: string;
  start: number;
  end: number;
  sentenceIndex: number;
  kind: ClauseKind;
  /** Why it was classified this way, in words a reader can disagree with. */
  why: string;
}

/**
 * A feature and the parameters that NAME it.
 *
 * The period lives inside `parameters`, structurally out of reach of the operand extractor. This
 * is the representation that makes `SMA20 > 20` unrepresentable rather than merely unlikely.
 */
export interface FeatureRef {
  /** The DSL feature name, e.g. "sma20". Always a POINT_IN_TIME_FEATURES member. */
  id: string;
  indicator: string;
  parameters: Readonly<Record<string, number>>;
}

export interface FeatureMention extends FeatureRef {
  start: number;
  end: number;
}

export type ComparisonOp = "gt" | "gte" | "lt" | "lte";

export interface ConditionCandidate {
  kind: "SCALAR" | "RANGE" | "COMPARE" | "CROSS";
  scope: RuleScope;
  clauseId: string;
  feature: FeatureRef;
  /** SCALAR/RANGE carry numbers; COMPARE/CROSS carry the right-hand feature. */
  op?: ComparisonOp;
  value?: number;
  low?: number;
  high?: number;
  right?: FeatureRef;
  direction?: "above" | "below";
  sourceText: string;
  sourceStart: number;
  sourceEnd: number;
  evidence: "EXPLICIT";
  interpreted: string;
}

export interface RejectedCandidate {
  clauseId: string;
  sourceText: string;
  reason: string;
  code:
    | "INDICATOR_PARAMETER_NOT_A_THRESHOLD"
    | "OBSERVATION_NOT_A_RULE"
    | "NO_OPERAND"
    | "UNCLASSIFIED_CLAUSE"
    | "DIMENSION_MISMATCH";
}

export interface Contradiction {
  scope: RuleScope;
  feature: string;
  explanation: string;
  /** The exact clauses that conflict — the unsat core, in the author's own words. */
  conflicting: { clauseId: string; sourceText: string; interpreted: string }[];
}

export type CompilerVerdict = "EXPRESSIBLE" | "CONTRADICTORY" | "NO_RULE_FOUND" | "DIMENSION_ERROR";

export interface CompiledStrategy {
  verdict: CompilerVerdict;
  reason: string;
  clauses: Clause[];
  conditions: ConditionCandidate[];
  rejected: RejectedCandidate[];
  contradictions: Contradiction[];
  /** Per-scope DSL conditions. Absent scopes simply had no rules. */
  scopes: Partial<Record<RuleScope, Condition>>;
}

/* ------------------------------------------------------------------ features */

interface FeaturePattern {
  /** Matches the WHOLE mention including any period digits, so the span covers them. */
  pattern: RegExp;
  build: (match: RegExpExecArray) => FeatureRef | null;
}

/** Only these names exist downstream, so the compiler cannot invent a feature. */
const PERIODIC: Readonly<Record<string, { indicator: string; allowed: number[]; default: number }>> =
  Object.freeze({
    sma: { indicator: "SMA", allowed: [20, 50, 200], default: 20 },
    ema: { indicator: "EMA", allowed: [12, 26], default: 12 },
    rsi: { indicator: "RSI", allowed: [14], default: 14 },
    atr: { indicator: "ATR", allowed: [14], default: 14 },
  });

function periodic(kind: keyof typeof PERIODIC, period: number | null): FeatureRef | null {
  const spec = PERIODIC[kind];
  const resolved = period ?? spec.default;
  if (!spec.allowed.includes(resolved)) return null;
  return { id: `${kind}${resolved}`, indicator: spec.indicator, parameters: { period: resolved } };
}

const FEATURE_PATTERNS: readonly FeaturePattern[] = Object.freeze([
  // "20-day SMA", "50 day moving average", "200-day simple moving average"
  {
    pattern: /\b(\d{1,3})[-\s]?day\s+(?:simple\s+|exponential\s+)?(sma|ema|moving average|exponential moving average)\b/gi,
    build: (m) => {
      const word = m[2].toLowerCase();
      const kind = word.includes("exponential") || word === "ema" ? "ema" : "sma";
      return periodic(kind, Number(m[1]));
    },
  },
  // "SMA20", "SMA-20", "SMA_20", "RSI-14", "RSI 14", and the bare "RSI"/"ATR" forms.
  {
    pattern: /\b(sma|ema|rsi|atr)[\s_-]?(\d{1,3})?\b/gi,
    build: (m) => periodic(m[1].toLowerCase() as keyof typeof PERIODIC, m[2] ? Number(m[2]) : null),
  },
  {
    pattern: /\b(?:relative volume|rvol)\b/gi,
    build: () => ({ id: "rvol", indicator: "RVOL", parameters: {} }),
  },
  {
    pattern: /\bgap(?:\s+percent(?:age)?)?\b/gi,
    build: () => ({ id: "gap_pct", indicator: "GAP", parameters: {} }),
  },
  {
    pattern: /\b(?:closing price|close|price)\b/gi,
    build: () => ({ id: "close", indicator: "CLOSE", parameters: {} }),
  },
  {
    pattern: /\bvolume\b/gi,
    build: () => ({ id: "volume", indicator: "VOLUME", parameters: {} }),
  },
]);

/**
 * Spans of numbers that are STRUCTURALLY parameters, whatever feature they belong to.
 *
 * The mention-span guard protects "20" in "20-day SMA" because the number sits inside a resolved
 * feature. It does NOT protect elliptical coordination — "the 20-day and 50-day SMAs" leaves
 * "20-day" with no adjacent indicator, so no mention forms and the 20 became an operand
 * (`close > 20`). Found by the live TCS/NIFTYBEES probes, 2026-08-11.
 *
 * This guard is independent of feature resolution: a number followed by day/period/session/bar is
 * a parameter by the grammar of the phrase, and can never be a level to compare against. It
 * therefore holds even for indicators this compiler cannot name.
 */
export function findParameterSpans(text: string): { start: number; end: number; text: string }[] {
  const spans: { start: number; end: number; text: string }[] = [];
  const regex = /\b(\d{1,4})\s*-?\s*(?:day|days|period|periods|session|sessions|bar|bars|week|weeks)\b/gi;
  for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
    spans.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return spans;
}

/**
 * Every feature mentioned in the text, with the span that NAMES it.
 *
 * Longest span wins on overlap, so "20-day SMA" is one mention rather than a "20" next to an
 * "SMA" — which is the whole point: the digits are inside the name, and therefore unavailable to
 * the operand extractor.
 */
export function findFeatureMentions(text: string): FeatureMention[] {
  const found: FeatureMention[] = [];

  for (const { pattern, build } of FEATURE_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
      const feature = build(match);
      if (!feature) continue;
      found.push({ ...feature, start: match.index, end: match.index + match[0].length });
    }
  }

  found.sort((left, right) => left.start - right.start || right.end - left.end);

  const kept: FeatureMention[] = [];
  for (const mention of found) {
    const overlaps = kept.some((existing) => mention.start < existing.end && existing.start < mention.end);
    if (!overlaps) kept.push(mention);
  }
  return kept;
}

/* ------------------------------------------------------------- segmentation */

interface Span {
  text: string;
  start: number;
  end: number;
}

/** Sentence boundaries that survive decimals ("64.1") and common abbreviations. */
export function segmentSentences(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!".!?".includes(text[index])) continue;
    const next = text[index + 1];
    // "64.1" — a digit either side of the dot is a decimal, not a full stop.
    if (text[index] === "." && /\d/.test(text[index - 1] ?? "") && /\d/.test(next ?? "")) continue;
    if (next !== undefined && !/\s/.test(next)) continue;
    const slice = text.slice(start, index + 1);
    if (slice.trim()) spans.push({ text: slice, start, end: index + 1 });
    start = index + 1;
  }
  const tail = text.slice(start);
  if (tail.trim()) spans.push({ text: tail, start, end: text.length });
  return spans;
}

/** Clause separators. "and" is included, which is why bands must be protected first. */
const CLAUSE_SEPARATORS = [
  ", and ", ", but ", ", while ", ", then ", ", or ", ", ",
  " and ", " but ", " while ", " whereas ", " however ", " otherwise ", " unless ", "; ",
];

/**
 * Split a sentence into clauses without breaking a band.
 *
 * "between 55 and 70" contains a separator. Splitting there would leave "70" as a clause of its
 * own and destroy the range — so band spans are computed first and no split may land inside one.
 */
export function segmentClauses(sentence: string, offset: number): Span[] {
  const protectedRanges: [number, number][] = [];
  const band = /between\s+-?\d+(?:\.\d+)?\s*%?\s+and\s+-?\d+(?:\.\d+)?/gi;
  for (let match = band.exec(sentence); match !== null; match = band.exec(sentence)) {
    protectedRanges.push([match.index, match.index + match[0].length]);
  }
  const isProtected = (index: number) =>
    protectedRanges.some(([from, to]) => index >= from && index < to);

  const cuts: { at: number; length: number }[] = [];
  for (const separator of CLAUSE_SEPARATORS) {
    let from = 0;
    for (;;) {
      const at = sentence.toLowerCase().indexOf(separator, from);
      if (at === -1) break;
      from = at + 1;
      if (!isProtected(at)) cuts.push({ at, length: separator.length });
    }
  }
  cuts.sort((left, right) => left.at - right.at || right.length - left.length);

  const spans: Span[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.at < cursor) continue;
    const slice = sentence.slice(cursor, cut.at);
    if (slice.trim()) spans.push({ text: slice, start: offset + cursor, end: offset + cut.at });
    cursor = cut.at + cut.length;
  }
  const tail = sentence.slice(cursor);
  if (tail.trim()) spans.push({ text: tail, start: offset + cursor, end: offset + sentence.length });
  return spans;
}

/* ----------------------------------------------------------- classification */

const ENTRY_MARKERS = ["enter", "buy", "go long", "open a long", "open a position", "initiate"];

/**
 * "entry" as a RULE, not as a noun.
 *
 * Found by the live TCS probe: an exit sentence said "...if a close drops more than 2x atr_14 from
 * the entry price", the substring "entry" matched, that clause became an ENTRY rule, and every
 * clause after it inherited ENTRY — dragging the exit's "rsi_14 crosses above 70" into the entry
 * band and manufacturing a contradiction against 50-70. The prose was fine; the classifier was not.
 *
 * A reference to a previous entry ("the entry price", "since entry", "from entry") describes a
 * position that already exists. Only entry in rule position opens one.
 */
const ENTRY_AS_RULE =
  /(?<!\b(?:the|an|its|his|their|from|since|after|at|above|below|near|to)\s)\bentry\b(?!\s+(?:price|point|level|bar|candle|prices))/i;
const EXIT_MARKERS = ["exit", "square off", "close the position", "take profit", "sell", "book profit"];
const RISK_MARKERS = ["stop", "stop-loss", "stop loss", "risk no more", "protective stop"];
const INVALIDATION_MARKERS = ["invalidate", "invalidates", "invalidation", "thesis fails", "setup fails"];
/** Present-tense description of what is true TODAY. Never a rule, whatever numbers it carries. */
const OBSERVATION_MARKERS = [
  "currently", "at present", "right now", "presently", "as of today", "today",
  "reads", "sits at", "sits in", "stands at", "is trading at", "trades at", "now at", "recently",
];
const RATIONALE_MARKERS = ["because", "historically", "tends to", "suggests", "implies", "rationale"];

function has(text: string, markers: readonly string[]): string | null {
  const lower = text.toLowerCase();
  for (const marker of markers) if (lower.includes(marker)) return marker;
  return null;
}

const COMPARATOR_WORDS =
  /(>=|<=|≥|≤|>|<|\bat least\b|\bat most\b|\babove\b|\bbelow\b|\bgreater than\b|\bless than\b|\bexceeds\b|\bunder\b|\bover\b|\bbetween\b|\bcross(?:es|ed|ing)?\b)/i;

/**
 * Classify every clause BEFORE any number is read.
 *
 * Order is the design. An explicit rule verb wins; then an observation marker; then inheritance
 * from the nearest preceding classified clause in the SAME sentence (so "…and close is above
 * SMA20" continues whatever the clause before it was); then, only for a clause that states a
 * comparison and nothing descriptive, the default reading of a bare condition as an entry rule.
 *
 * Parenthetical text is context by default — "(currently 64.1, +1.6% above SMA20)" is an aside,
 * and asides do not carry trading rules.
 */
export function classifyClauses(clauses: Span[], sentenceIndexOf: (span: Span) => number): Clause[] {
  const out: Clause[] = [];

  for (let index = 0; index < clauses.length; index += 1) {
    const span = clauses[index];
    const sentenceIndex = sentenceIndexOf(span);
    const text = span.text;
    const trimmed = text.trim();
    const id = `c${index}`;
    const base = { id, text, start: span.start, end: span.end, sentenceIndex };

    const parenthetical = /^\s*\(/.test(trimmed) || (trimmed.startsWith("(") && !trimmed.includes(")"));
    const entry = has(text, ENTRY_MARKERS) ?? (ENTRY_AS_RULE.test(text) ? "entry" : null);
    const exit = has(text, EXIT_MARKERS);
    const risk = has(text, RISK_MARKERS);
    const invalidation = has(text, INVALIDATION_MARKERS);
    const observation = has(text, OBSERVATION_MARKERS);
    const rationale = has(text, RATIONALE_MARKERS);

    if (invalidation) {
      out.push({ ...base, kind: "INVALIDATION_RULE", why: `states an invalidation ("${invalidation}")` });
      continue;
    }
    if (exit) {
      out.push({ ...base, kind: "EXIT_RULE", why: `states an exit ("${exit}")` });
      continue;
    }
    if (risk && !entry) {
      out.push({ ...base, kind: "RISK_RULE", why: `states a risk limit ("${risk}")` });
      continue;
    }
    if (entry) {
      out.push({ ...base, kind: "ENTRY_RULE", why: `states an entry ("${entry}")` });
      continue;
    }
    if (observation) {
      out.push({
        ...base,
        kind: "OBSERVATION",
        why: `describes the present ("${observation}") — a current value, not a rule`,
      });
      continue;
    }
    if (parenthetical) {
      out.push({ ...base, kind: "CONTEXT", why: "parenthetical aside — asides do not carry rules" });
      continue;
    }

    const previous = [...out].reverse().find((clause) => clause.sentenceIndex === sentenceIndex);
    if (previous && previous.kind !== "UNKNOWN") {
      out.push({
        ...base,
        kind: previous.kind,
        why: `continues the previous clause in this sentence (${previous.kind})`,
      });
      continue;
    }
    if (rationale) {
      out.push({ ...base, kind: "RATIONALE", why: `explains why ("${rationale}")` });
      continue;
    }
    if (COMPARATOR_WORDS.test(text)) {
      out.push({
        ...base,
        kind: "ENTRY_RULE",
        why: "a bare stated condition with nothing descriptive — read as an entry rule",
      });
      continue;
    }
    out.push({ ...base, kind: "UNKNOWN", why: "no rule verb, no comparison" });
  }

  return out;
}

/* -------------------------------------------------------------- extraction */

const COMPARATORS: readonly { tokens: readonly string[]; op: ComparisonOp }[] = Object.freeze([
  { tokens: [">=", "≥", "at least", "or higher", "no less than"], op: "gte" },
  { tokens: ["<=", "≤", "at most", "or lower", "no more than"], op: "lte" },
  { tokens: [">", "above", "greater than", "exceeds", "over", "rises above", "climbs above"], op: "gt" },
  { tokens: ["<", "below", "less than", "under", "falls below", "drops below"], op: "lt" },
]);

function firstComparator(text: string, from: number): { op: ComparisonOp; start: number; end: number } | null {
  const lower = text.toLowerCase();
  let best: { op: ComparisonOp; start: number; end: number } | null = null;
  for (const { tokens, op } of COMPARATORS) {
    for (const token of tokens) {
      const at = lower.indexOf(token, from);
      if (at === -1) continue;
      const better = best === null || at < best.start || (at === best.start && token.length > best.end - best.start);
      if (better) best = { op, start: at, end: at + token.length };
    }
  }
  return best;
}

/**
 * A number usable as a comparison operand.
 *
 * THE GUARD: a numeric literal whose span overlaps a feature mention is that feature's PARAMETER.
 * "20-day SMA" holds a 20 that names the indicator; it is not a level anything is compared to.
 * Refusing here — rather than filtering later — is what makes `SMA20 > 20` unreachable.
 */
function operandNumber(
  clauseText: string,
  clauseStart: number,
  from: number,
  mentions: readonly FeatureMention[],
  parameterSpans: readonly { start: number; end: number; text: string }[],
): { value: number; start: number; end: number } | { blockedBy: string } | null {
  const regex = /-?\d+(?:\.\d+)?/g;
  regex.lastIndex = from;
  for (let match = regex.exec(clauseText); match !== null; match = regex.exec(clauseText)) {
    const absoluteStart = clauseStart + match.index;
    const absoluteEnd = absoluteStart + match[0].length;

    const inMention = mentions.find((mention) => absoluteStart < mention.end && mention.start < absoluteEnd);
    if (inMention) return { blockedBy: `${inMention.id} (${inMention.indicator} period)` };

    const inParameter = parameterSpans.find((span) => absoluteStart < span.end && span.start < absoluteEnd);
    if (inParameter) return { blockedBy: `the period in "${inParameter.text.trim()}"` };

    return { value: Number(match[0]), start: absoluteStart, end: absoluteEnd };
  }
  return null;
}

function featureAfter(
  position: number,
  clauseEnd: number,
  mentions: readonly FeatureMention[],
): FeatureMention | null {
  return mentions.find((mention) => mention.start >= position && mention.end <= clauseEnd) ?? null;
}

/**
 * A span whose text is BY CONSTRUCTION the substring it points at.
 *
 * Trimming the text without trimming the offsets is exactly the drift `verifySourceSpans` exists
 * to catch — and it caught it here, on the first run, in this compiler's own output.
 */
function exactSpan(prose: string, start: number, end: number): { start: number; end: number; text: string } {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(prose[from])) from += 1;
  while (to > from && /\s/.test(prose[to - 1])) to -= 1;
  return { start: from, end: to, text: prose.slice(from, to) };
}

/* ------------------------------------------------------------- compilation */

export function compileResearchProse(prose: string): CompiledStrategy {
  const sentences = segmentSentences(prose);
  const spans: Span[] = [];
  const sentenceOf = new Map<Span, number>();

  sentences.forEach((sentence, sentenceIndex) => {
    for (const clause of segmentClauses(sentence.text, sentence.start)) {
      spans.push(clause);
      sentenceOf.set(clause, sentenceIndex);
    }
  });

  const clauses = classifyClauses(spans, (span) => sentenceOf.get(span) ?? 0);
  const mentions = findFeatureMentions(prose);
  const parameterSpans = findParameterSpans(prose);
  const conditions: ConditionCandidate[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const clause of clauses) {
    const scope = SCOPE_OF[clause.kind];
    const clauseMentions = mentions.filter(
      (mention) => mention.start >= clause.start && mention.end <= clause.end,
    );

    if (!scope) {
      if (clauseMentions.length > 0 && COMPARATOR_WORDS.test(clause.text)) {
        rejected.push({
          clauseId: clause.id,
          sourceText: clause.text.trim(),
          code: clause.kind === "OBSERVATION" ? "OBSERVATION_NOT_A_RULE" : "UNCLASSIFIED_CLAUSE",
          reason: `${clause.kind}: ${clause.why}. Numbers here describe the present and are not trading thresholds.`,
        });
      }
      continue;
    }

    // The subject of an operator is the NEAREST FEATURE TO ITS LEFT, not the first one in the
    // clause.
    //
    // Found by the live TCS/NIFTYBEES probes: "closes above both its 20-day and 50-day SMAs with
    // RSI-14 between 50 and 70" took the clause's first mention as the subject of every operator,
    // so the RSI band landed on sma20 — `50 <= sma20 <= 70`, comparing a price to an oscillator
    // level. Dimensionally nonsense, and it authored cleanly.
    //
    // A clause with no feature to the left of its operator inherits the last subject in the same
    // scope, which is what carries "RSI must be above 60 and below 50" across its second clause.
    const inherited = [...conditions].reverse().find((candidate) => candidate.scope === scope);
    const subjectAt = (position: number): FeatureMention | null => {
      const toLeft = clauseMentions.filter((mention) => mention.end <= position);
      if (toLeft.length > 0) return toLeft[toLeft.length - 1];
      return inherited ? { ...inherited.feature, start: -1, end: -1 } : null;
    };

    // A band first: "between 55 and 70" contains a comparator word but is one condition.
    const bandMatch = /between\s+(-?\d+(?:\.\d+)?)\s*%?\s+and\s+(-?\d+(?:\.\d+)?)/i.exec(clause.text);
    if (bandMatch) {
      const low = Math.min(Number(bandMatch[1]), Number(bandMatch[2]));
      const high = Math.max(Number(bandMatch[1]), Number(bandMatch[2]));
      const start = clause.start + bandMatch.index;
      const bandSubject = subjectAt(start);
      if (!bandSubject) continue;
      conditions.push({
        kind: "RANGE",
        scope,
        clauseId: clause.id,
        feature: { id: bandSubject.id, indicator: bandSubject.indicator, parameters: bandSubject.parameters },
        low,
        high,
        ...(({ start: from, end: to, text }) => ({ sourceText: text, sourceStart: from, sourceEnd: to }))(
          exactSpan(prose, start, start + bandMatch[0].length),
        ),
        evidence: "EXPLICIT",
        interpreted: `${low} <= ${bandSubject.id} <= ${high}`,
      });
      continue;
    }

    const comparator = firstComparator(clause.text, 0);
    if (!comparator) continue;
    const subject = subjectAt(clause.start + comparator.start);
    if (!subject) continue;

    const crossing = /cross(?:es|ed|ing)?/i.test(clause.text);
    const right = featureAfter(clause.start + comparator.end, clause.end, mentions);
    const operand = operandNumber(clause.text, clause.start, comparator.end, mentions, parameterSpans);

    // The operand is whatever sits NEAREST the comparator.
    //
    // "rsi_14 crosses above 70 on the daily close" names a feature later in the clause; preferring
    // the feature produced "rsi14 crosses above close" and threw the 70 away. Comparing positions
    // is the principled rule: a comparator governs what immediately follows it, not the next
    // feature word anywhere in the sentence.
    const numberAt = operand !== null && !("blockedBy" in operand) ? operand.start : Number.POSITIVE_INFINITY;
    const featureAt_ = right && right.id !== subject.id ? right.start : Number.POSITIVE_INFINITY;

    if (right && right.id !== subject.id && featureAt_ < numberAt) {
      const direction = comparator.op === "gt" || comparator.op === "gte" ? "above" : "below";
      conditions.push({
        kind: crossing ? "CROSS" : "COMPARE",
        scope,
        clauseId: clause.id,
        feature: { id: subject.id, indicator: subject.indicator, parameters: subject.parameters },
        right: { id: right.id, indicator: right.indicator, parameters: right.parameters },
        op: comparator.op,
        direction,
        ...(({ start: from, end: to, text }) => ({ sourceText: text, sourceStart: from, sourceEnd: to }))(
          exactSpan(prose, clause.start, clause.end),
        ),
        evidence: "EXPLICIT",
        interpreted: crossing
          ? `${subject.id} crosses ${direction} ${right.id}`
          : `${subject.id} ${comparator.op} ${right.id}`,
      });
      continue;
    }

    if (operand === null) continue;
    if ("blockedBy" in operand) {
      rejected.push({
        clauseId: clause.id,
        sourceText: clause.text.trim(),
        code: "INDICATOR_PARAMETER_NOT_A_THRESHOLD",
        reason:
          `The only number after the comparator is ${operand.blockedBy}. An indicator's parameter ` +
          "is not a level to compare against.",
      });
      continue;
    }

    conditions.push({
      kind: "SCALAR",
      scope,
      clauseId: clause.id,
      feature: { id: subject.id, indicator: subject.indicator, parameters: subject.parameters },
      op: comparator.op,
      value: operand.value,
      ...(({ start: from, end: to, text }) => ({ sourceText: text, sourceStart: from, sourceEnd: to }))(
        exactSpan(prose, clause.start + comparator.start, operand.end),
      ),
      evidence: "EXPLICIT",
      interpreted: `${subject.id} ${comparator.op} ${operand.value}`,
    });
  }

  const contradictions = findContradictions(conditions, prose);
  const dimensionErrors = findDimensionErrors(conditions);
  const scopes = buildScopes(conditions);

  if (dimensionErrors.length > 0) {
    return {
      verdict: "DIMENSION_ERROR",
      reason:
        `${dimensionErrors.map((error) => error.reason).join(" ")} No strategy was authored: a rule ` +
        "comparing incompatible quantities is not a weaker rule, it is a different one that nobody wrote.",
      clauses,
      conditions,
      rejected: [...rejected, ...dimensionErrors],
      contradictions,
      scopes: {},
    };
  }

  if (contradictions.length > 0) {
    return {
      verdict: "CONTRADICTORY",
      reason:
        `Conditions in the same scope cannot all hold: ${contradictions.map((c) => c.explanation).join(" · ")}. ` +
        "No strategy was authored — a rule that can never fire would backtest to zero trades and explain nothing.",
      clauses,
      conditions,
      rejected,
      contradictions,
      scopes: {},
    };
  }
  if (!scopes.ENTRY) {
    return {
      verdict: "NO_RULE_FOUND",
      reason:
        "No entry rule could be read. " +
        (rejected.length > 0
          ? `${rejected.length} clause(s) named a feature but stated no usable threshold: ${rejected
              .map((entry) => entry.code)
              .join(", ")}.`
          : "Nothing in the text states a condition this compiler can express."),
      clauses,
      conditions,
      rejected,
      contradictions,
      scopes,
    };
  }

  return {
    verdict: "EXPRESSIBLE",
    reason:
      `Read ${conditions.length} condition(s) from classified rule clauses: ` +
      conditions.map((condition) => condition.interpreted).join(", ") +
      `. ${rejected.length} descriptive or parameter-only clause(s) were refused as thresholds.`,
    clauses,
    conditions,
    rejected,
    contradictions,
    scopes,
  };
}

/* ---------------------------------------------------------- dimensions */

/**
 * What KIND of quantity a feature is.
 *
 * The live probes produced `rsi14 >= 2473.7` (a share price as an oscillator level) and
 * `compare: [rsi14, sma20]` (an oscillator against a moving average). Both are dimensionally
 * impossible, both authored cleanly, and neither is caught by any amount of satisfiability
 * checking — the constraints are perfectly satisfiable, they are just not about anything.
 *
 * This is the guard that makes attachment failures SAFE. It cannot fix a misattached operator; it
 * can refuse to author one, which is the difference between a wrong strategy and an honest refusal.
 */
export type Dimension = "PRICE" | "OSCILLATOR" | "RATIO" | "PERCENT" | "VOLUME";

const DIMENSION_OF: Readonly<Record<string, Dimension>> = Object.freeze({
  close: "PRICE", open: "PRICE", high: "PRICE", low: "PRICE",
  sma20: "PRICE", sma50: "PRICE", sma200: "PRICE", ema12: "PRICE", ema26: "PRICE",
  rsi14: "OSCILLATOR",
  atr14: "PRICE",
  rvol: "RATIO",
  gap_pct: "PERCENT",
  volume: "VOLUME",
});

/** RSI is bounded by construction. A level outside it is not a threshold anyone meant. */
const OSCILLATOR_RANGE = Object.freeze({ min: 0, max: 100 });

export function dimensionOf(featureId: string): Dimension | null {
  return DIMENSION_OF[featureId] ?? null;
}

/**
 * Conditions whose quantities cannot be compared. Returned as refusals, never repaired: a guess at
 * what the author meant is exactly the fabrication this compiler exists to prevent.
 */
export function findDimensionErrors(conditions: readonly ConditionCandidate[]): RejectedCandidate[] {
  const errors: RejectedCandidate[] = [];

  for (const condition of conditions) {
    const left = dimensionOf(condition.feature.id);

    if (condition.kind === "COMPARE" || condition.kind === "CROSS") {
      const right = dimensionOf((condition.right as FeatureRef).id);
      if (left && right && left !== right) {
        errors.push({
          clauseId: condition.clauseId,
          sourceText: condition.sourceText,
          code: "DIMENSION_MISMATCH",
          reason:
            `"${condition.interpreted}" compares a ${left} with a ${right}. These are different ` +
            "kinds of quantity, so the comparison has no meaning — the operator was almost " +
            "certainly attached to the wrong feature.",
        });
      }
      continue;
    }

    const levels =
      condition.kind === "RANGE" ? [condition.low as number, condition.high as number] : [condition.value as number];
    if (left === "OSCILLATOR") {
      const outside = levels.filter((level) => level < OSCILLATOR_RANGE.min || level > OSCILLATOR_RANGE.max);
      if (outside.length > 0) {
        errors.push({
          clauseId: condition.clauseId,
          sourceText: condition.sourceText,
          code: "DIMENSION_MISMATCH",
          reason:
            `"${condition.interpreted}" puts ${outside.join(", ")} on ${condition.feature.id}, which is ` +
            `bounded to ${OSCILLATOR_RANGE.min}-${OSCILLATOR_RANGE.max}. That level belongs to a ` +
            "different quantity in the same sentence.",
        });
      }
    }
  }

  return errors;
}

/* ------------------------------------------------------- satisfiability */

/**
 * Interval algebra, per scope, per feature.
 *
 * Scope is the whole point: "enter while RSI 55-70, exit if RSI falls below 50" is a perfectly
 * ordinary strategy, and a checker that flattened both into one constraint set would refuse it.
 * Contradiction only means anything among conditions that must hold AT THE SAME TIME.
 */
export function findContradictions(
  conditions: readonly ConditionCandidate[],
  prose: string,
): Contradiction[] {
  const contradictions: Contradiction[] = [];
  const groups = new Map<string, ConditionCandidate[]>();

  for (const condition of conditions) {
    const key = `${condition.scope}|${condition.feature.id}`;
    groups.set(key, [...(groups.get(key) ?? []), condition]);
  }

  for (const [key, group] of groups) {
    const [scope, feature] = key.split("|") as [RuleScope, string];

    let low = Number.NEGATIVE_INFINITY;
    let lowStrict = false;
    let high = Number.POSITIVE_INFINITY;
    let highStrict = false;
    const bounded = group.filter((condition) => condition.kind === "SCALAR" || condition.kind === "RANGE");

    for (const condition of bounded) {
      if (condition.kind === "RANGE") {
        low = Math.max(low, condition.low as number);
        high = Math.min(high, condition.high as number);
        continue;
      }
      if (condition.op === "gt" || condition.op === "gte") {
        if ((condition.value as number) > low) {
          low = condition.value as number;
          lowStrict = condition.op === "gt";
        }
      } else if ((condition.value as number) < high) {
        high = condition.value as number;
        highStrict = condition.op === "lt";
      }
    }

    if (bounded.length > 1 && (low > high || (low === high && (lowStrict || highStrict)))) {
      contradictions.push({
        scope,
        feature,
        explanation: `${feature} must be both >= ${low} and <= ${high} during ${scope}`,
        conflicting: bounded.map((condition) => ({
          clauseId: condition.clauseId,
          sourceText: prose.slice(condition.sourceStart, condition.sourceEnd).trim(),
          interpreted: condition.interpreted,
        })),
      });
    }

    // A feature cannot be both above and below the same other feature at the same time.
    const comparisons = group.filter((condition) => condition.kind === "COMPARE");
    for (const left of comparisons) {
      const opposite = comparisons.find(
        (other) =>
          other !== left &&
          other.right?.id === left.right?.id &&
          (left.op === "gt" || left.op === "gte") !== (other.op === "gt" || other.op === "gte"),
      );
      if (opposite) {
        contradictions.push({
          scope,
          feature,
          explanation: `${feature} must be both above and below ${left.right?.id} during ${scope}`,
          conflicting: [left, opposite].map((condition) => ({
            clauseId: condition.clauseId,
            sourceText: prose.slice(condition.sourceStart, condition.sourceEnd).trim(),
            interpreted: condition.interpreted,
          })),
        });
        break;
      }
    }
  }

  return contradictions;
}

/* ------------------------------------------------------------- DSL output */

function toDsl(condition: ConditionCandidate): Condition {
  switch (condition.kind) {
    case "SCALAR":
      return { feature: condition.feature.id, op: condition.op as ComparisonOp, value: condition.value as number };
    case "RANGE":
      // BOTH bounds. Narrowing a band to its lower bound would test a different rule silently.
      return {
        all: [
          { feature: condition.feature.id, op: "gte", value: condition.low as number },
          { feature: condition.feature.id, op: "lte", value: condition.high as number },
        ],
      };
    case "COMPARE":
      return {
        compare: [condition.feature.id, (condition.right as FeatureRef).id],
        op: condition.op as ComparisonOp,
      };
    case "CROSS":
      return condition.direction === "above"
        ? { crossover: [condition.feature.id, (condition.right as FeatureRef).id] }
        : { crossunder: [condition.feature.id, (condition.right as FeatureRef).id] };
  }
}

function buildScopes(conditions: readonly ConditionCandidate[]): Partial<Record<RuleScope, Condition>> {
  const scopes: Partial<Record<RuleScope, Condition>> = {};
  for (const scope of ["ENTRY", "EXIT", "STOP", "INVALIDATION"] as const) {
    const inScope = conditions.filter((condition) => condition.scope === scope).map(toDsl);
    if (inScope.length === 1) scopes[scope] = inScope[0];
    else if (inScope.length > 1) scopes[scope] = { all: inScope };
  }
  return scopes;
}

/**
 * Every authored condition must quote the prose exactly.
 *
 * Cheap to run and hard to fake: if a span does not reproduce its own source text, the condition
 * was assembled from something other than what the author wrote, and it must not be trusted.
 */
export function verifySourceSpans(result: CompiledStrategy, prose: string): string[] {
  return result.conditions
    .filter((condition) => prose.slice(condition.sourceStart, condition.sourceEnd) !== condition.sourceText)
    .map(
      (condition) =>
        `${condition.interpreted}: span [${condition.sourceStart}, ${condition.sourceEnd}) reads ` +
        `"${prose.slice(condition.sourceStart, condition.sourceEnd)}" but the condition claims "${condition.sourceText}"`,
    );
}
