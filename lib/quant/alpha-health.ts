import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { emit } from "@/lib/brain/event-bus";
import { forwardScorecard } from "@/lib/forward/shadow";
import { paperScorecard } from "@/lib/forward/paper";
import { assumptionFingerprint, type AssumptionFingerprint } from "./model-assumptions";

/**
 * The Alpha Health Monitor (mission phase D): detects edge decay across the ladder —
 * historical → shadow → paper — and decomposes what execution is costing.
 *
 * Doctrine:
 * - Alpha is fragile; nothing here assumes it lasts. Decay ratios are computed, never smoothed.
 * - TCA components the ledgers can MEASURE (fees, entry slippage) are measured; components the
 *   current data cannot support (market impact, timing, opportunity beyond the missed-trade
 *   proxy) are reported UNMEASURED with the reason — never estimated silently.
 * - The missed-trade cost is an ESTIMATE with a registered assumption record and a stated
 *   method; it is labelled as such everywhere it appears.
 * - CAPACITY_LIMITED and REGIME_BROKEN are emitted only when their inputs exist. Today they
 *   cannot be, and the monitor says so instead of guessing.
 */

export type AlphaHealthStatus =
  | "HEALTHY"
  | "DECAYING"
  | "EXECUTION_LIMITED"
  | "CAPACITY_LIMITED"
  | "REGIME_BROKEN"
  | "INSUFFICIENT_EVIDENCE";

export interface AlphaHealthInputs {
  /** Mean per-trade net return of the frozen historical baseline; null when no per-trade ledger. */
  historicalMeanNet: number | null;
  historicalTrades: number;
  shadowMeanNet: number | null;
  shadowResolved: number;
  shadowDrift: number | null;
  policyMinSignals: number;
  paper: {
    meanNetPerTrade: number | null;
    closedPositions: number;
    executedIntents: number;
    rejectedIntents: number;
    rejectReasons: Record<string, number>;
    feeReturnDrag: number | null;
    entrySlippageReturn: number | null;
  } | null;
}

export interface AlphaHealth {
  status: AlphaHealthStatus;
  reasons: string[];
  decay: {
    shadowVsHistorical: number | null;
    paperVsShadow: number | null;
  };
  tca: {
    measured: {
      feeReturnDrag: number | null;
      entrySlippageReturn: number | null;
    };
    estimated: {
      /** rejected intents × shadow mean net — the stated proxy, labelled ESTIMATED. */
      missedTradeCostReturn: number | null;
      method: string;
    };
    unmeasured: Record<string, string>;
  };
  evidence: {
    historicalTrades: number;
    shadowResolved: number;
    paperClosed: number;
  };
  assumptions: readonly AssumptionFingerprint[];
}

/** Ratio guard: a decay ratio only means something when the baseline edge was positive. */
function decayRatio(later: number | null, earlier: number | null): number | null {
  if (later === null || earlier === null || earlier <= 0) return null;
  return later / earlier;
}

