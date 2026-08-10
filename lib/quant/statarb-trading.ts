import { createHash } from "node:crypto";
import { CostModelError, FEE_MODEL_ID, roundTripCost } from "@/lib/paper/cost-model";
import { recordAudit } from "@/lib/knowledge/repository";
import { snapshotFromStore } from "@/lib/research-data/snapshot";
import { COMPILER_VERSION } from "@/lib/strategy/dsl";
import { mean, standardDeviation } from "@/lib/strategy/statistics";
import { assumptionFingerprint, type AssumptionFingerprint } from "./model-assumptions";
import {
  COINTEGRATION_METHOD_STATUS,
  ENGLE_GRANGER_CRITICAL,
  adfStatistic,
  integrationOrderCheck,
  type IntegrationCheck,
} from "./statarb";

/**
 * Statistical arbitrage — TRADING stage with walk-forward (mission phase F.2).
 *
 * ## The rule this file exists to enforce
 *
 * **Nothing learned in a trading window may change the pair that was selected in its formation
 * window.** Formation selects and FREEZES (pair, hedge ratio, spread mean/σ, thresholds); the
 * trading window then only observes. Walk-forward repeats formation→trade forward in time; it
 * never inspects a trading window, finds a good pair, and pretends it had been chosen first.
 * The frozen parameters are hashed, and every trade cites that hash.
 *
 * ## What a pair costs in reality
 *
 * A pair is two trades, not one atomic trade. Each leg is priced separately through the
 * effective-dated fee engine, and the legs can fill differently — `hedgeError` records how far
 * the achieved ratio sat from the intended one, and unpriceable legs make the whole pair trade
 * economics-unavailable rather than silently free.
 *
 * ## India makes shortability a gate, not a footnote
 *
 * Cointegration NEVER produces execution eligibility. `assessPairMode` classifies the trade into
 * the four modes and refuses execution eligibility for anything whose short leg this deployment
 * cannot prove is borrowable.
 */

export type PairMode = "INTRADAY_MIS" | "OVERNIGHT_EQUITY_SLB" | "FUTURES" | "RESEARCH_ONLY";

export interface PairModeAssessment {
  mode: PairMode;
  /** Whether the pair may ever reach paper/promotion. Cointegration alone never sets this true. */
  executionEligible: boolean;
  reasons: string[];
}

/**
 * Classify a pair trade's executable mode.
 *
 * India: naked short selling is prohibited; a short leg held overnight needs borrow (NSE SLBS,
 * which mainly covers F&O-eligible securities). Intraday equity shorts under MIS are squared off
 * the same session and do not need SLB, so an intraday pair with a broker square-off profile is
 * the only equity mode this deployment can currently call execution-eligible. Everything else is
 * RESEARCH_ONLY until borrow availability is a verified input — a `false` here is a finding, not
 * a failure.
 */
export function assessPairMode(input: {
  resolution: string;
  hasSquareOffProfile: boolean;
  /** Verified borrow availability for the short leg. Absent/unknown ⇒ never assumed. */
  shortBorrowVerified?: boolean;
  instrumentsAreFutures?: boolean;
}): PairModeAssessment {
  const reasons: string[] = [];
  if (input.instrumentsAreFutures) {
    reasons.push(
      "Futures legs carry their own contract, margin and roll model, none of which this deployment holds yet.",
    );
    return { mode: "FUTURES", executionEligible: false, reasons };
  }
  const intraday = input.resolution !== "D";
  if (intraday) {
    if (!input.hasSquareOffProfile) {
      reasons.push("Intraday short requires a broker square-off profile; none resolved for this universe.");
      return { mode: "RESEARCH_ONLY", executionEligible: false, reasons };
    }
    reasons.push(
      "Intraday equity pair under MIS: the short leg is squared off within the session, so no SLB borrow is required.",
    );
    return { mode: "INTRADAY_MIS", executionEligible: true, reasons };
  }
  if (input.shortBorrowVerified === true) {
    reasons.push("Overnight equity pair with VERIFIED borrow availability for the short leg.");
    return { mode: "OVERNIGHT_EQUITY_SLB", executionEligible: true, reasons };
  }
  reasons.push(
    "Overnight equity short needs borrow (naked short selling is prohibited in India; NSE SLBS mainly covers " +
      "F&O-eligible securities). Borrow availability is not a verified input here, so this pair is research-only " +
      "however cointegrated it looks.",
  );
  return { mode: "OVERNIGHT_EQUITY_SLB", executionEligible: false, reasons };
}

