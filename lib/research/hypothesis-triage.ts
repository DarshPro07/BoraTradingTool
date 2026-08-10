import { POINT_IN_TIME_FEATURES, type Condition } from "@/lib/strategy/dsl";
import { DERIVABLE_FEATURES } from "@/lib/backtest/features";

/**
 * Can this hypothesis be expressed as a strategy in this deployment's DSL — and if not, why not?
 *
 * ## The finding this module is shaped by
 *
 * Of the three hypotheses the research loop has actually formed, **two must not become strategies
 * at all**:
 *
 *   - *"Untriggered-signal blind spot in our own gauntlet"* is a claim about the validation
 *     machinery. There is nothing to buy.
 *   - *"Model disagreement as a risk filter"* needs a quantity — whether two models disagree —
 *     that is not in the feature vocabulary and is not derivable from bars.
 *
 * Only the gap-and-RVOL screen is a trading rule this system can test.
 *
 * A converter that emitted a specification for each of them would be wrong twice, plausibly, and
 * silently: it would invent a rule for the first and drop the entire idea from the third while
 * keeping whatever remained. So this triages, and refusing is its main job.
 *
 * ## Why a lexicon and not a language model
 *
 * `CLAUDE.md`: *"the app does not call Claude — **you** call the app."* The application may not
 * spend the owner's subscription, so the prose→DSL step is a **stated table** of phrases mapped to
 * DSL features.
 *
 * That is a real limitation and it is the right one. The lexicon understands *phrasing*, not
 * meaning, so a hypothesis expressing a mapped idea in unmapped words is refused as `UNCLEAR`. A
 * false refusal costs a hypothesis nobody is testing today; a false conversion costs a permanent
 * trial and produces a strategy nobody proposed. Only one of those is recoverable.
 *
 * The lexicon can only ever emit names already in `POINT_IN_TIME_FEATURES`, so it cannot invent a
 * feature however the prose is written.
 */

export type TriageVerdict =
  /** Names quantities this engine derives, with thresholds stated in the text. */
  | "EXPRESSIBLE"
  /** Names a real quantity this deployment cannot derive. The idea is fine; the data is absent. */
  | "NEEDS_FEATURE"
  /** Not about a trade at all — a claim about the system, the method, or the research process. */
  | "NOT_A_TRADING_RULE"
  /** Nothing mapped. Says nothing about the idea, only that this table could not read it. */
  | "UNCLEAR";

/**
 * Phrases that denote a feature this engine derives.
 *
 * Deliberately small. Every entry is a claim that these words, in a hypothesis about markets, mean
 * that feature — and each one is a place the system can be wrong, so the table stays short enough
 * to read in full and argue with.
 *
 * Ordered longest-first at match time, so "relative volume" is not shadowed by "volume".
 */
const FEATURE_LEXICON: ReadonlyArray<{ phrases: readonly string[]; feature: string }> = Object.freeze([
  { phrases: ["relative volume", "rvol"], feature: "rvol" },
  { phrases: ["gap"], feature: "gap_pct" },
  { phrases: ["average daily value", "liquidity floor", "liquidity", "traded value"], feature: "adv_20d" },
  { phrases: ["rsi"], feature: "rsi14" },
  { phrases: ["atr", "average true range"], feature: "atr14" },
  { phrases: ["20-day momentum", "momentum over 20"], feature: "momentum_20d" },
  { phrases: ["60-day momentum", "momentum over 60"], feature: "momentum_60d" },
  { phrases: ["52-week high", "52 week high"], feature: "distance_from_52w_high" },
  { phrases: ["52-week low", "52 week low"], feature: "distance_from_52w_low" },
  { phrases: ["opening range"], feature: "opening_range_high" },
  { phrases: ["price floor", "price above", "share price"], feature: "close" },
]);

/**
 * Quantities a hypothesis may legitimately name that this deployment cannot supply.
 *
 * Separated from "unmapped" on purpose. "This engine cannot derive model disagreement" is a fact
 * about the deployment and a specific thing to go and build; "these words matched nothing" is a
 * fact about this table. Collapsing them would turn a missing data source into an unreadable
 * sentence, and the two have opposite remedies.
 */
const KNOWN_UNAVAILABLE: ReadonlyArray<{ phrases: readonly string[]; quantity: string }> = Object.freeze([
  { phrases: ["model disagreement", "models disagree", "opposing stances", "disagreement"], quantity: "model disagreement between analyses" },
  { phrases: ["sector relative strength", "sector strength"], quantity: "sector_relative_strength" },
  { phrases: ["earnings surprise"], quantity: "earnings_surprise_pct" },
  { phrases: ["market cap", "market capitalisation", "market capitalization"], quantity: "market_cap" },
  { phrases: ["order book", "bid-ask", "bid ask", "depth", "spread"], quantity: "quote or depth data (no bid/ask feed exists here)" },
  { phrases: ["sentiment", "news sentiment"], quantity: "news sentiment score" },
  { phrases: ["forecast", "kronos"], quantity: "point-in-time forecast archive (ADR 0004)" },
]);

