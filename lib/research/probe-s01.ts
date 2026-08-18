/**
 * S01 — higher-moment skewness, and NOT independent corroboration of X01.
 *
 * ## The relationship that has to be declared first
 *
 * S01 and X01 test two observables inside ONE mechanism. The Indian lottery-factor evidence treats
 * MAX, skewness, tail risk and idiosyncratic volatility as related characteristics of the same
 * lottery-stock behaviour, so a matching S01 result means:
 *
 * > two observables within a related lottery/higher-moment mechanism show a similar pattern
 *
 * and never:
 *
 * > two independent mechanisms confirmed the effect
 *
 * That distinction is recorded in the contract as `mechanismFamily` and `relatedHypotheses` so a
 * future reader — or a future agent counting evidence — cannot treat X01 and S01 as two votes.
 *
 * ## Direction
 *
 * Registered `UNKNOWN`, like X01. The 2021 Indian higher-moments study reports a positive
 * skewness/return relation while the classical lottery account predicts the opposite; the spread is
 * reported signed exactly as declared, HIGH_SKEW minus LOW_SKEW, and is not reversed afterwards.
 *
 * ## The falsification that matters most
 *
 * If the effect disappears once MAX is controlled for, S01 is X01 wearing a different statistic and
 * must be dropped rather than counted. That check is built into the reported statistics: the
 * high-skew leg is also measured with its MAX-extreme members removed.
 */
import { createHash } from "node:crypto";
import {
  runCrossSectionalProbe,
  ERAS,
  type DailyBar,
  type ProbeSpec,
  type StatisticSummary,
} from "./cross-sectional-runner";

export const S01_CONTRACT = Object.freeze({
  hypothesisId: "S01",
  title: "Higher-moment skewness in NSE equities — direction registered as UNKNOWN",

  /** Skewness is a third moment; short windows measure noise rather than distributional shape. */
  formationSessions: 252,
  holdingSessions: 21,
  rebalance: "MONTHLY" as const,

  portfolioFraction: 0.20,
  liquidityCohortPct: 0.30,
  liquidityLookbackSessions: 20,
  liquidityProxy: "MEDIAN_RUPEE_TRADED_VALUE" as const,

  costBpsPerLeg: 38,
  minCohortSize: 30,
  /** Below this many returns a skewness estimate is not worth computing. */
  minReturnsForSkew: 150,

  priorDirection: "UNKNOWN" as const,
  spreadDefinition: "HIGH_SKEW_MINUS_LOW_SKEW" as const,
  primaryStatistic: "spread" as const,

  /** NOT an independent mechanism from X01. Declared so nobody can count them as two votes. */
  mechanismFamily: "LOTTERY_PREFERENCE_AND_HIGHER_MOMENTS" as const,
  relatedHypotheses: Object.freeze(["X01"]),
  independentOfRelated: false,

  evidenceMarket: "INDIA_BSE_AND_NSE_MIXED" as const,
  targetMarket: "NSE" as const,
  transferAssumption: "UNPROVEN" as const,
  replicationStatus: "NOT_A_DIRECT_REPLICATION" as const,
  rightsStatus: "EXPLORATORY_ONLY_UNDER_UNKNOWN_ACCESS_BASIS" as const,
  promotionForbidden: true,
  knownBias: "UNIVERSE_SELECTED_ON_RECENT_LIQUIDITY — survivorship bias present, direction unknown",
});

export const S01_CONTRACT_HASH = createHash("sha256")
  .update(JSON.stringify(S01_CONTRACT))
  .digest("hex")
  .slice(0, 16);

export type { DailyBar };
export { ERAS };

interface S01Features {
  skew: number;
  /** Carried so the high-skew leg can be re-measured with its MAX-extreme members removed. */
  max: number;
}

export type S01Leg = StatisticSummary;

export interface S01Result {
  contractHash: string;
  rebalances: { date: string; cohortSize: number; spread: number }[];
  spread: S01Leg;
  highVsCohort: S01Leg;
  lowVsCohort: S01Leg;
  /** The decisive test: does anything survive once MAX is stripped out of the high-skew leg? */
  highExMaxVsCohort: S01Leg;
  byEra: { era: string; rebalances: number; spreadGrossBps: number }[];
  instrumentsSeen: number;
}

