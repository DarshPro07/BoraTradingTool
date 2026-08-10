import { runBacktest } from "@/lib/backtest/engine";
import type { Candle } from "@/lib/providers/types";
import { mean, profitFactor, sharpeRatio } from "@/lib/strategy/statistics";
import type { Condition, StrategyDsl } from "@/lib/strategy/dsl";

/**
 * Component ablation — which of a strategy's rules actually earn their place.
 *
 * ## Why this exists
 *
 * The gauntlet grades a strategy as a bundle: seven stages, one verdict. That is the right shape
 * for deciding whether to trade something, and the wrong shape for learning anything. A bundle
 * that passes can contain one rule carrying the entire edge and four rules quietly destroying it,
 * and the verdict looks identical either way.
 *
 * The prompting case for building this came from a published study that ran ~25,000 sampled
 * configurations of one discretionary framework over sixteen years of one-minute futures data.
 * Built up one rule at a time against a fixed harness, the scores went: the entry pattern alone
 * ~33, plus the liquidity-sweep requirement ~69, plus a displacement filter *down*, plus the
 * session-window restriction *down again*, plus the higher-timeframe bias filter ~0.16. One rule
 * of six carried the edge and the rest were subtraction. Nothing in a pass/fail verdict could
 * have shown that.
 *
 * ## Two views, because one is not enough
 *
 * **Incremental** adds components in order and scores each step. It shows marginal contribution,
 * and it is *order-dependent* — two correlated rules will credit whichever came first.
 *
 * **Leave-one-out** removes each component from the complete strategy. It is order-independent
 * and answers the question a reader actually has: if I delete this rule, what happens?
 *
 * They disagree when components are correlated, and the disagreement is itself the finding.
 *
 * ## What this refuses to do
 *
 * - **Score a variant with too few trades.** A Sharpe over eight trades is noise wearing a
 *   decimal point. Below `minimumTrades` the score is `null` with a stated reason, never a
 *   number that will be ranked on anyway.
 * - **Score in-sample.** Every variant is graded on the out-of-sample split only. A rule that
 *   improves the in-sample fit and nothing else is exactly what ablation exists to expose, and
 *   grading in-sample would hide it.
 * - **Hide the trial cost.** Every variant evaluated is a search step. `variantsEvaluated` is
 *   returned so the caller can add it to the selection-cost denominator before any gauntlet is
 *   run on the winner. Ablating six components and then gauntleting the best arrangement while
 *   declaring one trial is how a search gets reported as a discovery.
 */

/** Below this, a variant's returns cannot distinguish an edge from noise at any useful width. */
export const MINIMUM_TRADES = 30;

export interface VariantScore {
  /** Out-of-sample trades. In-sample trades are used for nothing here, deliberately. */
  trades: number;
  /** Out-of-sample Sharpe. Null when `trades` is below `minimumTrades`. */
  sharpe: number | null;
  profitFactor: number | null;
  meanNetReturn: number | null;
  /** Present when the variant could not be scored. Mutually exclusive with a numeric score. */
  refusal: string | null;
}

export interface AblationStep extends VariantScore {
  /** Components present at this step. */
  components: string[];
  /** The component added (incremental) or removed (leave-one-out) at this step. */
  changed: string | null;
  /**
   * Change in Sharpe against the reference step. Null when either side is unscored — a delta
   * against an unscored baseline is not a small effect, it is an unknown one.
   */
  delta: number | null;
}

export interface AblationReport {
  strategy: string;
  /** Human-readable rendering of each conjunct of the entry condition. */
  components: string[];
  /** Built up one component at a time, in the order the strategy declares them. */
  incremental: AblationStep[];
  /** The complete strategy with each component removed in turn. */
  leaveOneOut: AblationStep[];
  /** Backtests actually run. Every one is a search step and belongs in the trial denominator. */
  variantsEvaluated: number;
  summary: string;
  /** Findings a reader would otherwise have to derive: order dependence, unscored steps. */
  notes: string[];
}

/** A short, stable rendering of a condition, used as the component label. */
export function describeCondition(condition: Condition): string {
  if ("feature" in condition) return `${condition.feature} ${condition.op} ${condition.value}`;
  if ("compare" in condition) return `${condition.compare[0]} ${condition.op} ${condition.compare[1]}`;
  if ("crossover" in condition) return `${condition.crossover[0]} crosses above ${condition.crossover[1]}`;
  if ("crossunder" in condition) return `${condition.crossunder[0]} crosses below ${condition.crossunder[1]}`;
  if ("not" in condition) return `not(${describeCondition(condition.not)})`;
  if ("all" in condition) return `all(${condition.all.map(describeCondition).join(" & ")})`;
  return `any(${condition.any.map(describeCondition).join(" | ")})`;
}

/**
 * The conjuncts of an entry condition.
 *
 * Only a top-level `all` decomposes. An `any` is a disjunction — removing a branch changes the
 * rule's meaning rather than removing a filter — and a bare condition has nothing to ablate.
 * Both return a single component, which produces a one-row report that says so rather than an
 * empty one that reads like a failure.
 */
export function entryComponents(entry: Condition): Condition[] {
  return "all" in entry ? [...entry.all] : [entry];
}

function withEntry(dsl: StrategyDsl, components: Condition[]): StrategyDsl {
  // Everything except the entry is held fixed — sizing, costs, exits, universe. A variant that
  // also changed its cost model would not be measuring the component.
  return { ...dsl, entry: components.length === 1 ? components[0] : { all: components } };
}

export interface AblationOptions {
  minimumTrades?: number;
  /** Share of trades treated as in-sample. Passed through to the engine; default 0.5 there. */
  inSampleFraction?: number;
}

