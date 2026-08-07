import type { Candle } from "@/lib/providers/types";
import { calculatePaperFees } from "@/lib/paper/fees";
import type { Market } from "@/lib/market/types";

/**
 * vwap_ema_pullback_scalper_v1 — a paper-only intraday signal evaluator.
 *
 * This is deliberately not a bot. It evaluates one instrument on closed intraday candles and
 * produces one of three answers: a refusal (the inputs cannot support a conclusion), no-setup
 * (the inputs are fine and the answer is "don't trade"), or a proposal that is structurally
 * incapable of executing — `executable` is typed as the literal `false`, every proposal
 * carries an expiry, and nothing downstream accepts a proposal as an order.
 *
 * The external audit that motivated this module screened 19 GitHub scalping bots and none
 * survived: wrong markets, leverage, unverifiable claims, several with malware-shaped
 * distribution. What was worth keeping is architectural — closed-bar evaluation, spread and
 * cost gates, fail-closed risk caps — and that is what is reimplemented here under this
 * repository's own tests and governance.
 *
 * Honesty constraints, which are the point:
 *  - Decisions use closed bars only. A forming candle repaints; acting on it is lookahead.
 *  - Yahoo-derived minute bars carry no bid/ask, so the spread is UNKNOWN. The cost gate
 *    therefore uses the statutory intraday fee model plus a stated slippage assumption, and
 *    every proposal records `spreadKnown: false` rather than pretending the spread is zero.
 *  - Missing is not zero: stale data, a non-regular session, or too few bars is a refusal,
 *    never a default.
 */

export const STRATEGY_ID = "vwap_ema_pullback_scalper_v1";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ScalpingParams {
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  atrPeriod: number;
  /** RSI must sit inside this trend zone: strong but not exhausted. */
  rsiMin: number;
  rsiMax: number;
  /** Current bar volume vs the average of the prior `rvolLookback` bars. */
  minRelativeVolume: number;
  rvolLookback: number;
  /** ATR as a fraction of price must sit inside this regime band. */
  minAtrPct: number;
  maxAtrPct: number;
  /** Maximum distance of close above the fast EMA, in ATRs — the anti-chasing gate. */
  maxExtensionAtr: number;
  /** Candle body as a share of its range. */
  minBodyRatio: number;
  /** Expected favourable move, in ATRs, that the cost gate compares against round-trip cost. */
  expectedMoveAtr: number;
  /** Expected move must exceed estimated round-trip cost by at least this multiple. */
  minCostCoverage: number;
  /** Assumed one-way slippage in basis points, stated on every proposal. */
  assumedSlippageBps: number;
  /** Fraction of equity risked per trade. */
  riskBudgetPct: number;
  /** Maximum position notional as a fraction of equity. */
  positionBudgetPct: number;
  /** Stop distance in ATRs below entry (bounded by recent structure). */
  stopAtr: number;
  /** Reward multiple for the advisory target. */
  targetR: number;
  /** Proposal lifetime in seconds; a stale proposal must be re-evaluated, not confirmed. */
  proposalTtlSeconds: number;
  /** Data older than this relative to `now` is stale. */
  maxDataAgeSeconds: number;
  minBars: number;
}

export const DEFAULT_PARAMS: Readonly<ScalpingParams> = Object.freeze({
  emaFast: 9,
  emaSlow: 21,
  rsiPeriod: 14,
  atrPeriod: 14,
  rsiMin: 50,
  rsiMax: 75,
  minRelativeVolume: 1.2,
  rvolLookback: 20,
  minAtrPct: 0.0008,
  maxAtrPct: 0.03,
  maxExtensionAtr: 1.0,
  minBodyRatio: 0.5,
  expectedMoveAtr: 1.0,
  minCostCoverage: 3,
  assumedSlippageBps: 4,
  riskBudgetPct: 0.005,
  positionBudgetPct: 0.25,
  stopAtr: 1.1,
  targetR: 1.5,
  proposalTtlSeconds: 120,
  maxDataAgeSeconds: 180,
  minBars: 40,
});