/** Everything frozen at the end of a formation window. Hashed; trades cite the hash. */
export interface FrozenPair {
  a: string;
  b: string;
  hedgeRatio: number;
  spreadMean: number;
  spreadStd: number;
  halfLifeBars: number;
  entryZ: number;
  exitZ: number;
  stopZ: number;
  maxHoldBars: number;
  formationFirstIndex: number;
  formationLastIndex: number;
  cointegrationStatistic: number;
  integrationA: IntegrationCheck;
  integrationB: IntegrationCheck;
  parameterHash: string;
}

export interface PairTrade {
  parameterHash: string;
  a: string;
  b: string;
  side: "LONG_SPREAD" | "SHORT_SPREAD";
  entryIndex: number;
  entryTime: number;
  exitIndex: number;
  exitTime: number;
  exitReason: "mean_reversion" | "stop" | "timeout" | "window_end";
  entryZ: number;
  exitZ: number;
  /** Intended vs achieved hedge — a pair is two trades, and they can disagree. */
  intendedHedgeRatio: number;
  achievedHedgeRatio: number;
  hedgeError: number;
  legAReturn: number;
  legBReturn: number;
  grossReturn: number;
  costReturn: number | null;
  netReturn: number | null;
  economicsUnavailable?: string;
}

export interface WalkForwardFold {
  fold: number;
  formationBars: number;
  tradingBars: number;
  pairsFrozen: number;
  candidatesTested: number;
  trades: PairTrade[];
}

export interface StatArbWalkForwardManifest {
  method: string;
  cointegrationMethodStatus: string;
  cointegrationLabel: string;
  folds: number;
  formationBars: number;
  tradingBars: number;
  entryZ: number;
  exitZ: number;
  stopZ: number;
  maxHoldMultipleOfHalfLife: number;
  snapshotId: string;
  feeModelId: string;
  legNotional: number;
  pairMode: PairMode;
  executionEligible: boolean;
  pairModeReasons: string[];
  /** Total pair-candidates examined across ALL folds — the search history, not a survivor count. */
  candidatesTestedTotal: number;
  engineVersion: string;
  codeFingerprint: string;
  assumptionFingerprints: readonly AssumptionFingerprint[];
}

export interface StatArbWalkForwardResult {
  ok: true;
  runId: string;
  folds: WalkForwardFold[];
  trades: PairTrade[];
  summary: {
    trades: number;
    meanNetReturn: number | null;
    winRate: number | null;
    unpricedTrades: number;
    meanHedgeError: number | null;
  };
  manifest: StatArbWalkForwardManifest;
}

export type WalkForwardRefusal = {
  ok: false;
  code: "NO_STORED_DATA" | "TOO_FEW_INSTRUMENTS" | "WINDOW_TOO_SHORT";
  message: string;
};

function ols(y: readonly number[], x: readonly number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < x.length; index += 1) {
    covariance += (x[index] - mx) * (y[index] - my);
    variance += (x[index] - mx) ** 2;
  }
  return variance > 0 ? covariance / variance : 0;
}

function halfLifeOf(spread: readonly number[]): number | null {
  const phi = ols(spread.slice(1), spread.slice(0, -1));
  if (!(phi > 0 && phi < 1)) return null;
  return Math.log(2) / -Math.log(phi);
}

/**
 * Formation over ONE window: select and freeze. Reads nothing outside [from, to).
 */
