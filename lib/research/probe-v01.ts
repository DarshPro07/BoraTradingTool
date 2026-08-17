/**
 * V01 — return × volume regime, registered as a DIRECTION-NEUTRAL question.
 *
 * ## The question
 *
 * > Does the return following an extreme prior move depend systematically on whether that move
 * > happened under abnormally high or normal trading volume?
 *
 * Not "does high volume predict continuation". The Indian return-volume evidence documents
 * regime-dependent dynamics consistent with overconfidence and the disposition effect; it does
 * **not** hand over a profitable rule, and several mechanisms point opposite ways:
 *
 * ```
 * information arrival   volume marks genuine repricing  -> continuation
 * overreaction          volume marks a crowd            -> reversal
 * overconfidence        volume marks excess trading     -> reversal
 * disposition effect    volume marks forced sellers     -> continuation then reversal
 * ```
 *
 * So the primary statistic is an **interaction**, not a return:
 *
 * ```
 * highVolumeSpread   = POS_HIGH   - NEG_HIGH
 * normalVolumeSpread = POS_NORMAL - NEG_NORMAL
 * interaction        = highVolumeSpread - normalVolumeSpread     <- the question
 * ```
 *
 * A non-zero interaction of either sign is a finding. Zero means volume carries no information
 * about what follows an extreme move, which is also a finding and the cheapest one to accept.
 *
 * ## Chosen before any output exists
 *
 * Extreme = the cohort's top and bottom quintile by 5-day return. Volume state = a median split of
 * the cohort on 5-day average volume over its own 20-day baseline. Both predeclared once, from the
 * mechanism rather than from a sweep — a grid of 20 volume thresholds x 10 return thresholds
 * x 5 holds would be an optimizer wearing a hypothesis.
 *
 * The volume baseline is per-instrument by construction, so "abnormal" means abnormal for that
 * stock rather than large in absolute terms.
 *
 * ## Every cell is reported against the cohort
 *
 * Foundry policy after M02: a leg that merely went up is not selection. M02's long-only winners
 * showed +122 bps and added +12.5 over their own cohort — the rest was market exposure. So each of
 * the four cells is measured against the equal-weight return of the same eligible cohort on the
 * same rebalance date, and "the portfolio rose" can never count as evidence.
 */
import { createHash } from "node:crypto";
import {
  runCrossSectionalProbe,
  ERAS,
  type DailyBar,
  type ProbeSpec,
  type StatisticSummary,
} from "./cross-sectional-runner";

export const V01_CONTRACT = Object.freeze({
  hypothesisId: "V01",
  title: "Return x volume regime in NSE equities — direction registered as UNKNOWN",

  /** The prior move. Short, because the mechanisms described are about recent shocks. */
  formationSessions: 5,
  /** Volume is judged against the instrument's own baseline, not the universe's. */
  volumeBaselineSessions: 20,
  holdingSessions: 21,
  rebalance: "MONTHLY" as const,

  /** Extreme = top/bottom quintile of the cohort by 5-day return. Predeclared once. */
  extremeFraction: 0.20,
  /** Volume state = median split of the cohort on abnormal-volume ratio. Predeclared once. */
  volumeSplit: "COHORT_MEDIAN" as const,

  liquidityCohortPct: 0.30,
  liquidityLookbackSessions: 20,
  liquidityProxy: "MEDIAN_RUPEE_TRADED_VALUE" as const,

  costBpsPerLeg: 38,
  minCohortSize: 40, // four cells, so the cohort must divide into usable pieces

  priorDirection: "UNKNOWN" as const,
  primaryStatistic: "INTERACTION_HIGH_MINUS_NORMAL_VOLUME_SPREAD" as const,

  evidenceMarket: "INDIA_NSE" as const,
  targetMarket: "NSE" as const,
  transferAssumption: "MECHANISM_ONLY_NO_TRADING_RULE_CLAIMED" as const,
  replicationStatus: "NOT_A_DIRECT_REPLICATION" as const,
  replicationGap:
    "The source documents regime-dependent return-volume dynamics and investor biases, not a " +
    "trading rule. No sector conditioning is applied because sector coverage here is externally " +
    "constrained to ~38% of the universe.",

  rightsStatus: "EXPLORATORY_ONLY_UNDER_UNKNOWN_ACCESS_BASIS" as const,
  promotionForbidden: true,
  knownBias: "UNIVERSE_SELECTED_ON_RECENT_LIQUIDITY — survivorship bias present, direction unknown",
});

export const V01_CONTRACT_HASH = createHash("sha256")
  .update(JSON.stringify(V01_CONTRACT))
  .digest("hex")
  .slice(0, 16);

export type { DailyBar };
export { ERAS };

/** What V01 measures: the recent move, and how unusual the volume behind it was. */
interface V01Features {
  priorReturn: number;
  volumeRatio: number;
}

export interface V01Rebalance {
  date: string;
  cohortSize: number;
  posHigh: number;
  posNormal: number;
  negHigh: number;
  negNormal: number;
  highVolumeSpread: number;
  normalVolumeSpread: number;
  interaction: number;
}

export type V01Leg = StatisticSummary;

