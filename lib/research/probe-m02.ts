/**
 * M02 — the first canonical exploratory probe.
 *
 * Liquidity-conditioned intermediate momentum: 6-month formation, 1-month hold, monthly rebalance,
 * on the most liquid cohort of NSE equities.
 *
 * ## Why M02 before M01
 *
 * Owner correction 2026-08-17, from the external evidence rather than from any MarketPulse result.
 * The Indian study defines short-term formation as J=1 and J=3, intermediate as J=6, long as
 * J=9/12, and reports only LIMITED short-term momentum across its full universe while intermediate
 * and long-term momentum are much more robust. Choosing J=6 first is picking the experiment the
 * evidence points at — done before seeing any output, which is what separates it from tuning.
 *
 * ## THE CONTRACT IS FROZEN BEFORE THE FIRST RESULT
 *
 * Every parameter below is predeclared and hashed. The single most important one is the liquidity
 * bucket: running top-10/20/25/33/50% and reporting whichever wins is selection, and it would
 * invalidate the probe no matter how the numbers came out. One rule, chosen once, from the
 * literature's shape.
 *
 * ## What this is NOT
 *
 * **Not a replication.** The source study conditions on TURNOVER RATIO — shares traded over shares
 * outstanding. This deployment holds no point-in-time shares-outstanding history, so the proxy here
 * is rupee traded value, which is a different variable measuring a related thing. A large, cheap
 * stock and a small, expensive one with identical turnover ratios rank differently under it.
 *
 * **Not the same market.** The source evidence is BSE-listed equities; this runs on NSE. Whether
 * the finding transfers is the question, not the premise.
 *
 * **Not evidence.** The cohort with deep history was obtained under
 * `EXPLORATORY_ONLY_UNDER_UNKNOWN_ACCESS_BASIS`, so no result here may reach validation, a trial,
 * the holdout, forward or paper. It can answer exactly one question: is this interesting enough to
 * justify obtaining an authenticated data basis?
 *
 * ## And a bias that would block promotion on its own
 *
 * The deep cohort was selected by *recent* traded value — it is the set of names liquid in
 * 2025-2026. Every instrument that delisted, collapsed or fell out of liquidity before then is
 * absent. For a momentum study run back to 2000 that is **survivorship bias in the universe
 * itself**, and it biases toward finding an effect. It is declared here rather than discovered in
 * review, and it is a data problem no statistic in this module can repair.
 */
import { createHash } from "node:crypto";
import {
  runCrossSectionalProbe,
  ERAS,
  type DailyBar,
  type ProbeSpec,
  type StatisticSummary,
} from "./cross-sectional-runner";

export const M02_CONTRACT = Object.freeze({
  hypothesisId: "M02",
  title: "Liquidity-conditioned intermediate momentum, 6m formation / 1m hold (NSE, exploratory)",

  formationSessions: 126, // ~6 trading months
  holdingSessions: 21, // ~1 trading month
  skipSessions: 0, // predeclared: no skip, so the claim is about raw 6m formation
  rebalance: "MONTHLY" as const,

  /**
   * Predeclared and never swept. The source study's strongest effects sit in its most liquid /
   * highest-turnover portfolios, including top-decile turnover results.
   */
  liquidityCohortPct: 0.10,
  liquidityLookbackSessions: 20,
  liquidityProxy: "MEDIAN_RUPEE_TRADED_VALUE" as const,

  /** Winner and loser legs. Quintiles of the conditioned cohort, chosen once. */
  portfolioFraction: 0.20,

  /** Round-trip delivery friction per leg per rebalance, from this system's measured cost model. */
  costBpsPerLeg: 38,

  minCohortSize: 20,

  // Provenance, stated at the granularity the naming rule requires.
  evidenceMarket: "INDIA_BSE" as const,
  targetMarket: "NSE" as const,
  transferAssumption: "UNPROVEN" as const,
  replicationStatus: "NOT_A_DIRECT_REPLICATION" as const,
  replicationGap:
    "Source conditions on turnover ratio (shares traded / shares outstanding). No point-in-time " +
    "shares-outstanding history exists here, so rupee traded value is substituted.",

  rightsStatus: "EXPLORATORY_ONLY_UNDER_UNKNOWN_ACCESS_BASIS" as const,
  promotionForbidden: true,
  knownBias: "UNIVERSE_SELECTED_ON_RECENT_LIQUIDITY — survivorship bias present",
});

