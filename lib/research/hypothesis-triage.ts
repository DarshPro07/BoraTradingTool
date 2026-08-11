import { POINT_IN_TIME_FEATURES, type Condition } from "@/lib/strategy/dsl";
import { compileResearchProse, type CompiledStrategy, type ConditionCandidate } from "./semantic-compiler";
import type { SyntaxParse } from "./syntax/resolver";
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
  | "UNCLEAR"
  /** The stated conditions cannot all hold at once within one lifecycle scope. */
  | "CONTRADICTORY";

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
  // Moving averages: real research prose compares price to them constantly ("close above the
  // 20-day SMA"), and every name below is already in POINT_IN_TIME_FEATURES, so the lexicon
  // still cannot invent a feature this deployment does not derive.
  { phrases: ["200-day sma", "200 day sma", "sma_200", "sma200", "200-day moving average"], feature: "sma200" },
  { phrases: ["50-day sma", "50 day sma", "sma_50", "sma50", "50-day moving average"], feature: "sma50" },
  { phrases: ["20-day sma", "20 day sma", "sma_20", "sma20", "20-day moving average"], feature: "sma20" },
  { phrases: ["26-day ema", "ema_26", "ema26"], feature: "ema26" },
  { phrases: ["12-day ema", "ema_12", "ema12"], feature: "ema12" },
  { phrases: ["closing price", "close"], feature: "close" },
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

export type Comparison = "gt" | "gte" | "lt" | "lte";

/**
 * One condition read out of a hypothesis, in the shape the prose actually stated.
 *
 * A band is NOT stored as its lower bound. "RSI-14 between 55 and 70" narrowed to `rsi14 >= 55`
 * would test a materially different rule than the one written, and would do it silently — the
 * same class of defect as reading an indicator's period as its threshold. Every variant carries
 * `evidence` (the author's words) and `interpreted` (this engine's reading of them) so a human
 * can check the reading instead of trusting it.
 */
export type ExtractedCondition = (
  | { kind: "scalar"; feature: string; op: Comparison; value: number }
  | { kind: "range"; feature: string; low: number; high: number }
  | { kind: "compare"; left: string; right: string; op: Comparison }
  | { kind: "cross"; left: string; right: string; direction: "above" | "below" }
) & {
  /** The exact words this came from, so a reader can check the reading rather than trust it. */
  evidence: string;
  /** This engine's reading of those words, in plain terms. */
  interpreted: string;
};

/** The compiler's candidate, in the shape this module's consumers already read. */
function asExtractedCondition(candidate: ConditionCandidate): ExtractedCondition {
  const shared = { evidence: candidate.sourceText, interpreted: candidate.interpreted };
  switch (candidate.kind) {
    case "SCALAR":
      return { kind: "scalar", feature: candidate.feature.id, op: candidate.op as never, value: candidate.value as number, ...shared };
    case "RANGE":
      return { kind: "range", feature: candidate.feature.id, low: candidate.low as number, high: candidate.high as number, ...shared };
    case "COMPARE":
      return { kind: "compare", left: candidate.feature.id, right: (candidate.right as { id: string }).id, op: candidate.op as never, ...shared };
    case "CROSS":
      return { kind: "cross", left: candidate.feature.id, right: (candidate.right as { id: string }).id, direction: candidate.direction as never, ...shared };
  }
}

/** Every feature a condition depends on — both sides, for comparisons and crosses. */
export function conditionFeatures(condition: ExtractedCondition): string[] {
  return condition.kind === "compare" || condition.kind === "cross"
    ? [condition.left, condition.right]
    : [condition.feature];
}

export interface TriageResult {
  verdict: TriageVerdict;
  reason: string;
  /** Populated only when EXPRESSIBLE. */
  conditions: ExtractedCondition[];
  /** Quantities the hypothesis needs that this deployment cannot derive. */
  missingQuantities: string[];
  /**
   * The compiler's full record: every clause with its classification and why, every refused
   * candidate with its reason, contradictions, and the per-scope DSL. This is what lets a surface
   * show YOU SAID → INTERPRETED → NOT USED AS A RULE instead of a bare list of conditions.
   */
  compiled?: CompiledStrategy;
}

export interface HypothesisInput {
  title: string;
  statement: string;
  rationale?: string | null;
  /**
   * Dependency parses for `triageText(input)`, keyed by clause text (`clauseSlicesOf`).
   *
   * Passed as DATA so this function stays pure — no database, no network, no process spawn. The
   * parse is produced once at the async edge (`authorFromHypotheses`). There is no default: an
   * absent parse must not silently become positional attachment.
   */
  parses: Readonly<Record<string, SyntaxParse>>;
}

/**
 * The exact string the parse must cover.
 *
 * Exported because the caller has to parse precisely what triage will compile; reconstructing this
 * concatenation at the call site would let the two drift, and a parse whose offsets are one title
 * out would attach every operator to the wrong token.
 */