export interface V01Result {
  contractHash: string;
  rebalances: V01Rebalance[];
  interaction: V01Leg;
  highVolumeSpread: V01Leg;
  normalVolumeSpread: V01Leg;
  cells: { posHigh: V01Leg; posNormal: V01Leg; negHigh: V01Leg; negNormal: V01Leg };
  byEra: { era: string; rebalances: number; interactionBps: number }[];
  instrumentsSeen: number;
}

const SPEC: ProbeSpec<V01Features> = {
  contract: {
    lookbackSessions: V01_CONTRACT.volumeBaselineSessions,
    holdingSessions: V01_CONTRACT.holdingSessions,
    liquidityCohortPct: V01_CONTRACT.liquidityCohortPct,
    liquidityLookbackSessions: V01_CONTRACT.liquidityLookbackSessions,
    minCohortSize: V01_CONTRACT.minCohortSize,
    costBpsPerLeg: V01_CONTRACT.costBpsPerLeg,
  },
  features({ back, at }) {
    const past = back(V01_CONTRACT.formationSessions);
    if (!past || past.close <= 0) return null;

    // Recent volume against this instrument's OWN baseline, both session-indexed.
    let recentSum = 0;
    let recentCount = 0;
    const baseline: number[] = [];
    for (let n = 0; n <= V01_CONTRACT.volumeBaselineSessions; n += 1) {
      const bar = back(n);
      if (!bar) continue;
      baseline.push(bar.volume);
      if (n < V01_CONTRACT.formationSessions) {
        recentSum += bar.volume;
        recentCount += 1;
      }
    }
    if (recentCount === 0 || baseline.length < V01_CONTRACT.volumeBaselineSessions / 2) return null;
    const baselineMean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    if (baselineMean <= 0) return null;

    return {
      priorReturn: at.close / past.close - 1,
      volumeRatio: recentSum / recentCount / baselineMean,
    };
  },
  partition(cohort) {
    const byVolume = [...cohort].sort((a, b) => a.features.volumeRatio - b.features.volumeRatio);
    const medianRatio = byVolume[Math.floor(byVolume.length / 2)]!.features.volumeRatio;

    const byReturn = [...cohort].sort((a, b) => b.features.priorReturn - a.features.priorReturn);
    const extremeSize = Math.max(1, Math.floor(byReturn.length * V01_CONTRACT.extremeFraction));
    const positives = byReturn.slice(0, extremeSize);
    const negatives = byReturn.slice(-extremeSize);
    const high = (x: (typeof cohort)[number]) => x.features.volumeRatio >= medianRatio;

    return {
      posHigh: positives.filter(high),
      posNormal: positives.filter((x) => !high(x)),
      negHigh: negatives.filter(high),
      negNormal: negatives.filter((x) => !high(x)),
    };
  },
  statistics({ posHigh, posNormal, negHigh, negNormal }, cohortReturn) {
    // Every cell in excess of the SAME cohort on the SAME date — the rule the runner enforces.
    const ph = posHigh - cohortReturn;
    const pn = posNormal - cohortReturn;
    const nh = negHigh - cohortReturn;
    const nn = negNormal - cohortReturn;
    return {
      posHigh: ph,
      posNormal: pn,
      negHigh: nh,
      negNormal: nn,
      highVolumeSpread: ph - nh,
      normalVolumeSpread: pn - nn,
      interaction: ph - nh - (pn - nn),
    };
  },
  primaryStatistic: "interaction",
  legsOf: (id) => (id.endsWith("Spread") || id === "interaction" ? 2 : 1),
};

export function runV01Probe(
  universe: ReadonlyMap<string, readonly DailyBar[]>,
  eligibleAt: (instrumentId: string, date: string) => boolean,
): V01Result {
  const run = runCrossSectionalProbe(universe, eligibleAt, SPEC);
  const BPS = 10_000;
  return {
    contractHash: V01_CONTRACT_HASH,
    rebalances: run.rebalances.map((r) => ({
      date: r.date,
      cohortSize: r.cohortSize,
      posHigh: r.statistics.posHigh!,
      posNormal: r.statistics.posNormal!,
      negHigh: r.statistics.negHigh!,
      negNormal: r.statistics.negNormal!,
      highVolumeSpread: r.statistics.highVolumeSpread!,
      normalVolumeSpread: r.statistics.normalVolumeSpread!,
      interaction: r.statistics.interaction!,
    })),
    interaction: run.summaries.interaction!,
    highVolumeSpread: run.summaries.highVolumeSpread!,
    normalVolumeSpread: run.summaries.normalVolumeSpread!,
    cells: {
      posHigh: run.summaries.posHigh!,
      posNormal: run.summaries.posNormal!,
      negHigh: run.summaries.negHigh!,
      negNormal: run.summaries.negNormal!,
    },
    byEra: ERAS.map((era) => {
      const inEra = run.rebalances.filter((r) => r.date >= era.from && r.date <= era.to);
      return {
        era: era.name,
        rebalances: inEra.length,
        interactionBps: inEra.length
          ? (inEra.reduce((s, r) => s + r.statistics.interaction!, 0) / inEra.length) * BPS
          : 0,
      };
    }),
    instrumentsSeen: run.instrumentsSeen,
  };
}