export function computeAlphaHealth(inputs: AlphaHealthInputs): AlphaHealth {
  const reasons: string[] = [];
  const shadowVsHistorical = decayRatio(inputs.shadowMeanNet, inputs.historicalMeanNet);
  const paperVsShadow = decayRatio(inputs.paper?.meanNetPerTrade ?? null, inputs.shadowMeanNet);

  const missedTradeCostReturn =
    inputs.paper && inputs.shadowMeanNet !== null && inputs.paper.rejectedIntents > 0
      ? inputs.paper.rejectedIntents * inputs.shadowMeanNet
      : null;

  const unmeasured: Record<string, string> = {
    marketImpact: "No depth/participation data is wired; impact cannot be measured and is not guessed.",
    timingCost: "Decision-to-fill timing exists per order, but no benchmark price stream is wired to price it.",
    capacity: "Liquidity utilization needs traded-volume participation, which the paper ledger does not yet carry.",
    regimeStability: "No regime classifier is wired; regime breaks are not detectable yet.",
  };

  const evidence = {
    historicalTrades: inputs.historicalTrades,
    shadowResolved: inputs.shadowResolved,
    paperClosed: inputs.paper?.closedPositions ?? 0,
  };

  // Status ladder, most severe first, each with its stated reason.
  let status: AlphaHealthStatus;
  const minForJudgement = Math.max(5, Math.floor(inputs.policyMinSignals / 4));
  if (inputs.shadowResolved < minForJudgement) {
    status = "INSUFFICIENT_EVIDENCE";
    reasons.push(
      `${inputs.shadowResolved} resolved shadow signal(s); ${minForJudgement} (¼ of the predeclared policy) is the floor before decay is judged.`,
    );
  } else if (
    paperVsShadow !== null &&
    paperVsShadow < 0.5 &&
    (inputs.paper?.feeReturnDrag ?? 0) + Math.abs(inputs.paper?.entrySlippageReturn ?? 0) >
      Math.abs(inputs.shadowMeanNet ?? 0) / 2
  ) {
    status = "EXECUTION_LIMITED";
    reasons.push(
      "Paper keeps less than half of the shadow edge, and measured fees+slippage exceed half of that edge — the signal survives; the execution does not.",
    );
  } else if (shadowVsHistorical !== null && shadowVsHistorical < 0.5) {
    status = "DECAYING";
    reasons.push("Shadow retains less than half of the historical per-trade edge.");
  } else if (inputs.shadowDrift !== null && inputs.shadowDrift > 0.6) {
    status = "DECAYING";
    reasons.push(`Scorecard drift ${inputs.shadowDrift.toFixed(2)} exceeds the 0.6 policy ceiling.`);
  } else {
    status = "HEALTHY";
    reasons.push("Forward evidence tracks the frozen baseline within policy so far — a statement about the sample, not a promise.");
  }

  return {
    status,
    reasons,
    decay: { shadowVsHistorical, paperVsShadow },
    tca: {
      measured: {
        feeReturnDrag: inputs.paper?.feeReturnDrag ?? null,
        entrySlippageReturn: inputs.paper?.entrySlippageReturn ?? null,
      },
      estimated: {
        missedTradeCostReturn,
        method: "rejected_intents × shadow_mean_net (ESTIMATED — assumes rejected signals would have performed at the shadow mean)",
      },
      unmeasured,
    },
    evidence,
    assumptions: [assumptionFingerprint("missed_trade_cost_proxy")],
  };
}

/** Assemble Alpha Health for one challenger from the recorded ledgers. */
export function alphaHealthFor(challengerId: string): AlphaHealth | null {
  const shadow = forwardScorecard(challengerId);
  if (!shadow) return null;
  const paper = paperScorecard(challengerId);

  let paperInputs: AlphaHealthInputs["paper"] = null;
  if (paper) {
    const db = getDb();
    const outcomes = db
      .select()
      .from(schema.paperPositionOutcomes)
      .where(eq(schema.paperPositionOutcomes.challengerId, challengerId))
      .all();
    const perTradeReturns = outcomes.map((outcome) => outcome.netPnl / Math.max(1, outcome.entryPrice * outcome.quantity));
    const grossReturns = outcomes.map((outcome) => outcome.grossPnl / Math.max(1, outcome.entryPrice * outcome.quantity));
    const feeDrags = outcomes.map(
      (outcome, index) => grossReturns[index] - perTradeReturns[index],
    );

    const orders = db
      .select()
      .from(schema.paperForwardOrders)
      .where(eq(schema.paperForwardOrders.challengerId, challengerId))
      .all()
      .filter((order) => order.status === "FILLED" && order.fillPrice !== null);
    const slippages: number[] = [];
    for (const order of orders) {
      const intent = db.select().from(schema.executionIntents).where(eq(schema.executionIntents.id, order.intentId)).get();
      if (intent && intent.expectedPrice > 0) {
        slippages.push((order.fillPrice! - intent.expectedPrice) / intent.expectedPrice);
      }
    }
    const mean = (values: number[]) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null);

    paperInputs = {
      meanNetPerTrade: mean(perTradeReturns),
      closedPositions: outcomes.length,
      executedIntents: paper.executed,
      rejectedIntents: paper.rejected,
      rejectReasons: paper.rejectReasons,
      feeReturnDrag: mean(feeDrags),
      entrySlippageReturn: mean(slippages),
    };
  }

  const health = computeAlphaHealth({
    historicalMeanNet: shadow.baseline?.meanNetReturn ?? null,
    historicalTrades: shadow.baseline?.trades ?? 0,
    shadowMeanNet: shadow.meanNetReturn,
    shadowResolved: shadow.resolved,
    shadowDrift: shadow.driftScore,
    policyMinSignals: shadow.policy.minSignals,
    paper: paperInputs,
  });

  emit({ kind: "ALPHA_HEALTH_UPDATED", challengerId, status: health.status });

  return health;
}
