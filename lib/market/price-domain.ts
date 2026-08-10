import type { Candle } from "@/lib/providers/types";

/**
 * Price domains — which representation a series is in, and what may be computed from it.
 *
 * ## The defect this exists to prevent
 *
 * `lib/backtest/engine.ts:298` computes
 *
 *     const grossReturn = (exit.price - position.entryPrice) / position.entryPrice;
 *
 * That is a **ratio**. Today every series reaching it is raw daily equity bars, so it is correct.
 * The day a back-adjusted continuous futures series arrives, every historical price carries a
 * cumulative roll adjustment — and adding a constant to both terms of that fraction changes the
 * answer. Nothing throws. The backtest reports a different number and looks entirely healthy,
 * which is the worst failure mode a research system has: a wrong result that passes every check.
 *
 * ## The rule, stated once
 *
 * An operation is legal on `CONTINUOUS_ADDITIVE` **if and only if adding a constant to every
 * price leaves its result unchanged.** That is the whole rule. Everything below is a consequence.
 *
 *   legal      high − low, entry − stop, profit_points / risk_points,
 *              (price − low) / (high − low)          ← the shift cancels top and bottom
 *   illegal    close[t] / close[t−1], log returns, percentage drawdown off an adjusted level,
 *              range / close, any ranking whose sort key is a price level
 *
 * Note what this rule does *not* say: it does not ban division. `profit_points / risk_points` and
 * normalized location are both divisions and both legal. A blanket ban on dividing by price would
 * outlaw momentum, normalized volatility, relative strength and cross-sectional ranking — most of
 * a quant platform — which is why the naive version of this rule was not implemented.
 *
 * ## Enforced three ways, because one is not enough
 *
 * 1. **Statically.** `pctChange`, `logReturn` and `tradedPrice` constrain their domain parameter,
 *    so passing the wrong frame is a compile error. This catches the mistake at authoring time,
 *    where it is cheapest.
 * 2. **At runtime.** A domain read from a file or a database has no type by the time it arrives.
 *    Every guard re-checks.
 * 3. **Empirically.** `isTranslationInvariant` *measures* invariance by shifting the series and
 *    re-running. A new operation can be verified mechanically instead of argued about, which is
 *    the difference between a rule that holds and a list somebody forgot to update.
 */

export const PRICE_DOMAINS = [
  /** Prices that actually traded. The only thing an order may be simulated against. */
  "RAW_TRADED",
  /** Back-adjusted by subtracting roll gaps. Distances survive; levels and ratios do not. */
  "CONTINUOUS_ADDITIVE",
  /** Back-adjusted by scaling. Percentage changes survive; absolute point distances do not. */
  "CONTINUOUS_RATIO",
  /** Cash equity adjusted for splits, bonuses and dividends. */
  "EQUITY_CORP_ACTION_ADJUSTED",
  /** The index or cash underlying of a derivative, not the derivative itself. */
  "UNDERLYING_SPOT",
] as const;

export type PriceDomain = (typeof PRICE_DOMAINS)[number];

/**
 * Domains in which a price ratio is economically meaningful.
 *
 * Everything except `CONTINUOUS_ADDITIVE`, and stated as an explicit union rather than
 * `Exclude<...>` so that adding a future domain forces a deliberate decision here instead of
 * silently inheriting permission.
 */
export type RatioSafeDomain =
  | "RAW_TRADED"
  | "CONTINUOUS_RATIO"
  | "EQUITY_CORP_ACTION_ADJUSTED"
  | "UNDERLYING_SPOT";

const RATIO_SAFE: ReadonlySet<PriceDomain> = new Set<PriceDomain>([
  "RAW_TRADED",
  "CONTINUOUS_RATIO",
  "EQUITY_CORP_ACTION_ADJUSTED",
  "UNDERLYING_SPOT",
]);

/** Only prices that actually traded may price a fill. */
export type ExecutionSafeDomain = "RAW_TRADED";

/** Domains carrying a synthetic adjustment, so a cumulative adjustment is meaningful. */
const ADJUSTED: ReadonlySet<PriceDomain> = new Set<PriceDomain>([
  "CONTINUOUS_ADDITIVE",
  "CONTINUOUS_RATIO",
  "EQUITY_CORP_ACTION_ADJUSTED",
]);

export type PriceDomainErrorCode =
  | "RATIO_ON_ADDITIVE"
  | "EXECUTION_REQUIRES_RAW"
  | "PURPOSE_DOMAIN_MISMATCH"
  | "MIXED_DOMAIN_OPERANDS"
  | "MIXED_INSTRUMENT_OPERANDS"
  | "ADJUSTMENT_ON_RAW";