/**
 * Phrases that mark a hypothesis as being about this system rather than about a market.
 *
 * These are valuable hypotheses — the gauntlet blind-spot one is a genuine finding worth acting on
 * — but the action is a code change, not a strategy. Sending them down the strategy path would
 * manufacture a trading rule out of a statement about test coverage.
 */
const META_MARKERS: readonly string[] = Object.freeze([
  "our validation",
  "our gauntlet",
  "our own gauntlet",
  "this system",
  "the backtest engine",
  "false-negative mode",
  "coverage of",
  "our promotion",
  "the research loop",
]);

export interface ExtractedCondition {
  feature: string;
  op: "gt" | "gte" | "lt" | "lte";
  value: number;
  /** The exact words this came from, so a reader can check the reading rather than trust it. */
  evidence: string;
}

export interface TriageResult {
  verdict: TriageVerdict;
  reason: string;
  /** Populated only when EXPRESSIBLE. */
  conditions: ExtractedCondition[];
  /** Quantities the hypothesis needs that this deployment cannot derive. */
  missingQuantities: string[];
}

export interface HypothesisInput {
  title: string;
  statement: string;
  rationale?: string | null;
}

/** Comparison words, mapped to DSL operators. Longest first so ">=" beats ">". */
const COMPARATORS: ReadonlyArray<{ tokens: readonly string[]; op: ExtractedCondition["op"] }> = Object.freeze([
  { tokens: [">=", "≥", "at least", "or more", "or higher", "above or equal"], op: "gte" },
  { tokens: ["<=", "≤", "at most", "or less", "or lower", "below or equal"], op: "lte" },
  { tokens: [">", "above", "greater than", "exceeds", "over"], op: "gt" },
  { tokens: ["<", "below", "less than", "under"], op: "lt" },
]);

/**
 * The first comparator in the window, with the offset where it ends.
 *
 * Table order still decides ties (so ">=" beats ">"), but the offset is what lets the caller read
 * the threshold from the text the comparator actually governs.
 */
function matchComparator(
  window: string,
): { op: ExtractedCondition["op"]; endsAt: number } | null {
  for (const candidate of COMPARATORS) {
    for (const token of candidate.tokens) {
      const leadingSpace = window.length - window.trimStart().length;
      if (window.trimStart().startsWith(token)) {
        return { op: candidate.op, endsAt: leadingSpace + token.length };
      }
      const spaced = window.indexOf(` ${token} `);
      if (spaced !== -1) return { op: candidate.op, endsAt: spaced + token.length + 2 };
    }
  }
  return null;
}

/**
 * Find `feature <comparator> number` inside a sentence.
 *
 * Deliberately narrow: it requires the feature phrase, a comparator and a number to appear in that
 * order within one clause. Prose that merely mentions a feature yields nothing, because "gap
 * strategies are interesting" states no threshold and a strategy invented from it would be testing
 * a number nobody chose.
 */
function extractConditions(text: string): ExtractedCondition[] {
  const found: ExtractedCondition[] = [];
  const haystack = text.toLowerCase();

  // Longest phrases first: "relative volume" must win over "volume".
  const entries = [...FEATURE_LEXICON].sort(
    (a, b) => Math.max(...b.phrases.map((p) => p.length)) - Math.max(...a.phrases.map((p) => p.length)),
  );

  for (const entry of entries) {
    for (const phrase of entry.phrases) {
      let from = 0;
      for (;;) {
        const at = haystack.indexOf(phrase, from);
        if (at === -1) break;
        from = at + phrase.length;

        // Look only at the short window after the phrase, and never past the end of the sentence.
        //
        // Without the sentence clip, "Relative volume matters. Separately, we hold at most 4
        // positions" paired `rvol` with `lte 4` — a threshold from an unrelated clause, which is
        // precisely the fabrication this module exists to avoid. Cut on ". " and "; " rather than
        // on "." so a decimal like 3.5 survives.
        const raw = haystack.slice(at + phrase.length, at + phrase.length + 40);
        const boundary = Math.min(
          ...[". ", "; "].map((mark) => {
            const index = raw.indexOf(mark);
            return index === -1 ? raw.length : index;
          }),
        );
        const window = raw.slice(0, boundary);
        const comparator = matchComparator(window);
        if (!comparator) continue;

        // The number must come from AFTER the comparator, not from anywhere in the window.
        //
        // Taking the first number in the window read the indicator's PERIOD as its threshold:
        // "rsi_14 crosses above 70" produced `rsi14 > 14`, which is true on essentially every
        // bar. That rule backtests, produces trades and means nothing — a nonsense condition
        // wearing the costume of a tested one. Every feature a researcher names carries its
        // period (rsi_14, sma_20, atr_14), so this fired on the common case, not an edge one.
        const number = /(-?\d+(?:\.\d+)?)\s*%?/.exec(window.slice(comparator.endsAt));
        if (!number) continue;

        if (found.some((existing) => existing.feature === entry.feature)) continue;
        found.push({
          feature: entry.feature,
          op: comparator.op,
          value: Number(number[1]),
          evidence: text.slice(at, at + phrase.length + 40).trim(),
        });
      }
    }
  }

  return found;
}