/** Hash over the frozen contract, so a changed parameter cannot masquerade as the same probe. */
export const M02_CONTRACT_HASH = createHash("sha256")
  .update(JSON.stringify(M02_CONTRACT))
  .digest("hex")
  .slice(0, 16);


export type { DailyBar };
export { ERAS };

/** What M02 measures about each instrument, from the formation window only. */
interface M02Features {
  formationReturn: number;
}

export interface RebalanceOutcome {
  date: string;
  cohortSize: number;
  winners: number;
  losers: number;
  longShortGross: number;
  longOnlyGross: number;
  cohortGross: number;
}

export type LegStatistics = StatisticSummary;

export interface M02Result {
  contractHash: string;
  rebalances: RebalanceOutcome[];
  longShort: LegStatistics;
  longOnly: LegStatistics;
  /** Long-only in excess of its own cohort, isolating selection from market direction. */
  longVsCohort: LegStatistics;
  byEra: { era: string; rebalances: number; longShortGrossBps: number; longOnlyGrossBps: number }[];
  instrumentsSeen: number;
}

const SPEC: ProbeSpec<M02Features> = {
  contract: {
    lookbackSessions: M02_CONTRACT.formationSessions + M02_CONTRACT.skipSessions,
    holdingSessions: M02_CONTRACT.holdingSessions,
    liquidityCohortPct: M02_CONTRACT.liquidityCohortPct,
    liquidityLookbackSessions: M02_CONTRACT.liquidityLookbackSessions,
    minCohortSize: M02_CONTRACT.minCohortSize,
    costBpsPerLeg: M02_CONTRACT.costBpsPerLeg,
  },
  features({ back, at }) {
    // The bar at EXACTLY this session, not the nearest available one — the contract declares a
    // 126-session formation window and a nearer substitute would measure a shorter one.
    const past = back(M02_CONTRACT.formationSessions + M02_CONTRACT.skipSessions);
    if (!past || past.close <= 0) return null;
    return { formationReturn: at.close / past.close - 1 };
  },
  partition(cohort) {
    const ranked = [...cohort].sort((a, b) => b.features.formationReturn - a.features.formationReturn);
    const legSize = Math.max(1, Math.floor(ranked.length * M02_CONTRACT.portfolioFraction));
    return { winners: ranked.slice(0, legSize), losers: ranked.slice(-legSize) };
  },
  statistics({ winners, losers }, cohortReturn) {
    return {
      longShort: winners - losers,
      longOnly: winners,
      longVsCohort: winners - cohortReturn,
    };
  },
  primaryStatistic: "longShort",
  legsOf: (id) => (id === "longShort" ? 2 : 1),
};

/**
 * Run the probe over a date-keyed universe.
 *
 * Mechanics live in `runCrossSectionalProbe`; what remains here is only what makes M02 M02.
 */
export function runM02Probe(
  universe: ReadonlyMap<string, readonly DailyBar[]>,
  eligibleAt: (instrumentId: string, date: string) => boolean,
): M02Result {
  const run = runCrossSectionalProbe(universe, eligibleAt, SPEC);
  const BPS = 10_000;
  return {
    contractHash: M02_CONTRACT_HASH,
    rebalances: run.rebalances.map((r) => ({
      date: r.date,
      cohortSize: r.cohortSize,
      winners: r.groupSizes.winners!,
      losers: r.groupSizes.losers!,
      longShortGross: r.statistics.longShort!,
      longOnlyGross: r.statistics.longOnly!,
      cohortGross: r.cohortReturn,
    })),
    longShort: run.summaries.longShort!,
    longOnly: run.summaries.longOnly!,
    longVsCohort: run.summaries.longVsCohort!,
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