export class PriceDomainError extends Error {
  constructor(
    readonly code: PriceDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PriceDomainError";
  }
}

export interface PriceFrame<D extends PriceDomain = PriceDomain> {
  readonly domain: D;
  readonly bars: readonly Candle[];
  readonly instrumentId: string;
  /**
   * Total adjustment folded into this series, in points for additive and as a factor for ratio.
   * Null on `RAW_TRADED`, where an adjustment would be a contradiction rather than a zero.
   */
  readonly cumulativeAdjustment: number | null;
}

export interface FrameOptions {
  instrumentId: string;
  cumulativeAdjustment?: number;
}

export function priceFrame<D extends PriceDomain>(
  bars: readonly Candle[],
  domain: D,
  options: FrameOptions,
): PriceFrame<D> {
  if (options.cumulativeAdjustment !== undefined && !ADJUSTED.has(domain)) {
    // A raw series claiming an adjustment is mislabelled: one of the two facts is wrong, and
    // guessing which would bury the defect instead of surfacing it.
    throw new PriceDomainError(
      "ADJUSTMENT_ON_RAW",
      `${domain} carries no adjustment, but one of ${options.cumulativeAdjustment} was supplied. ` +
        "The series is mislabelled — either it is adjusted and the domain is wrong, or it is raw " +
        "and the adjustment is.",
    );
  }
  return {
    domain,
    bars,
    instrumentId: options.instrumentId,
    cumulativeAdjustment: options.cumulativeAdjustment ?? null,
  };
}

function refuseAdditiveRatio(domain: PriceDomain, operation: string): void {
  if (RATIO_SAFE.has(domain)) return;
  throw new PriceDomainError(
    "RATIO_ON_ADDITIVE",
    `${operation} is a ratio and this series is ${domain}. Every price in it carries a cumulative ` +
      "roll adjustment, so the constant does not cancel and the result is not a return. Use " +
      "RAW_TRADED contract-consistent prices or CONTINUOUS_RATIO.",
  );
}

// ---------------------------------------------------------------------------------------------
// Translation-invariant operations. Legal in every domain, including CONTINUOUS_ADDITIVE.
// ---------------------------------------------------------------------------------------------

/** High minus low, in points. A distance, so any constant shift cancels. */
export function spread(frame: PriceFrame, index: number): number {
  const bar = frame.bars[index];
  return bar.high - bar.low;
}

/**
 * Where a close sits inside its own bar's range, 0–1.
 *
 * Legal on an additive series precisely because the shift appears in both the numerator and the
 * denominator and cancels — the case the specification calls out as wrongly banned by a blanket
 * no-division rule.
 */
export function normalizedLocation(frame: PriceFrame, index: number): number {
  const bar = frame.bars[index];
  const range = bar.high - bar.low;
  if (range === 0) return 0.5;
  return (bar.close - bar.low) / range;
}

/** Distance in points between two prices from the same frame. */
export function pointDistance(a: number, b: number): number {
  return a - b;
}

// ---------------------------------------------------------------------------------------------
// Ratio operations. Compile error on CONTINUOUS_ADDITIVE; runtime guard for untyped callers.
// ---------------------------------------------------------------------------------------------

export function pctChange<D extends RatioSafeDomain>(frame: PriceFrame<D>, index: number): number {
  refuseAdditiveRatio(frame.domain, "pctChange");
  const previous = frame.bars[index - 1].close;
  return (frame.bars[index].close - previous) / previous;
}

export function logReturn<D extends RatioSafeDomain>(frame: PriceFrame<D>, index: number): number {
  refuseAdditiveRatio(frame.domain, "logReturn");
  return Math.log(frame.bars[index].close / frame.bars[index - 1].close);
}

// ---------------------------------------------------------------------------------------------
// Execution. Raw traded prices only, always.
// ---------------------------------------------------------------------------------------------

/**
 * A price an order may be simulated against.
 *
 * Refuses every adjusted domain. A synthetic price is not one that traded, and an early-history
 * additive series under a large cumulative adjustment can be zero or negative — a fill there is
 * not merely inaccurate, it is impossible.
 */
export function tradedPrice<D extends ExecutionSafeDomain>(frame: PriceFrame<D>, index: number): number {
  if (frame.domain !== "RAW_TRADED") {
    throw new PriceDomainError(
      "EXECUTION_REQUIRES_RAW",
      `Execution requires RAW_TRADED prices; this series is ${frame.domain}. A synthetic price is ` +
        "not one that traded, so a fill against it describes a trade that could not have happened.",
    );
  }
  return frame.bars[index].close;
}

// ---------------------------------------------------------------------------------------------
// The loader gate.
// ---------------------------------------------------------------------------------------------