export type SessionState = "PRE_OPEN" | "REGULAR" | "POST_CLOSE" | "CLOSED";

export interface ScalpingContext {
  instrumentId: string;
  market: Market;
  /** Intraday bars for the current session, ascending by time. May include a forming bar. */
  bars: readonly Candle[];
  /** Bar interval in seconds (60 or 300). */
  barIntervalSeconds: number;
  /** Evaluation clock, epoch seconds. Injected so every decision is replayable. */
  now: number;
  session: SessionState;
  /** Cash available to size against. */
  equity: number;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type RefusalCode =
  | "SESSION_NOT_REGULAR"
  | "STALE_DATA"
  | "INSUFFICIENT_BARS"
  | "UNORDERED_BARS"
  | "INVALID_EQUITY";

export interface ScalpingRefusal {
  kind: "refusal";
  code: RefusalCode;
  message: string;
}

export interface ConditionResult {
  condition: string;
  passed: boolean;
  detail: string;
}

export interface ScalpingNoSetup {
  kind: "no_setup";
  conditions: ConditionResult[];
  /** The closed bar the decision was made on. */
  decisionBarTime: number;
}

export interface ScalpingProposal {
  kind: "proposal";
  strategyId: typeof STRATEGY_ID;
  instrumentId: string;
  side: "BUY";
  /**
   * Structurally non-executable. The literal type means no assignment can ever make this
   * true without a compile error, and `evaluateScalpingSetup` freezes the object.
   */
  executable: false;
  confirmationRequired: true;
  decisionBarTime: number;
  /** Reference entry: next-bar market order assumption at the decision close. */
  referenceEntry: number;
  advisoryStop: number;
  advisoryTarget: number;
  quantity: number;
  riskPerShare: number;
  /** quantity × riskPerShare — never exceeds equity × riskBudgetPct. */
  riskAmount: number;
  notional: number;
  /** Estimated round-trip cost behind the cost gate, and what it assumed. */
  estimatedRoundTripCost: number;
  spreadKnown: false;
  assumedSlippageBps: number;
  conditions: ConditionResult[];
  issuedAt: number;
  expiresAt: number;
}

export type ScalpingDecision = ScalpingRefusal | ScalpingNoSetup | ScalpingProposal;

// ---------------------------------------------------------------------------
// Indicator helpers — pure, closed-bar, self-contained
// ---------------------------------------------------------------------------

function emaSeries(values: readonly number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values[0];
  for (const value of values) {
    ema = value * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

function rsi(closes: readonly number[], period: number): number {
  if (closes.length <= period) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period;
  }
  // Flat is neutral, not overbought — the same convention lib/data/technicals.ts settled on.
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function atr(bars: readonly Candle[], period: number): number {
  if (bars.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    ranges.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close),
      ),
    );
  }
  const window = ranges.slice(-period);
  return window.reduce((total, value) => total + value, 0) / window.length;
}

/** Session VWAP over the supplied bars, volume-weighted typical price. */
function sessionVwap(bars: readonly Candle[]): number | null {
  let pv = 0;
  let volume = 0;
  for (const bar of bars) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    pv += typical * bar.volume;
    volume += bar.volume;
  }
  return volume > 0 ? pv / volume : null;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function refuse(code: RefusalCode, message: string): ScalpingRefusal {
  return { kind: "refusal", code, message };
}

