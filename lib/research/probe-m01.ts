/**
 * M01 — liquidity-conditioned momentum, 3-month formation / 1-month hold.
 *
 * ## Why this is a different hypothesis and not M02 retuned
 *
 * M02 tested a 6-month formation window and its factor spread came back negative. M01 was
 * registered **before** that result, in the same batch, as a distinct claim about how long
 * information takes to diffuse. Running it now is legitimate only because nothing about it moves in
 * response to M02: same liquidity cohort, same quintiles, same costs, same benchmark, same
 * inference. Exactly one parameter differs, and it is the one the hypothesis is about.
 *
 * M02's own contract recorded that its holding horizon was "held fixed against M01 deliberately, so
 * the comparison isolates formation length rather than confounding it with turnover". This honours
 * that.
 *
 * ## The prior is now LOWER, and that must not touch the implementation
 *
 * The Indian evidence reports intermediate (J=6) and long-term momentum more robustly than
 * short-term (J=1, J=3), and M02 already failed at the horizon the evidence favours most. So the
 * honest expectation for M01 is worse than it was this morning. That belief belongs in the write-up
 * and nowhere near the code — a probe that quietly softens because its author expects failure is as
 * corrupt as one that hardens because its author expects success.
 *
 * ## Not evidence
 *
 * Runs on the 358-name cohort obtained under `EXPLORATORY_ONLY_UNDER_UNKNOWN_ACCESS_BASIS`, which
 * is permanently `DISCOVERY_DATA`. Validation, trial, holdout, forward and paper all stay false.
 */
import { createHash } from "node:crypto";
import {
  runCrossSectionalProbe,
  ERAS,
  type DailyBar,
  type ProbeSpec,
  type StatisticSummary,
} from "./cross-sectional-runner";

export const M01_CONTRACT = Object.freeze({
  hypothesisId: "M01",
  title: "Liquidity-conditioned intermediate momentum, 3m formation / 1m hold (NSE, exploratory)",

  /** ~3 trading months. THE ONLY FIELD THAT DIFFERS FROM M02. */
  formationSessions: 63,
  holdingSessions: 21,
  skipSessions: 0,
  rebalance: "MONTHLY" as const,

  liquidityCohortPct: 0.10,
  liquidityLookbackSessions: 20,
  liquidityProxy: "MEDIAN_RUPEE_TRADED_VALUE" as const,
  portfolioFraction: 0.20,
  costBpsPerLeg: 38,
  minCohortSize: 20,

  priorDirection: "POSITIVE" as const,
  primaryStatistic: "longShort" as const,

  evidenceMarket: "INDIA_BSE" as const,
  targetMarket: "NSE" as const,
  transferAssumption: "UNPROVEN" as const,
  replicationStatus: "NOT_A_DIRECT_REPLICATION" as const,
  replicationGap:
    "Source conditions on turnover ratio (shares traded / shares outstanding). No point-in-time " +
    "shares-outstanding history exists here, so rupee traded value is substituted.",

  relatedHypotheses: Object.freeze(["M02"]),
  /** Same mechanism as M02, different diffusion window. Not independent corroboration of anything. */
  independentOfRelated: false,

  rightsStatus: "EXPLORATORY_ONLY_UNDER_UNKNOWN_ACCESS_BASIS" as const,
  promotionForbidden: true,
  knownBias: "UNIVERSE_SELECTED_ON_RECENT_LIQUIDITY — survivorship bias present, direction unknown",
});

export const M01_CONTRACT_HASH = createHash("sha256")
  .update(JSON.stringify(M01_CONTRACT))
  .digest("hex")
  .slice(0, 16);

export type { DailyBar };
export { ERAS };

interface M01Features {
  formationReturn: number;
}

export type LegStatistics = StatisticSummary;

export interface M01Result {
  contractHash: string;
  rebalances: { date: string; cohortSize: number; longShortGross: number; longOnlyGross: number; cohortGross: number }[];
  longShort: LegStatistics;
  longOnly: LegStatistics;
  /** Winners in excess of their own cohort — the measure that caught M02's beta trap. */
  longVsCohort: LegStatistics;
  /** Losers in excess of cohort, so a spread cannot hide which leg produced it. */
  shortVsCohort: LegStatistics;
  byEra: { era: string; rebalances: number; longShortGrossBps: number; longOnlyGrossBps: number }[];
  instrumentsSeen: number;
}

const SPEC: ProbeSpec<M01Features> = {
  contract: {
    lookbackSessions: M01_CONTRACT.formationSessions + M01_CONTRACT.skipSessions,
    holdingSessions: M01_CONTRACT.holdingSessions,
    liquidityCohortPct: M01_CONTRACT.liquidityCohortPct,
    liquidityLookbackSessions: M01_CONTRACT.liquidityLookbackSessions,
    minCohortSize: M01_CONTRACT.minCohortSize,
    costBpsPerLeg: M01_CONTRACT.costBpsPerLeg,
  },
  features({ back, at }) {
    // The bar at EXACTLY this session. A nearer substitute would measure a shorter window than the
    // contract declares — the defect that changed M02 from 221 to 226 rebalances during extraction.
    const past = back(M01_CONTRACT.formationSessions + M01_CONTRACT.skipSessions);
    if (!past || past.close <= 0) return null;
    return { formationReturn: at.close / past.close - 1 };
  },
  partition(cohort) {
    const ranked = [...cohort].sort((a, b) => b.features.formationReturn - a.features.formationReturn);
    const legSize = Math.max(1, Math.floor(ranked.length * M01_CONTRACT.portfolioFraction));
    return { winners: ranked.slice(0, legSize), losers: ranked.slice(-legSize) };
  },
  statistics({ winners, losers }, cohortReturn) {
    return {
      longShort: winners - losers,
      longOnly: winners,
      longVsCohort: winners - cohortReturn,
      shortVsCohort: losers - cohortReturn,
    };
  },
  primaryStatistic: "longShort",
  legsOf: (id) => (id === "longShort" ? 2 : 1),
};

export function runM01Probe(
  universe: ReadonlyMap<string, readonly DailyBar[]>,
  eligibleAt: (instrumentId: string, date: string) => boolean,
): M01Result {
  const run = runCrossSectionalProbe(universe, eligibleAt, SPEC);
  const BPS = 10_000;
  return {
    contractHash: M01_CONTRACT_HASH,
    rebalances: run.rebalances.map((r) => ({
      date: r.date,
      cohortSize: r.cohortSize,
      longShortGross: r.statistics.longShort!,
      longOnlyGross: r.statistics.longOnly!,
      cohortGross: r.cohortReturn,
    })),
    longShort: run.summaries.longShort!,
    longOnly: run.summaries.longOnly!,
    longVsCohort: run.summaries.longVsCohort!,
    shortVsCohort: run.summaries.shortVsCohort!,
    byEra: ERAS.map((era) => {
      const inEra = run.rebalances.filter((r) => r.date >= era.from && r.date <= era.to);
      const avg = (pick: (x: (typeof inEra)[number]) => number) =>
        inEra.length ? (inEra.reduce((s, x) => s + pick(x), 0) / inEra.length) * BPS : 0;
      return {
        era: era.name,
        rebalances: inEra.length,
        longShortGrossBps: avg((r) => r.statistics.longShort!),
        longOnlyGrossBps: avg((r) => r.statistics.longOnly!),
      };
    }),
    instrumentsSeen: run.instrumentsSeen,
  };
}
