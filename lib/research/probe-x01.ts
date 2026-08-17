/**
 * X01 — the MAX / lottery effect in NSE equities, registered as a DIRECTION-NEUTRAL question.
 *
 * ## Why no prior sign
 *
 * The classic US MAX anomaly says high prior-month maximum daily return predicts subsequent
 * UNDERperformance. The Indian evidence does not agree with itself: a 2019 study over ~2,949
 * firms/month (2003-2017) found the opposite — high-MAX stocks OUTperformed, with no negative
 * MAX/future-return relation — while a 2024 study (2001-2021) finds MAX carries unique predictive
 * information without establishing that the classic sign holds.
 *
 * Registering a directional prior this evidence does not support would invite choosing the sign
 * after seeing the result, which is unfalsifiable. So the claim tested is that MAX carries
 * cross-sectional information about next-month returns, and **the spread is reported signed exactly
 * as written — HIGH_MAX minus LOW_MAX — whatever it turns out to be.**
 *
 * All three of these are legitimate outcomes:
 *
 * ```
 * HIGH - LOW > 0   the India-style positive relation, worth further investigation
 * HIGH - LOW < 0   the classic lottery-overpricing direction
 * HIGH - LOW ~ 0   no usable effect in this exploratory NSE sample
 * ```
 *
 * ## A limitation that cannot be modelled here
 *
 * NSE applies daily price bands of 2%, 5%, 10% or 20% to many equities (securities with derivatives
 * are treated differently). MAX is *literally the largest observed daily return*, so for a banded
 * stock it is **censored by exchange rule rather than by market outcome** — a stock that would have
 * returned 14% prints 10% and is ranked as though it had not been exceptional.
 *
 * This deployment holds no point-in-time historical band assignments, and inventing them would be
 * fabricating the very variable under test. So the censoring is declared, unmodelled, and is the
 * first robustness question if X01 turns out to be interesting.
 *
 * ## Reported three ways, after what M02 showed
 *
 * M02's long-only leg read +122 bps and looked tradeable while adding only +12.5 bps over its own
 * cohort — almost all of it market exposure. Both legs are therefore reported against the cohort as
 * well as against each other, so a leg cannot pass as selection when it is beta.
 */
import { createHash } from "node:crypto";
import {
  runCrossSectionalProbe,
  ERAS,
  type DailyBar,
  type ProbeSpec,
  type StatisticSummary,
} from "./cross-sectional-runner";

export const X01_CONTRACT = Object.freeze({
  hypothesisId: "X01",
  title: "MAX / lottery effect in NSE equities — direction registered as UNKNOWN",

  /** MAX is the maximum daily return over the prior trading month. */
  formationSessions: 21,
  holdingSessions: 21,
  rebalance: "MONTHLY" as const,

  /** Quintiles, predeclared once. Not swept across 5/10/20% after seeing the answer. */
  portfolioFraction: 0.20,

  /**
   * Liquidity conditioning, so the measurement is not dominated by names nobody can trade. Wider
   * than M02's top decile because MAX is defined on the whole cross-section in the literature.
   */
  liquidityCohortPct: 0.30,
  liquidityLookbackSessions: 20,
  liquidityProxy: "MEDIAN_RUPEE_TRADED_VALUE" as const,

  costBpsPerLeg: 38,
  minCohortSize: 20,

  priorDirection: "UNKNOWN" as const,
  /** The spread is reported signed as written. It is NOT reversed after observing the result. */
  spreadDefinition: "HIGH_MAX_MINUS_LOW_MAX" as const,

  evidenceMarket: "INDIA_BSE_AND_NSE_MIXED" as const,
  targetMarket: "NSE" as const,
  transferAssumption: "UNPROVEN" as const,
  replicationStatus: "NOT_A_DIRECT_REPLICATION" as const,
  priceBandCensoring: "KNOWN_UNMODELED_LIMITATION" as const,
  replicationGap:
    "NSE daily price bands (2/5/10/20%) censor the maximum observed daily return by exchange rule. " +
    "No point-in-time band assignments are held, so MAX here is the observed maximum, which for a " +
    "banded stock is not the same variable the literature measures.",

  rightsStatus: "EXPLORATORY_ONLY_UNDER_UNKNOWN_ACCESS_BASIS" as const,
  promotionForbidden: true,
  knownBias: "UNIVERSE_SELECTED_ON_RECENT_LIQUIDITY — survivorship bias present, direction unknown",
});

