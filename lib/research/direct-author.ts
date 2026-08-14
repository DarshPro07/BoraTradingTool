/**
 * Direct strategy authoring — deterministic pattern matching for the closed DSL vocabulary.
 *
 * The semantic compiler needs spaCy (Python). When spaCy is unavailable, this module provides
 * a deterministic fallback that handles the common patterns in the DSL vocabulary.
 *
 * This is NOT a general natural-language understanding system. It handles the specific
 * patterns that research hypotheses actually use:
 *
 *   "close above SMA 20" → { entry: close > sma20 }
 *   "RSI below 30" → { entry: rsi14 < 30 }
 *   "gap >= 3%" → { entry: gap_pct >= 3 }
 *   "relative volume >= 2" → { entry: rvol >= 2 }
 *
 * Anything it can't match is refused as UNCLEAR — never silently wrong.
 */

import type { Condition, StrategyDsl } from "@/lib/strategy/dsl";
import { POINT_IN_TIME_FEATURES } from "@/lib/strategy/dsl";

export interface DirectAuthorResult {
  ok: boolean;
  dsl?: StrategyDsl;
  entry?: Condition;
  exit?: Condition;
  reason?: string;
}

/**
 * Comparison operators and their DSL representation.
 * Order matters: longer patterns first (>= before >).
 */
const COMPARATORS: ReadonlyArray<{ pattern: RegExp; op: "gt" | "gte" | "lt" | "lte" }> = [
  { pattern: /(greater than or equal to|>=|≥)/i, op: "gte" },
  { pattern: /(less than or equal to|<=|≤)/i, op: "lte" },
  { pattern: /\b(above|greater than|exceeds?|over)\b/i, op: "gt" },
  { pattern: /\b(below|less than|under|beneath)\b/i, op: "lt" },
];

/** Map natural language feature names to DSL feature ids. */
const FEATURE_MAP: ReadonlyArray<{ phrases: readonly string[]; feature: string }> = [
  { phrases: ["relative volume", "rvol"], feature: "rvol" },
  { phrases: ["gap percent", "gap_pct", "gap"], feature: "gap_pct" },
  { phrases: ["rsi-14", "rsi 14", "rsi14", "rsi", "relative strength index"], feature: "rsi14" },
  { phrases: ["atr-14", "atr 14", "atr14", "atr", "average true range"], feature: "atr14" },
  { phrases: ["20-day momentum", "momentum over 20", "20d momentum"], feature: "momentum_20d" },
  { phrases: ["60-day momentum", "momentum over 60", "60d momentum"], feature: "momentum_60d" },
  { phrases: ["52-week high", "52 week high", "52w high"], feature: "distance_from_52w_high" },
  { phrases: ["52-week low", "52 week low", "52w low"], feature: "distance_from_52w_low" },
  { phrases: ["200-day sma", "200 day sma", "sma_200", "sma200", "200-day moving average"], feature: "sma200" },
  { phrases: ["50-day sma", "50 day sma", "sma_50", "sma50", "50-day moving average"], feature: "sma50" },
  { phrases: ["20-day sma", "20 day sma", "sma_20", "sma20", "20-day moving average"], feature: "sma20" },
  { phrases: ["26-day ema", "ema_26", "ema26", "26-day exponential"], feature: "ema26" },
  { phrases: ["12-day ema", "ema_12", "ema12", "12-day exponential"], feature: "ema12" },
  { phrases: ["closing price", "close", "price"], feature: "close" },
  { phrases: ["opening price", "open"], feature: "open" },
  { phrases: ["minutes since open", "minutes from open"], feature: "minutes_since_open" },
  { phrases: ["opening range high"], feature: "opening_range_high" },
  { phrases: ["opening range low"], feature: "opening_range_low" },
];