export const LOAD_PURPOSES = [
  "POINT_SIGNAL",
  "RETURN_SIGNAL",
  "CHART",
  "EXECUTION_SIM",
  "RECONCILIATION",
  "RESEARCH",
] as const;
export type LoadPurpose = (typeof LOAD_PURPOSES)[number];

const PERMITTED: Readonly<Record<LoadPurpose, ReadonlySet<PriceDomain>>> = Object.freeze({
  // Point geometry — distances, gaps, swings — is exactly what additive back-adjustment is for.
  POINT_SIGNAL: new Set<PriceDomain>([
    "RAW_TRADED",
    "CONTINUOUS_ADDITIVE",
    "EQUITY_CORP_ACTION_ADJUSTED",
    "UNDERLYING_SPOT",
  ]),
  RETURN_SIGNAL: new Set<PriceDomain>(RATIO_SAFE),
  // A chart exists to be compared against a real historical chart, so it must show real prices.
  CHART: new Set<PriceDomain>(["RAW_TRADED", "UNDERLYING_SPOT"]),
  EXECUTION_SIM: new Set<PriceDomain>(["RAW_TRADED"]),
  RECONCILIATION: new Set<PriceDomain>(["RAW_TRADED"]),
  RESEARCH: new Set<PriceDomain>(PRICE_DOMAINS),
});

export function assertDomainForPurpose(domain: PriceDomain, purpose: LoadPurpose): void {
  if (PERMITTED[purpose].has(domain)) return;
  throw new PriceDomainError(
    "PURPOSE_DOMAIN_MISMATCH",
    `${purpose} cannot be served by ${domain}. Permitted: ${[...PERMITTED[purpose]].join(", ")}.`,
  );
}

// ---------------------------------------------------------------------------------------------
// Operand compatibility.
// ---------------------------------------------------------------------------------------------

/**
 * Two frames may only be combined when they share a domain *and* an instrument.
 *
 * The domain half catches a raw price measured against an adjusted range — a number that looks
 * normalized and is not. The instrument half catches something subtler: two additive series carry
 * two *different* cumulative adjustments, so their price levels sit on different axes. Ranking
 * instruments by adjusted level produces a confident ordering of quantities that were never
 * comparable. Distances remain comparable across instruments; levels never do.
 */
export function requireSameDomain(a: PriceFrame, b: PriceFrame): void {
  if (a.domain !== b.domain) {
    throw new PriceDomainError(
      "MIXED_DOMAIN_OPERANDS",
      `Operands are in different price domains (${a.domain} and ${b.domain}). The result would look ` +
        "normalized and would not be.",
    );
  }
  if (a.instrumentId !== b.instrumentId && a.domain === "CONTINUOUS_ADDITIVE") {
    throw new PriceDomainError(
      "MIXED_INSTRUMENT_OPERANDS",
      `${a.instrumentId} and ${b.instrumentId} are both CONTINUOUS_ADDITIVE but carry different ` +
        "cumulative adjustments, so their price levels are not on the same axis. Compare distances, " +
        "not levels, across instruments.",
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Mechanical verification.
// ---------------------------------------------------------------------------------------------

/** Every price in the frame moved by `delta`. The operation a roll adjustment performs. */
export function shiftFrame<D extends PriceDomain>(frame: PriceFrame<D>, delta: number): PriceFrame<D> {
  return {
    ...frame,
    bars: frame.bars.map((bar) => ({
      ...bar,
      open: bar.open + delta,
      high: bar.high + delta,
      low: bar.low + delta,
      close: bar.close + delta,
    })),
  };
}

/**
 * Whether an operation survives a constant shift — measured, not asserted.
 *
 * This is the reason the rule is enforceable rather than merely documented. A new detector can be
 * checked against the actual definition instead of being argued about in review, and a list of
 * banned function names cannot silently fall out of date.
 *
 * Two deltas are tried because a single one can coincidentally agree: `close/open` is not
 * invariant, yet a shift chosen adversarially could return the same value once.
 */
export function isTranslationInvariant(
  operation: (frame: PriceFrame) => number,
  frame: PriceFrame,
  deltas: readonly number[] = [1_000, 7_919],
): boolean {
  const base = operation(frame);
  return deltas.every((delta) => {
    const shifted = operation(shiftFrame(frame, delta));
    if (!Number.isFinite(base) || !Number.isFinite(shifted)) return false;
    // Relative tolerance: a shift of 7,919 on a price near 100 costs real floating-point precision,
    // and an exact comparison would report genuinely invariant arithmetic as variant.
    return Math.abs(shifted - base) <= 1e-9 * Math.max(1, Math.abs(base));
  });
}
