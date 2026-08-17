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
import { bootstrapSignProbability, hacMean, profitFactor, type HacResult } from "./inference";

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

export interface DailyBar {
  date: string;
  close: number;
  volume: number;
}

export interface V01Rebalance {
  date: string;
  cohortSize: number;
  /** Each cell's forward return in EXCESS of the same cohort on the same date. */
  posHigh: number;
  posNormal: number;
  negHigh: number;
  negNormal: number;
  highVolumeSpread: number;
  normalVolumeSpread: number;
  interaction: number;
}

export interface V01Leg {
  observations: number;
  grossMeanBps: number;
  netMeanBps: number;
  profitFactorGross: number;
  hac: HacResult;
  bootstrapSignProbability: number;
}

export interface V01Result {
  contractHash: string;
  rebalances: V01Rebalance[];
  /** The primary statistic: does volume change what follows an extreme move? */
  interaction: V01Leg;
  highVolumeSpread: V01Leg;
  normalVolumeSpread: V01Leg;
  cells: { posHigh: V01Leg; posNormal: V01Leg; negHigh: V01Leg; negNormal: V01Leg };
  byEra: { era: string; rebalances: number; interactionBps: number }[];
  instrumentsSeen: number;
}

export const ERAS: readonly { name: string; from: string; to: string }[] = Object.freeze([
  { name: "2000-2007", from: "2000-01-01", to: "2007-12-31" },
  { name: "2008-2014", from: "2008-01-01", to: "2014-12-31" },
  { name: "2015-2019", from: "2015-01-01", to: "2019-12-31" },
  { name: "2020-2026", from: "2020-01-01", to: "2026-12-31" },
]);

const BPS = 10_000;

function leg(series: readonly number[], costBps: number): V01Leg {
  const hac = hacMean(series);
  return {
    observations: series.length,
    grossMeanBps: hac.mean * BPS,
    netMeanBps: hac.mean * BPS - costBps,
    profitFactorGross: profitFactor(series),
    hac,
    bootstrapSignProbability: bootstrapSignProbability(series),
  };
}