export function evaluateScalpingSetup(
  context: ScalpingContext,
  params: ScalpingParams = DEFAULT_PARAMS,
): ScalpingDecision {
  const { now, barIntervalSeconds } = context;

  if (context.session !== "REGULAR") {
    return refuse(
      "SESSION_NOT_REGULAR",
      `Session is ${context.session}. Pre-open and post-close bars have auction and liquidity semantics this strategy has never been evaluated on.`,
    );
  }
  if (!Number.isFinite(context.equity) || context.equity <= 0) {
    return refuse("INVALID_EQUITY", `Equity ${context.equity} cannot size a position.`);
  }

  // A bar is closed once its full interval has elapsed. The forming bar repaints and is
  // excluded from every calculation, not just the trigger.
  const closed = context.bars.filter((bar) => bar.time + barIntervalSeconds <= now);

  for (let i = 1; i < closed.length; i += 1) {
    if (closed[i].time <= closed[i - 1].time) {
      return refuse("UNORDERED_BARS", `Bars are not strictly ascending at index ${i}. Re-sorting here would hide a data fault.`);
    }
  }
  if (closed.length < params.minBars) {
    return refuse(
      "INSUFFICIENT_BARS",
      `${closed.length} closed bars; ${params.minBars} needed before the indicators mean anything.`,
    );
  }

  const last = closed[closed.length - 1];
  const dataAge = now - (last.time + barIntervalSeconds);
  if (dataAge > params.maxDataAgeSeconds) {
    return refuse(
      "STALE_DATA",
      `Last closed bar ended ${dataAge}s ago; limit ${params.maxDataAgeSeconds}s. A decision on stale data is a decision about the past.`,
    );
  }

  const closes = closed.map((bar) => bar.close);
  const emaFastSeries = emaSeries(closes, params.emaFast);
  const emaSlowSeries = emaSeries(closes, params.emaSlow);
  const emaFast = emaFastSeries[emaFastSeries.length - 1];
  const emaFastPrev = emaFastSeries[emaFastSeries.length - 2];
  const emaSlow = emaSlowSeries[emaSlowSeries.length - 1];
  const vwap = sessionVwap(closed);
  const currentRsi = rsi(closes, params.rsiPeriod);
  const currentAtr = atr(closed, params.atrPeriod);
  const atrPct = currentAtr / last.close;

  const prior = closed[closed.length - 2];
  const priorFastEma = emaFastSeries[emaFastSeries.length - 2];
  const range = last.high - last.low;
  const body = last.close - last.open;
  const priorVolumes = closed.slice(-1 - params.rvolLookback, -1).map((bar) => bar.volume);
  const avgVolume = priorVolumes.reduce((total, value) => total + value, 0) / Math.max(1, priorVolumes.length);
  const rvol = avgVolume > 0 ? last.volume / avgVolume : 0;

  const fees =
    calculatePaperFees({ market: context.market, currency: context.market === "US" ? "USD" : "INR", side: "BUY", notional: last.close, product: "INTRADAY" }) +
    calculatePaperFees({ market: context.market, currency: context.market === "US" ? "USD" : "INR", side: "SELL", notional: last.close, product: "INTRADAY" });
  const slippage = 2 * last.close * (params.assumedSlippageBps / 10_000);
  const roundTripCost = fees + slippage;
  const expectedMove = params.expectedMoveAtr * currentAtr;

  const conditions: ConditionResult[] = [
    {
      condition: "trend_alignment",
      passed: emaFast > emaSlow,
      detail: `EMA${params.emaFast} ${emaFast.toFixed(2)} vs EMA${params.emaSlow} ${emaSlow.toFixed(2)}.`,
    },
    {
      condition: "fast_ema_rising",
      passed: emaFast > emaFastPrev,
      detail: `EMA${params.emaFast} ${emaFast.toFixed(2)} vs previous ${emaFastPrev.toFixed(2)}.`,
    },
    {
      condition: "above_session_vwap",
      passed: vwap !== null && last.close > vwap,
      detail: vwap === null ? "VWAP undefined: session volume is zero." : `Close ${last.close.toFixed(2)} vs VWAP ${vwap.toFixed(2)}.`,
    },
    {
      condition: "pullback_and_reclaim",
      passed: prior.low <= priorFastEma && last.close > emaFast,
      detail: `Prior low ${prior.low.toFixed(2)} vs EMA ${priorFastEma.toFixed(2)}; close ${last.close.toFixed(2)} reclaimed ${emaFast.toFixed(2)}.`,
    },
    {
      condition: "rsi_trend_zone",
      passed: currentRsi >= params.rsiMin && currentRsi <= params.rsiMax,
      detail: `RSI ${currentRsi.toFixed(1)} against zone ${params.rsiMin}-${params.rsiMax}.`,
    },
    {
      condition: "relative_volume",
      passed: rvol >= params.minRelativeVolume,
      detail: `RVOL ${rvol.toFixed(2)} against minimum ${params.minRelativeVolume}.`,
    },
    {
      condition: "volatility_regime",
      passed: atrPct >= params.minAtrPct && atrPct <= params.maxAtrPct,
      detail: `ATR ${(atrPct * 100).toFixed(3)}% of price against band ${(params.minAtrPct * 100).toFixed(2)}%-${(params.maxAtrPct * 100).toFixed(2)}%.`,
    },
    {
      condition: "not_extended",
      passed: currentAtr > 0 && (last.close - emaFast) / currentAtr <= params.maxExtensionAtr,
      detail: currentAtr > 0 ? `${((last.close - emaFast) / currentAtr).toFixed(2)} ATRs above EMA, limit ${params.maxExtensionAtr}.` : "ATR is zero.",
    },
    {
      condition: "body_quality",
      passed: range > 0 && body > 0 && body / range >= params.minBodyRatio,
      detail: range > 0 ? `Body ${Math.max(0, body / range).toFixed(2)} of range, minimum ${params.minBodyRatio}.` : "Zero-range bar.",
    },
    {
      condition: "cost_gate",
      passed: expectedMove >= roundTripCost * params.minCostCoverage,
      detail:
        `Expected move ${expectedMove.toFixed(4)} vs round-trip cost ${roundTripCost.toFixed(4)} × ${params.minCostCoverage}. ` +
        `Spread UNKNOWN (no bid/ask source); slippage assumed ${params.assumedSlippageBps}bps per side.`,
    },
  ];

  if (conditions.some((item) => !item.passed)) {
    return { kind: "no_setup", conditions, decisionBarTime: last.time };
  }

  // Sizing: risk a fixed budget against an ATR/structure stop, then cap by notional budget.
  const structuralStop = Math.min(...closed.slice(-5).map((bar) => bar.low));
  const advisoryStop = Math.min(structuralStop, last.close - params.stopAtr * currentAtr);
  const riskPerShare = last.close - advisoryStop;
  const riskBudget = context.equity * params.riskBudgetPct;
  const byRisk = Math.floor(riskBudget / riskPerShare);
  const byNotional = Math.floor((context.equity * params.positionBudgetPct) / last.close);
  const quantity = Math.max(0, Math.min(byRisk, byNotional));

  if (quantity === 0) {
    return {
      kind: "no_setup",
      conditions: [
        ...conditions,
        { condition: "position_sizing", passed: false, detail: `Risk budget ${riskBudget.toFixed(2)} cannot buy one share at ${riskPerShare.toFixed(2)} risk per share.` },
      ],
      decisionBarTime: last.time,
    };
  }

  const proposal: ScalpingProposal = {
    kind: "proposal",
    strategyId: STRATEGY_ID,
    instrumentId: context.instrumentId,
    side: "BUY",
    executable: false,
    confirmationRequired: true,
    decisionBarTime: last.time,
    referenceEntry: last.close,
    advisoryStop,
    advisoryTarget: last.close + params.targetR * riskPerShare,
    quantity,
    riskPerShare,
    riskAmount: quantity * riskPerShare,
    notional: quantity * last.close,
    estimatedRoundTripCost: roundTripCost,
    spreadKnown: false,
    assumedSlippageBps: params.assumedSlippageBps,
    conditions,
    issuedAt: now,
    expiresAt: now + params.proposalTtlSeconds,
  };
  return Object.freeze(proposal);
}