function freezePairs(
  dataset: Readonly<Record<string, readonly { time: number; close: number }[]>>,
  instruments: readonly string[],
  from: number,
  to: number,
  thresholds: { entryZ: number; exitZ: number; stopZ: number; maxHoldMultiple: number },
  maxPairs: number,
): { frozen: FrozenPair[]; candidatesTested: number } {
  const frozen: FrozenPair[] = [];
  let candidatesTested = 0;

  outer: for (let i = 0; i < instruments.length; i += 1) {
    for (let j = i + 1; j < instruments.length; j += 1) {
      if (candidatesTested >= maxPairs) break outer;
      candidatesTested += 1;

      const a = dataset[instruments[i]].slice(from, to).map((bar) => bar.close);
      const b = dataset[instruments[j]].slice(from, to).map((bar) => bar.close);
      if (a.length !== b.length || a.length < 60) continue;

      const integrationA = integrationOrderCheck(a);
      const integrationB = integrationOrderCheck(b);
      if (!integrationA.isI1 || !integrationB.isI1) continue;

      const hedgeRatio = ols(a, b);
      const spread = a.map((value, index) => value - hedgeRatio * b[index]);
      const statistic = adfStatistic(spread);
      if (statistic === null || statistic >= ENGLE_GRANGER_CRITICAL.p05) continue;

      const halfLife = halfLifeOf(spread);
      if (halfLife === null || halfLife <= 0 || halfLife > (to - from) / 4) continue;

      const spreadMean = mean(spread);
      const spreadStd = standardDeviation(spread);
      if (!(spreadStd > 0)) continue;

      const parameterHash = createHash("sha256")
        .update(
          `${instruments[i]}|${instruments[j]}|${hedgeRatio}|${spreadMean}|${spreadStd}|${from}|${to}|${thresholds.entryZ}|${thresholds.exitZ}|${thresholds.stopZ}`,
        )
        .digest("hex")
        .slice(0, 16);

      frozen.push({
        a: instruments[i],
        b: instruments[j],
        hedgeRatio,
        spreadMean,
        spreadStd,
        halfLifeBars: halfLife,
        entryZ: thresholds.entryZ,
        exitZ: thresholds.exitZ,
        stopZ: thresholds.stopZ,
        maxHoldBars: Math.max(2, Math.ceil(halfLife * thresholds.maxHoldMultiple)),
        formationFirstIndex: from,
        formationLastIndex: to - 1,
        cointegrationStatistic: statistic,
        integrationA,
        integrationB,
        parameterHash,
      });
    }
  }
  return { frozen, candidatesTested };
}

/**
 * Trade ONE frozen pair across a window that begins strictly after its formation window ends.
 * Every z-score uses the FROZEN mean and σ — recomputing them from trading data would leak the
 * very information the split exists to withhold.
 */