/** Sample skewness of a return series. */
function skewness(returns: readonly number[]): number {
  const n = returns.length;
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  let m2 = 0;
  let m3 = 0;
  for (const r of returns) {
    const d = r - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  return m2 <= 0 ? 0 : m3 / Math.pow(m2, 1.5);
}

const SPEC: ProbeSpec<S01Features> = {
  contract: {
    lookbackSessions: S01_CONTRACT.formationSessions,
    holdingSessions: S01_CONTRACT.holdingSessions,
    liquidityCohortPct: S01_CONTRACT.liquidityCohortPct,
    liquidityLookbackSessions: S01_CONTRACT.liquidityLookbackSessions,
    minCohortSize: S01_CONTRACT.minCohortSize,
    costBpsPerLeg: S01_CONTRACT.costBpsPerLeg,
  },
  features({ back }) {
    const returns: number[] = [];
    let max = -Infinity;
    for (let n = 0; n < S01_CONTRACT.formationSessions; n += 1) {
      const bar = back(n);
      const prev = back(n + 1);
      if (!bar || !prev || prev.close <= 0) continue;
      const r = bar.close / prev.close - 1;
      returns.push(r);
      if (n < 21) max = Math.max(max, r); // MAX over the most recent month, as X01 defines it
    }
    if (returns.length < S01_CONTRACT.minReturnsForSkew || !Number.isFinite(max)) return null;
    return { skew: skewness(returns), max };
  },
  partition(cohort) {
    const ranked = [...cohort].sort((a, b) => b.features.skew - a.features.skew);
    const legSize = Math.max(1, Math.floor(ranked.length * S01_CONTRACT.portfolioFraction));
    const highSkew = ranked.slice(0, legSize);
    const lowSkew = ranked.slice(-legSize);

    // The high-skew leg with its MAX-extreme members removed. If S01 is only X01 in disguise, this
    // group is where it shows: strip the lottery-day names and nothing should remain.
    const maxCut = [...cohort].sort((a, b) => b.features.max - a.features.max);
    const extreme = new Set(maxCut.slice(0, legSize).map((c) => c.id));
    const highExMax = highSkew.filter((c) => !extreme.has(c.id));

    return { highSkew, lowSkew, highExMax };
  },
  statistics({ highSkew, lowSkew, highExMax }, cohortReturn) {
    return {
      spread: highSkew - lowSkew,
      highVsCohort: highSkew - cohortReturn,
      lowVsCohort: lowSkew - cohortReturn,
      highExMaxVsCohort: highExMax - cohortReturn,
    };
  },
  primaryStatistic: "spread",
  legsOf: (id) => (id === "spread" ? 2 : 1),
};

export function runS01Probe(
  universe: ReadonlyMap<string, readonly DailyBar[]>,
  eligibleAt: (instrumentId: string, date: string) => boolean,
): S01Result {
  const run = runCrossSectionalProbe(universe, eligibleAt, SPEC);
  const BPS = 10_000;
  return {
    contractHash: S01_CONTRACT_HASH,
    rebalances: run.rebalances.map((r) => ({
      date: r.date,
      cohortSize: r.cohortSize,
      spread: r.statistics.spread!,
    })),
    spread: run.summaries.spread!,
    highVsCohort: run.summaries.highVsCohort!,
    lowVsCohort: run.summaries.lowVsCohort!,
    highExMaxVsCohort: run.summaries.highExMaxVsCohort!,
    byEra: ERAS.map((era) => {
      const inEra = run.rebalances.filter((r) => r.date >= era.from && r.date <= era.to);
      return {
        era: era.name,
        rebalances: inEra.length,
        spreadGrossBps: inEra.length
          ? (inEra.reduce((s, r) => s + r.statistics.spread!, 0) / inEra.length) * BPS
          : 0,
      };
    }),
    instrumentsSeen: run.instrumentsSeen,
  };
}