/**
 * Classify a hypothesis. Pure — no database, no network, no model call.
 *
 * The order of the checks is the design. "Is this even about a trade?" is asked before "which
 * features does it name", because a meta-hypothesis will happily contain the word "coverage" and
 * produce a threshold if allowed to reach the extractor.
 */
export function hypothesisTriage(input: HypothesisInput): TriageResult {
  const text = `${input.title}. ${input.statement} ${input.rationale ?? ""}`;
  const lower = text.toLowerCase();

  // Meta markers are matched against the title and statement ONLY, never the rationale.
  //
  // A rationale explains *why this system should care*, so it says "this system" about almost any
  // hypothesis — the model-disagreement one reads "an empirical question this system can answer",
  // which is a reason to test it, not evidence that it is about the system. Scanning the rationale
  // misclassified it as NOT_A_TRADING_RULE and hid a legitimate NEEDS_FEATURE refusal behind the
  // wrong reason. The subject of a hypothesis lives in its title and statement.
  const subject = `${input.title}. ${input.statement}`.toLowerCase();
  const meta = META_MARKERS.filter((marker) => subject.includes(marker));
  if (meta.length > 0) {
    return {
      verdict: "NOT_A_TRADING_RULE",
      reason:
        `This describes the system rather than a market position (matched: ${meta.join(", ")}). It may ` +
        "be a good hypothesis — the action it implies is a change to the code or the validation " +
        "method, not a strategy. Turning it into one would invent a rule nobody proposed.",
      conditions: [],
      missingQuantities: [],
    };
  }

  const unavailable = KNOWN_UNAVAILABLE.filter((entry) =>
    entry.phrases.some((phrase) => lower.includes(phrase)),
  ).map((entry) => entry.quantity);

  if (unavailable.length > 0) {
    return {
      verdict: "NEEDS_FEATURE",
      reason:
        `This hypothesis needs ${unavailable.join(", ")}, which this deployment cannot derive. The idea ` +
        "is not refused — the data is absent. Recorded so it can be revisited when a source exists, " +
        "rather than being expressed without the part that carries the whole claim.",
      conditions: [],
      missingQuantities: unavailable,
    };
  }

  const conditions = extractConditions(text);
  if (conditions.length === 0) {
    return {
      verdict: "UNCLEAR",
      reason:
        "No feature-and-threshold pair could be read from this text. That is a statement about this " +
        "lexicon, not about the hypothesis: it maps phrasing, not meaning. A hypothesis stating its " +
        "conditions in other words is refused here and is still worth expressing by hand.",
      conditions: [],
      missingQuantities: [],
    };
  }

  // Belt and braces: the lexicon can only emit vocabulary names, but a typo in the table would be
  // caught here rather than at compile time with a less obvious message.
  const notDerivable = conditions
    .map((condition) => condition.feature)
    .filter((feature) => !(DERIVABLE_FEATURES as readonly string[]).includes(feature));
  if (notDerivable.length > 0) {
    return {
      verdict: "NEEDS_FEATURE",
      reason: `The lexicon produced ${notDerivable.join(", ")}, which no engine here derives from price data.`,
      conditions: [],
      missingQuantities: notDerivable,
    };
  }

  return {
    verdict: "EXPRESSIBLE",
    reason:
      `Read ${conditions.length} condition(s) directly from the text: ` +
      conditions.map((condition) => `${condition.feature} ${condition.op} ${condition.value}`).join(", ") +
      ". Every threshold comes from the hypothesis itself; none was defaulted.",
    conditions,
    missingQuantities: [],
  };
}

/** The entry condition implied by an expressible hypothesis. */
export function entryConditionFrom(conditions: readonly ExtractedCondition[]): Condition {
  const clauses: Condition[] = conditions.map((condition) => ({
    feature: condition.feature,
    op: condition.op,
    value: condition.value,
  }));
  return clauses.length === 1 ? clauses[0] : { all: clauses };
}

/** Exported for the test that pins the lexicon to the DSL vocabulary. */
export const LEXICON_FEATURES: readonly string[] = FEATURE_LEXICON.map((entry) => entry.feature);
export const VOCABULARY: readonly string[] = POINT_IN_TIME_FEATURES;