function tradeFrozenPair(
  pair: FrozenPair,
  dataset: Readonly<Record<string, readonly { time: number; close: number }[]>>,
  from: number,
  to: number,
  legNotional: number,
  market: "US" | "IN",
  intraday: boolean,
): PairTrade[] {
  const barsA = dataset[pair.a];
  const barsB = dataset[pair.b];
  const trades: PairTrade[] = [];
  let open: { index: number; side: "LONG_SPREAD" | "SHORT_SPREAD"; z: number } | null = null;

  const zAt = (index: number) =>
    (barsA[index].close - pair.hedgeRatio * barsB[index].close - pair.spreadMean) / pair.spreadStd;

  for (let index = from; index < to; index += 1) {
    const z = zAt(index);
    if (open === null) {
      if (z <= -pair.entryZ) open = { index, side: "LONG_SPREAD", z };
      else if (z >= pair.entryZ) open = { index, side: "SHORT_SPREAD", z };
      continue;
    }

    const held = index - open.index;
    const reverted = open.side === "LONG_SPREAD" ? z >= -pair.exitZ : z <= pair.exitZ;
    const stopped = open.side === "LONG_SPREAD" ? z <= -pair.stopZ : z >= pair.stopZ;
    const lastBar = index === to - 1;
    if (!reverted && !stopped && held < pair.maxHoldBars && !lastBar) continue;

    const exitReason: PairTrade["exitReason"] = stopped
      ? "stop"
      : reverted
        ? "mean_reversion"
        : held >= pair.maxHoldBars
          ? "timeout"
          : "window_end";

    // Two legs, priced separately. LONG_SPREAD = long A, short B (and the reverse).
    const entryA = barsA[open.index].close;
    const exitA = barsA[index].close;
    const entryB = barsB[open.index].close;
    const exitB = barsB[index].close;
    const direction = open.side === "LONG_SPREAD" ? 1 : -1;
    const legAReturn = direction * ((exitA - entryA) / entryA);
    const legBReturn = -direction * ((exitB - entryB) / entryB);

    // Achieved hedge ratio: notional-matched legs at entry prices. Whole-share quantities mean
    // the achieved ratio is rarely the intended one — that error is recorded, never assumed away.
    const quantityA = Math.max(1, Math.floor(legNotional / entryA));
    const quantityB = Math.max(1, Math.floor((legNotional * Math.abs(pair.hedgeRatio)) / entryB));
    const achievedHedgeRatio = (quantityB * entryB) / (quantityA * entryA);
    const intendedHedgeRatio = Math.abs(pair.hedgeRatio) * (entryB > 0 ? 1 : 1);

    const grossReturn = (legAReturn + legBReturn) / 2;

    let costReturn: number | null = null;
    let economicsUnavailable: string | undefined;
    try {
      const product = intraday ? "INTRADAY" : "DELIVERY";
      const at = new Date(barsA[open.index].time * 1000);
      const legACost = roundTripCost({ market, notional: quantityA * entryA, product, at });
      const legBCost = roundTripCost({ market, notional: quantityB * entryB, product, at });
      const totalNotional = quantityA * entryA + quantityB * entryB;
      costReturn = (legACost.total + legBCost.total) / totalNotional;
    } catch (caught) {
      if (caught instanceof CostModelError) economicsUnavailable = caught.message;
      else throw caught;
    }

    trades.push({
      parameterHash: pair.parameterHash,
      a: pair.a,
      b: pair.b,
      side: open.side,
      entryIndex: open.index,
      entryTime: barsA[open.index].time,
      exitIndex: index,
      exitTime: barsA[index].time,
      exitReason,
      entryZ: open.z,
      exitZ: z,
      intendedHedgeRatio,
      achievedHedgeRatio,
      hedgeError: achievedHedgeRatio - intendedHedgeRatio,
      legAReturn,
      legBReturn,
      grossReturn,
      costReturn,
      netReturn: costReturn === null ? null : grossReturn - costReturn,
      economicsUnavailable,
    });
    open = null;
  }
  return trades;
}

/**
 * Walk-forward statistical arbitrage: repeated formation→trade, strictly forward in time.
 */