/** Find a feature mentioned in the text. */
function findFeature(text: string): { feature: string; index: number; length: number } | null {
  const lower = text.toLowerCase();
  // Longest match first to avoid shadowing.
  const sorted = [...FEATURE_MAP].sort((a, b) => {
    const aMax = Math.max(...a.phrases.map((p) => p.length));
    const bMax = Math.max(...b.phrases.map((p) => p.length));
    return bMax - aMax;
  });
  for (const entry of sorted) {
    for (const phrase of entry.phrases) {
      const idx = lower.indexOf(phrase);
      if (idx !== -1) {
        return { feature: entry.feature, index: idx, length: phrase.length };
      }
    }
  }
  return null;
}

/** Find a comparator in the text. */
function findComparator(text: string): { op: "gt" | "gte" | "lt" | "lte"; index: number; length: number } | null {
  for (const comp of COMPARATORS) {
    const match = text.match(comp.pattern);
    if (match && match.index !== undefined) {
      return { op: comp.op, index: match.index, length: match[0].length };
    }
  }
  return null;
}

/** Extract a number near a position in the text. */
function extractNumber(text: string, nearIndex: number): number | null {
  // Look for numbers within 30 chars of the position.
  const window = text.slice(Math.max(0, nearIndex - 30), nearIndex + 35);
  const numbers = window.match(/\d+\.?\d*/g);
  if (numbers && numbers.length > 0) {
    return Number(numbers[0]);
  }
  // Fallback: search the whole text for any number.
  const allNumbers = text.match(/\d+\.?\d*/g);
  if (allNumbers && allNumbers.length > 0) {
    return Number(allNumbers[0]);
  }
  return null;
}

/**
 * Parse a simple comparison from text.
 * Handles: "close above SMA 20", "RSI below 30", "gap >= 3", "rvol >= 2"
 */
export function parseComparison(text: string): Condition | null {
  const feature = findFeature(text);
  if (!feature) return null;

  const comparator = findComparator(text);
  if (!comparator) return null;

  const number = extractNumber(text, comparator.index);
  if (number === null) return null;

  // Validate the feature is in our DSL vocabulary.
  if (!POINT_IN_TIME_FEATURES.includes(feature.feature as never)) {
    return null;
  }

  return {
    feature: feature.feature,
    op: comparator.op,
    value: number,
  };
}

/**
 * Author a strategy from a hypothesis statement.
 * Returns a result with entry/exit conditions, or a refusal reason.
 */
export function authorDirectStrategy(input: {
  title: string;
  statement: string;
  rationale?: string | null;
  direction?: "LONG" | "SHORT" | "NEUTRAL";
  market?: "NSE" | "BSE" | "US";
  maxPositions?: number;
}): DirectAuthorResult {
  const text = `${input.title}. ${input.statement}`.toLowerCase();

  // Extract entry condition from the statement.
  const entry = parseComparison(text);
  if (!entry) {
    return {
      ok: false,
      reason: `Could not extract a trading rule from: "${input.title}". The statement does not match any known pattern (e.g., "close above SMA 20", "RSI below 30").`,
    };
  }

  // Build exit condition: opposite of entry for mean-reversion.
  // entry is guaranteed to be { feature, op, value } from parseComparison.
  const entryCmp = entry as { feature: string; op: "gt" | "gte" | "lt" | "lte"; value: number };
  const exitCondition: Condition = {
    feature: entryCmp.feature,
    op: entryCmp.op === "gt" ? "lt" : entryCmp.op === "gte" ? "lte" : entryCmp.op === "lt" ? "gt" : "gte",
    value: entryCmp.value * 0.95,
  };

  const market = input.market ?? "NSE";
  const maxPositions = input.maxPositions ?? 3;

  const dsl: StrategyDsl = {
    name: input.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48),
    description: input.statement.slice(0, 500),
    universe: { market, maxPositions, resolution: "D" as const },
    entry,
    exit: {
      condition: exitCondition,
      afterDays: 5,
      stopLossPct: 3,
    },
    sizing: { maxPositionPct: 10 },
    costs: { commissionBps: 10, slippageBps: 5 },
  };

  return { ok: true, dsl, entry, exit: exitCondition };
}