export const X01_CONTRACT_HASH = createHash("sha256")
  .update(JSON.stringify(X01_CONTRACT))
  .digest("hex")
  .slice(0, 16);

export type { DailyBar };
export { ERAS };

/** What X01 measures: the largest daily return inside the formation month. */
interface X01Features {
  max: number;
}

export interface X01Rebalance {
  date: string;
  cohortSize: number;
  /** Signed exactly as the contract declares: HIGH_MAX minus LOW_MAX. */
  spreadGross: number;
  highMaxGross: number;
  lowMaxGross: number;
  cohortGross: number;
}

export type X01Leg = StatisticSummary;

export interface X01Result {
  contractHash: string;
  rebalances: X01Rebalance[];
  spread: X01Leg;
  highVsCohort: X01Leg;
  lowVsCohort: X01Leg;
  byEra: { era: string; rebalances: number; spreadGrossBps: number }[];
  instrumentsSeen: number;
}

const SPEC: ProbeSpec<X01Features> = {
  contract: {
    lookbackSessions: X01_CONTRACT.formationSessions,
    holdingSessions: X01_CONTRACT.holdingSessions,
    liquidityCohortPct: X01_CONTRACT.liquidityCohortPct,
    liquidityLookbackSessions: X01_CONTRACT.liquidityLookbackSessions,
    minCohortSize: X01_CONTRACT.minCohortSize,
    costBpsPerLeg: X01_CONTRACT.costBpsPerLeg,
  },
  features({ back }) {
    // Session-indexed, so MAX is taken over the declared month rather than over whatever traded.
    let max = -Infinity;
    let observed = 0;
    // Inclusive of `formationSessions`: the original iterated sessions [at - 21 .. at] comparing
    // each against its predecessor, which is 22 daily returns, not 21.
    for (let n = 0; n <= X01_CONTRACT.formationSessions; n += 1) {
      const bar = back(n);
      const prev = back(n + 1);
      if (!bar || !prev || prev.close <= 0) continue;
      max = Math.max(max, bar.close / prev.close - 1);
      observed += 1;
    }
    if (observed < X01_CONTRACT.formationSessions / 2 || !Number.isFinite(max)) return null;
    return { max };
  },
  partition(cohort) {
    const ranked = [...cohort].sort((a, b) => b.features.max - a.features.max);
    const legSize = Math.max(1, Math.floor(ranked.length * X01_CONTRACT.portfolioFraction));
    return { highMax: ranked.slice(0, legSize), lowMax: ranked.slice(-legSize) };
  },
  statistics({ highMax, lowMax }, cohortReturn) {
    return {
      spread: highMax - lowMax,
      highVsCohort: highMax - cohortReturn,
      lowVsCohort: lowMax - cohortReturn,
    };
  },
  primaryStatistic: "spread",
  legsOf: (id) => (id === "spread" ? 2 : 1),
};

export function runX01Probe(
  universe: ReadonlyMap<string, readonly DailyBar[]>,
  eligibleAt: (instrumentId: string, date: string) => boolean,
): X01Result {
  const run = runCrossSectionalProbe(universe, eligibleAt, SPEC);
  const BPS = 10_000;
  return {
    contractHash: X01_CONTRACT_HASH,
    rebalances: run.rebalances.map((r) => ({
      date: r.date,
      cohortSize: r.cohortSize,
      spreadGross: r.statistics.spread!,
      highMaxGross: r.statistics.highVsCohort! + r.cohortReturn,
      lowMaxGross: r.statistics.lowVsCohort! + r.cohortReturn,
      cohortGross: r.cohortReturn,
    })),
    spread: run.summaries.spread!,
    highVsCohort: run.summaries.highVsCohort!,
    lowVsCohort: run.summaries.lowVsCohort!,
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