export function runV01Probe(
  universe: ReadonlyMap<string, readonly DailyBar[]>,
  eligibleAt: (instrumentId: string, date: string) => boolean,
): V01Result {
  const c = V01_CONTRACT;
  const allDates = [...new Set([...universe.values()].flatMap((b) => b.map((x) => x.date)))].sort();
  const indexOf = new Map(allDates.map((d, i) => [d, i]));

  const monthEnds: string[] = [];
  for (let i = 0; i < allDates.length - 1; i += 1) {
    if (allDates[i]!.slice(0, 7) !== allDates[i + 1]!.slice(0, 7)) monthEnds.push(allDates[i]!);
  }

  const byInstrument = new Map<string, Map<string, DailyBar>>();
  for (const [id, bars] of universe) byInstrument.set(id, new Map(bars.map((b) => [b.date, b])));

  const rebalances: V01Rebalance[] = [];
  const seen = new Set<string>();

  for (const date of monthEnds) {
    const at = indexOf.get(date)!;
    const returnStart = at - c.formationSessions;
    const baselineStart = at - c.volumeBaselineSessions;
    const exitIndex = at + c.holdingSessions;
    if (baselineStart < 0 || exitIndex >= allDates.length) continue;
    const exitDate = allDates[exitIndex]!;

    const candidates: {
      id: string;
      priorReturn: number;
      volumeRatio: number;
      liquidity: number;
      forward: number;
    }[] = [];

    for (const id of universe.keys()) {
      if (!eligibleAt(id, date)) continue;
      const byDate = byInstrument.get(id)!;
      const now = byDate.get(date);
      const past = byDate.get(allDates[returnStart]!);
      const exit = byDate.get(exitDate);
      if (!now || !past || !exit || past.close <= 0 || now.close <= 0) continue;

      // Recent volume against this instrument's OWN baseline — both read only up to `at`.
      let recentSum = 0;
      let recentCount = 0;
      const baseline: number[] = [];
      for (let i = baselineStart; i <= at; i += 1) {
        const bar = byDate.get(allDates[i]!);
        if (!bar) continue;
        baseline.push(bar.volume);
        if (i > returnStart) {
          recentSum += bar.volume;
          recentCount += 1;
        }
      }
      if (recentCount === 0 || baseline.length < c.volumeBaselineSessions / 2) continue;
      const baselineMean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
      if (baselineMean <= 0) continue;

      const traded = baseline.map((v, i) => v * (byDate.get(allDates[baselineStart + i]!)?.close ?? 0));
      traded.sort((a, b) => a - b);

      candidates.push({
        id,
        priorReturn: now.close / past.close - 1,
        volumeRatio: recentSum / recentCount / baselineMean,
        liquidity: traded[Math.floor(traded.length / 2)]!,
        forward: exit.close / now.close - 1,
      });
      seen.add(id);
    }

    const cohortSize = Math.floor(candidates.length * c.liquidityCohortPct);
    if (cohortSize < c.minCohortSize) continue;
    const cohort = candidates.sort((a, b) => b.liquidity - a.liquidity).slice(0, cohortSize);

    // The benchmark: the same eligible cohort, same date, equal weight.
    const cohortReturn = cohort.reduce((s, x) => s + x.forward, 0) / cohort.length;

    const byVolume = [...cohort].sort((a, b) => a.volumeRatio - b.volumeRatio);
    const medianRatio = byVolume[Math.floor(byVolume.length / 2)]!.volumeRatio;

    const byReturn = [...cohort].sort((a, b) => b.priorReturn - a.priorReturn);
    const extremeSize = Math.max(1, Math.floor(byReturn.length * c.extremeFraction));
    const positives = byReturn.slice(0, extremeSize);
    const negatives = byReturn.slice(-extremeSize);

    const cell = (group: typeof cohort, high: boolean): number | null => {
      const members = group.filter((x) => (high ? x.volumeRatio >= medianRatio : x.volumeRatio < medianRatio));
      if (members.length === 0) return null;
      return members.reduce((s, x) => s + x.forward, 0) / members.length - cohortReturn;
    };

    const posHigh = cell(positives, true);
    const posNormal = cell(positives, false);
    const negHigh = cell(negatives, true);
    const negNormal = cell(negatives, false);
    // A rebalance where any cell is empty cannot form the interaction, so it is skipped rather
    // than filled with a zero that would read as "no effect".
    if (posHigh === null || posNormal === null || negHigh === null || negNormal === null) continue;

    const highVolumeSpread = posHigh - negHigh;
    const normalVolumeSpread = posNormal - negNormal;

    rebalances.push({
      date,
      cohortSize: cohort.length,
      posHigh,
      posNormal,
      negHigh,
      negNormal,
      highVolumeSpread,
      normalVolumeSpread,
      interaction: highVolumeSpread - normalVolumeSpread,
    });
  }

  const series = (pick: (r: V01Rebalance) => number) => rebalances.map(pick);
  const twoLeg = c.costBpsPerLeg * 2;

  return {
    contractHash: V01_CONTRACT_HASH,
    rebalances,
    interaction: leg(series((r) => r.interaction), twoLeg),
    highVolumeSpread: leg(series((r) => r.highVolumeSpread), twoLeg),
    normalVolumeSpread: leg(series((r) => r.normalVolumeSpread), twoLeg),
    cells: {
      posHigh: leg(series((r) => r.posHigh), c.costBpsPerLeg),
      posNormal: leg(series((r) => r.posNormal), c.costBpsPerLeg),
      negHigh: leg(series((r) => r.negHigh), c.costBpsPerLeg),
      negNormal: leg(series((r) => r.negNormal), c.costBpsPerLeg),
    },
    byEra: ERAS.map((era) => {
      const inEra = rebalances.filter((r) => r.date >= era.from && r.date <= era.to);
      return {
        era: era.name,
        rebalances: inEra.length,
        interactionBps: inEra.length
          ? (inEra.reduce((s, r) => s + r.interaction, 0) / inEra.length) * BPS
          : 0,
      };
    }),
    instrumentsSeen: seen.size,
  };
}