export function triageText(input: Pick<HypothesisInput, "title" | "statement" | "rationale">): string {
  return `${input.title}. ${input.statement} ${input.rationale ?? ""}`;
}

/** Comparison words, mapped to DSL operators. Longest first so ">=" beats ">". */
const COMPARATORS: ReadonlyArray<{ tokens: readonly string[]; op: Comparison }> = Object.freeze([
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
): { op: Comparison; endsAt: number } | null {
  // EARLIEST in the text wins, not first in the table.
  //
  // Choosing by table order made "rsi_14 is below 30 and the close is above the 200-day SMA" read
  // the LATER "above" — from an unrelated clause about a different feature — as rsi's comparator,
  // and the rsi condition was then lost entirely. Ties go to the longer token so ">=" beats ">".
  let best: { op: Comparison; endsAt: number; startsAt: number; length: number } | null = null;
  const leadingSpace = window.length - window.trimStart().length;

  for (const candidate of COMPARATORS) {
    for (const token of candidate.tokens) {
      const startsAt = window.trimStart().startsWith(token)
        ? leadingSpace
        : window.indexOf(` ${token} `) === -1
          ? -1
          : window.indexOf(` ${token} `) + 1;
      if (startsAt === -1) continue;

      const better =
        best === null || startsAt < best.startsAt || (startsAt === best.startsAt && token.length > best.length);
      if (better) {
        best = { op: candidate.op, endsAt: startsAt + token.length, startsAt, length: token.length };
      }
    }
  }
  return best === null ? null : { op: best.op, endsAt: best.endsAt };
}

/** A stable key per condition, so one clause is not read twice from overlapping phrase matches. */
function signatureOf(condition: ExtractedCondition): string {
  if (condition.kind === "compare" || condition.kind === "cross") {
    return `${condition.kind}:${condition.left}:${condition.right}`;
  }
  return `${condition.kind}:${condition.feature}`;
}

/**
 * The feature named at the START of this text, if any.
 *
 * Used for the right-hand side of "close above the 20-day SMA". Anchored at the start (after
 * articles) rather than searched anywhere in the window, so a feature mentioned later in an
 * unrelated clause cannot be pulled in as an operand — the same clause-bleed the sentence clip
 * already guards against for numbers.
 */
function featureAt(text: string): { feature: string } | null {
  const head = text.replace(/^[\s,]*(?:the\s+|its\s+|their\s+|a\s+|an\s+)?/, "");
  for (const entry of lexiconLongestFirst()) {
    for (const phrase of entry.phrases) {
      if (head.startsWith(phrase)) return { feature: entry.feature };
    }
  }
  return null;
}

function lexiconLongestFirst() {
  return [...FEATURE_LEXICON].sort(
    (a, b) => Math.max(...b.phrases.map((p) => p.length)) - Math.max(...a.phrases.map((p) => p.length)),
  );
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
  const entries = lexiconLongestFirst();

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
        const evidence = text.slice(at, at + phrase.length + 40).trim();
        const already = (signature: string) => found.some((existing) => signatureOf(existing) === signature);

        // A BAND, read as a band. "between 55 and 70" narrowed to ">= 55" would silently test a
        // different rule than the one written — the same defect class as the period-as-threshold
        // bug, and just as invisible in the resulting backtest.
        const band = /^[\s_-]*\d*\s*(?:is\s+|are\s+)?between\s+(-?\d+(?:\.\d+)?)\s*%?\s+and\s+(-?\d+(?:\.\d+)?)/.exec(window);
        if (band) {
          const low = Math.min(Number(band[1]), Number(band[2]));
          const high = Math.max(Number(band[1]), Number(band[2]));
          const signature = `range:${entry.feature}`;
          if (!already(signature)) {
            found.push({
              kind: "range",
              feature: entry.feature,
              low,
              high,
              evidence,
              interpreted: `${low} <= ${entry.feature} <= ${high}`,
            });
          }
          continue;
        }

        const comparator = matchComparator(window);
        if (!comparator) continue;
        const after = window.slice(comparator.endsAt);

        // A CROSSING is an event between consecutive bars, not a state. "EMA12 crosses above
        // EMA26" firing on every bar it stays above would be a different rule entirely.
        // Scan the whole clause, not just the text before the comparator: "crosses" can sit on
        // either side of the comparator word depending on phrasing, and the window is already
        // clipped to a single clause, so a crossing named here belongs to this condition.
        const crossing = /cross/.test(window);
        const rightFeature = featureAt(after);
        if (rightFeature && rightFeature.feature !== entry.feature) {
          const direction = comparator.op === "gt" || comparator.op === "gte" ? "above" : "below";
          const signature = crossing
            ? `cross:${entry.feature}:${rightFeature.feature}`
            : `compare:${entry.feature}:${rightFeature.feature}`;
          if (!already(signature)) {
            found.push(
              crossing
                ? {
                    kind: "cross",
                    left: entry.feature,
                    right: rightFeature.feature,
                    direction,
                    evidence,
                    interpreted: `${entry.feature} crosses ${direction} ${rightFeature.feature}`,
                  }
                : {
                    kind: "compare",
                    left: entry.feature,
                    right: rightFeature.feature,
                    op: comparator.op,
                    evidence,
                    interpreted: `${entry.feature} ${comparator.op} ${rightFeature.feature}`,
                  },
            );
          }
          continue;
        }

        // The number must come from AFTER the comparator, not from anywhere in the window.
        //
        // Taking the first number in the window read the indicator's PERIOD as its threshold:
        // "rsi_14 crosses above 70" produced `rsi14 > 14`, which is true on essentially every
        // bar. That rule backtests, produces trades and means nothing — a nonsense condition
        // wearing the costume of a tested one. Every feature a researcher names carries its
        // period (rsi_14, sma_20, atr_14), so this fired on the common case, not an edge one.
        const number = /(-?\d+(?:\.\d+)?)\s*%?/.exec(after);
        if (!number) continue;

        const signature = `scalar:${entry.feature}`;
        if (already(signature)) continue;
        found.push({
          kind: "scalar",
          feature: entry.feature,
          op: comparator.op,
          value: Number(number[1]),
          evidence,
          interpreted: `${entry.feature} ${comparator.op} ${number[1]}`,
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
  const text = triageText(input);
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

  // The SEMANTIC COMPILER owns prose -> conditions. It segments and CLASSIFIES clauses before
  // reading any number, so an observation ("RSI currently 64.1") and an indicator's period
  // ("20-day SMA") can never become trading thresholds, and entry/exit stay in separate scopes.
  const compiled = compileResearchProse(text, input.parses);

  if (compiled.verdict === "CONTRADICTORY" || compiled.verdict === "DIMENSION_ERROR") {
    return {
      verdict: "CONTRADICTORY",
      reason: compiled.reason,
      conditions: [],
      missingQuantities: [],
      compiled,
    };
  }

  const conditions = compiled.conditions.map(asExtractedCondition);
  if (compiled.verdict === "NO_RULE_FOUND" || conditions.length === 0) {
    return {
      verdict: "UNCLEAR",
      reason:
        `${compiled.reason} This is a statement about what the compiler can read, not about the ` +
        "hypothesis: a rule stated in other words is refused here and is still worth expressing by hand.",
      conditions: [],
      missingQuantities: [],
      compiled,
    };
  }

  // Belt and braces: the lexicon can only emit vocabulary names, but a typo in the table would be
  // caught here rather than at compile time with a less obvious message.
  const notDerivable = [...new Set(conditions.flatMap(conditionFeatures))].filter(
    (feature) => !(DERIVABLE_FEATURES as readonly string[]).includes(feature),
  );
  if (notDerivable.length > 0) {
    return {
      verdict: "NEEDS_FEATURE",
      reason: `The lexicon produced ${notDerivable.join(", ")}, which no engine here derives from price data.`,
      conditions: [],
      missingQuantities: notDerivable,
      compiled,
    };
  }

  return {
    verdict: "EXPRESSIBLE",
    reason:
      `Read ${conditions.length} condition(s) directly from the text: ` +
      conditions.map((condition) => condition.interpreted).join(", ") +
      ". Every threshold comes from the hypothesis itself; none was defaulted.",
    conditions,
    missingQuantities: [],
    compiled,
  };
}

/** The entry condition implied by an expressible hypothesis. */
export function entryConditionFrom(conditions: readonly ExtractedCondition[]): Condition {
  const clauses: Condition[] = conditions.map((condition) => {
    switch (condition.kind) {
      case "scalar":
        return { feature: condition.feature, op: condition.op, value: condition.value };
      case "range":
        // The band compiles to BOTH bounds. This is the "actually tested" form, and it is what
        // makes the interpretation checkable: a reader can see that nothing was dropped.
        return {
          all: [
            { feature: condition.feature, op: "gte" as const, value: condition.low },
            { feature: condition.feature, op: "lte" as const, value: condition.high },
          ],
        };
      case "compare":
        return { compare: [condition.left, condition.right] as [string, string], op: condition.op };
      case "cross":
        return condition.direction === "above"
          ? { crossover: [condition.left, condition.right] as [string, string] }
          : { crossunder: [condition.left, condition.right] as [string, string] };
    }
  });
  return clauses.length === 1 ? clauses[0] : { all: clauses };
}

/** Exported for the test that pins the lexicon to the DSL vocabulary. */
export const LEXICON_FEATURES: readonly string[] = FEATURE_LEXICON.map((entry) => entry.feature);
export const VOCABULARY: readonly string[] = POINT_IN_TIME_FEATURES;