export function runStatArbWalkForward(options: {
  market: "NSE" | "US" | "BSE";
  resolution: string;
  formationBars?: number;
  tradingBars?: number;
  entryZ?: number;
  exitZ?: number;
  stopZ?: number;
  maxHoldMultiple?: number;
  maxPairsPerFold?: number;
  legNotional?: number;
  hasSquareOffProfile?: boolean;
  shortBorrowVerified?: boolean;
  actor?: string;
}): StatArbWalkForwardResult | WalkForwardRefusal {
  const formationBars = options.formationBars ?? 150;
  const tradingBars = options.tradingBars ?? 60;
  const entryZ = options.entryZ ?? 2;
  const exitZ = options.exitZ ?? 0.5;
  const stopZ = options.stopZ ?? 4;
  const maxHoldMultiple = options.maxHoldMultiple ?? 3;
  const maxPairsPerFold = options.maxPairsPerFold ?? 200;
  const legNotional = options.legNotional ?? 10_000;

  const snapshot = snapshotFromStore(options.market, options.resolution, "statarb-walkforward");
  if (!snapshot.ok) return { ok: false, code: "NO_STORED_DATA", message: snapshot.message };

  const instruments = snapshot.instruments.filter(
    (id) => (snapshot.dataset[id]?.length ?? 0) >= formationBars + tradingBars,
  );
  if (instruments.length < 2) {
    return {
      ok: false,
      code: "TOO_FEW_INSTRUMENTS",
      message: `${instruments.length} instrument(s) with ≥${formationBars + tradingBars} bars. A pair needs two, and a walk-forward needs both windows.`,
    };
  }

  const barCount = Math.min(...instruments.map((id) => snapshot.dataset[id].length));
  if (barCount < formationBars + tradingBars) {
    return {
      ok: false,
      code: "WINDOW_TOO_SHORT",
      message: `${barCount} common bars; formation (${formationBars}) + trading (${tradingBars}) needs more. Shortening the windows to fit is how out-of-sample stops being out of sample.`,
    };
  }

  const intraday = options.resolution !== "D";
  const pairMode = assessPairMode({
    resolution: options.resolution,
    hasSquareOffProfile: options.hasSquareOffProfile ?? intraday,
    shortBorrowVerified: options.shortBorrowVerified,
  });

  const dataset = snapshot.dataset as Readonly<Record<string, readonly { time: number; close: number }[]>>;
  const folds: WalkForwardFold[] = [];
  const allTrades: PairTrade[] = [];
  let candidatesTestedTotal = 0;
  let fold = 0;

  for (let start = 0; start + formationBars + tradingBars <= barCount; start += tradingBars) {
    fold += 1;
    const formationEnd = start + formationBars;
    const tradingEnd = formationEnd + tradingBars;
    const { frozen, candidatesTested } = freezePairs(
      dataset,
      instruments,
      start,
      formationEnd,
      { entryZ, exitZ, stopZ, maxHoldMultiple },
      maxPairsPerFold,
    );
    candidatesTestedTotal += candidatesTested;

    const foldTrades: PairTrade[] = [];
    for (const pair of frozen) {
      // Trading begins strictly AFTER the formation window's last bar.
      foldTrades.push(
        ...tradeFrozenPair(pair, dataset, formationEnd, tradingEnd, legNotional, options.market === "US" ? "US" : "IN", intraday),
      );
    }
    allTrades.push(...foldTrades);
    folds.push({ fold, formationBars, tradingBars, pairsFrozen: frozen.length, candidatesTested, trades: foldTrades });
  }

  const priced = allTrades.filter((trade) => trade.netReturn !== null);
  const nets = priced.map((trade) => trade.netReturn as number);
  const hedgeErrors = allTrades.map((trade) => Math.abs(trade.hedgeError));

  const manifest: StatArbWalkForwardManifest = {
    method: "walk_forward_formation_trading_split",
    cointegrationMethodStatus: COINTEGRATION_METHOD_STATUS.methodStatus,
    cointegrationLabel: COINTEGRATION_METHOD_STATUS.label,
    folds: folds.length,
    formationBars,
    tradingBars,
    entryZ,
    exitZ,
    stopZ,
    maxHoldMultipleOfHalfLife: maxHoldMultiple,
    snapshotId: snapshot.snapshotId,
    feeModelId: FEE_MODEL_ID,
    legNotional,
    pairMode: pairMode.mode,
    executionEligible: pairMode.executionEligible,
    pairModeReasons: pairMode.reasons,
    candidatesTestedTotal,
    engineVersion: COMPILER_VERSION,
    codeFingerprint: "marketpulse-statarb-trading@1.0",
    assumptionFingerprints: [
      assumptionFingerprint("engle_granger_adf"),
      assumptionFingerprint("ou_process"),
    ],
  };

  const runId = `sawf_${createHash("sha256")
    .update(`${snapshot.snapshotId}|${formationBars}|${tradingBars}|${entryZ}|${exitZ}|${stopZ}|${candidatesTestedTotal}`)
    .digest("hex")
    .slice(0, 16)}`;

  recordAudit({
    actor: options.actor ?? "statarb",
    action: "statarb_walkforward",
    decision: "allowed",
    detail: JSON.stringify({
      runId,
      folds: folds.map((entry) => ({ fold: entry.fold, pairsFrozen: entry.pairsFrozen, candidatesTested: entry.candidatesTested, trades: entry.trades.length })),
      tradeCount: allTrades.length,
      manifest,
    }),
  });

  return {
    ok: true,
    runId,
    folds,
    trades: allTrades,
    summary: {
      trades: allTrades.length,
      meanNetReturn: nets.length > 0 ? mean(nets) : null,
      winRate: nets.length > 0 ? nets.filter((value) => value > 0).length / nets.length : null,
      unpricedTrades: allTrades.length - priced.length,
      meanHedgeError: hedgeErrors.length > 0 ? mean(hedgeErrors) : null,
    },
    manifest,
  };
}