function score(
  dsl: StrategyDsl,
  bars: readonly Candle[],
  minimumTrades: number,
  inSampleFraction?: number,
): VariantScore {
  const run = runBacktest(dsl, bars, inSampleFraction === undefined ? {} : { inSampleFraction });
  if (!run.ok) {
    return { trades: 0, sharpe: null, profitFactor: null, meanNetReturn: null, refusal: run.message };
  }

  const returns = run.evidence.outOfSampleReturns;
  if (returns.length < minimumTrades) {
    return {
      trades: returns.length,
      sharpe: null,
      profitFactor: null,
      meanNetReturn: null,
      refusal:
        `${returns.length} out-of-sample trade(s); ${minimumTrades} is the minimum before a score ` +
        "distinguishes an edge from noise.",
    };
  }

  return {
    trades: returns.length,
    sharpe: sharpeRatio(returns),
    profitFactor: profitFactor(returns),
    meanNetReturn: mean(returns),
    refusal: null,
  };
}

function delta(current: VariantScore, reference: VariantScore | null): number | null {
  if (reference === null || current.sharpe === null || reference.sharpe === null) return null;
  return current.sharpe - reference.sharpe;
}

export function ablateStrategy(
  dsl: StrategyDsl,
  bars: readonly Candle[],
  options: AblationOptions = {},
): AblationReport {
  const minimumTrades = options.minimumTrades ?? MINIMUM_TRADES;
  const parts = entryComponents(dsl.entry);
  const labels = parts.map(describeCondition);
  const notes: string[] = [];
  let variantsEvaluated = 0;

  if (parts.length === 1) {
    notes.push(
      "The entry condition is a single component, so there is nothing to ablate. " +
        ("all" in dsl.entry
          ? ""
          : "Only a top-level `all` decomposes — an `any` is a disjunction, where removing a branch " +
            "changes the rule rather than removing a filter."),
    );
  }

  const incremental: AblationStep[] = [];
  let previous: VariantScore | null = null;
  for (let i = 0; i < parts.length; i += 1) {
    const subset = parts.slice(0, i + 1);
    const result = score(withEntry(dsl, subset), bars, minimumTrades, options.inSampleFraction);
    variantsEvaluated += 1;
    incremental.push({
      ...result,
      components: labels.slice(0, i + 1),
      changed: labels[i],
      delta: delta(result, previous),
    });
    previous = result;
  }

  const complete = incremental[incremental.length - 1] ?? null;
  const leaveOneOut: AblationStep[] = [];
  if (parts.length > 1) {
    for (let i = 0; i < parts.length; i += 1) {
      const subset = parts.filter((_, index) => index !== i);
      const result = score(withEntry(dsl, subset), bars, minimumTrades, options.inSampleFraction);
      variantsEvaluated += 1;
      leaveOneOut.push({
        ...result,
        components: labels.filter((_, index) => index !== i),
        changed: labels[i],
        // Sign convention: positive means the complete strategy scored HIGHER than the strategy
        // without this component — that is, the component contributed. Computed as
        // complete − without, so the number reads the same direction as the incremental deltas.
        delta: complete === null ? null : delta(complete, result),
      });
    }
  }

  // Order dependence is not a caveat to bury. Two correlated rules credit whichever came first,
  // and a reader comparing the two tables without being told this will read the disagreement as
  // a bug.
  if (parts.length > 1) {
    const disagreements = leaveOneOut.filter((entry) => {
      const incrementalStep = incremental.find((step) => step.changed === entry.changed);
      if (!incrementalStep || incrementalStep.delta === null || entry.delta === null) return false;
      return Math.sign(incrementalStep.delta) !== Math.sign(entry.delta);
    });
    if (disagreements.length > 0) {
      notes.push(
        `${disagreements.length} component(s) contribute in one view and subtract in the other: ` +
          `${disagreements.map((entry) => entry.changed).join(", ")}. That is what correlated rules look ` +
          "like — incremental credits whichever came first. Neither view is wrong; treat the pair as the finding.",
      );
    }
  }

  const unscored = [...incremental, ...leaveOneOut].filter((step) => step.refusal !== null);
  if (unscored.length > 0) {
    notes.push(
      `${unscored.length} of ${variantsEvaluated} variant(s) could not be scored, mostly for too few ` +
        "trades. An unscored step is not a zero — it is a step this data cannot speak to.",
    );
  }

  notes.push(
    `${variantsEvaluated} backtest(s) were run to produce this report. Every one is a search step: ` +
      "add them to the selection-cost denominator before running the gauntlet on whichever arrangement " +
      "wins, or the deflated Sharpe will be computed as though this search never happened.",
  );

  const best = [...leaveOneOut]
    .filter((step) => step.delta !== null)
    .sort((a, b) => (b.delta as number) - (a.delta as number))[0];
  const worst = [...leaveOneOut]
    .filter((step) => step.delta !== null)
    .sort((a, b) => (a.delta as number) - (b.delta as number))[0];

  const summary =
    parts.length === 1
      ? `${dsl.name}: a single-component entry, nothing to ablate.`
      : best === undefined
        ? `${dsl.name}: ${parts.length} components, none scoreable on this data.`
        : `${dsl.name}: ${parts.length} components over ${variantsEvaluated} variants. ` +
          `Strongest contributor "${best.changed}" (${(best.delta as number).toFixed(3)} Sharpe). ` +
          (worst && (worst.delta as number) < 0
            ? `"${worst.changed}" subtracts (${(worst.delta as number).toFixed(3)}) — removing it scored higher.`
            : "Every component contributed or was neutral.");

  return { strategy: dsl.name, components: labels, incremental, leaveOneOut, variantsEvaluated, summary, notes };
}
