/**
 * The shared mechanics every cross-sectional probe needs, and nothing else.
 *
 * ## Why this exists
 *
 * M02, X01 and V01 each carried their own copy of the session axis, month-end derivation,
 * point-in-time eligibility, liquidity cohort selection, cohort benchmarking, cost application and
 * inference. Three copies drift; a fourth is where drift becomes likely rather than possible. S01
 * would have been the fourth.
 *
 * It is deliberately **not** a universal strategy engine. A hypothesis supplies only what makes it
 * a different hypothesis:
 *
 * ```
 * the probe supplies          the runner owns
 * ------------------          ---------------
 * formation features          point-in-time universe
 * ranking / classification    liquidity cohort
 * predeclared legs or cells   cohort benchmark
 * statistic definitions       portfolio accounting, costs
 * the primary statistic       decision units, HAC, bootstrap
 *                             era splitting, provenance
 * ```
 *
 * ## The rule this makes structural
 *
 * > **Every cross-sectional leg is evaluated relative to the same eligible cohort on the same
 * > rebalance date, unless the hypothesis explicitly declares otherwise.**
 *
 * M02's long-only leg read +122 bps and added +12.5 over its own cohort — the rest was market
 * exposure. That was caught by remembering to look. Here `cohortReturn` is handed to every
 * statistic definition, so a probe cannot benchmark differently from its predecessors by omission,
 * and S01 cannot quietly diverge from X01.
 */
import { bootstrapSignProbability, hacMean, profitFactor, type HacResult } from "./inference";

export interface DailyBar {
  date: string;
  close: number;
  volume: number;
}

/** One instrument at one rebalance date, with whatever the hypothesis measured about it. */
export interface Candidate<F> {
  id: string;
  features: F;
  /** Median rupee traded value over the liquidity lookback — the conditioning variable. */
  liquidity: number;
  /** Return from the rebalance close to the exit close. Never visible to `features`. */
  forward: number;
}

/**
 * What a probe sees when computing features. Bounded to the formation window by construction.
 *
 * `back(n)` is indexed by SESSION, not by available bar — `back(126)` is the bar 126 sessions
 * before the rebalance date, or `undefined` if this instrument did not trade that session. A
 * compacted "oldest available bar" would silently substitute a nearer date for a missing one and
 * measure a shorter formation window than the contract declares. That is not a rounding difference:
 * it changed M02's rebalance count from 221 to 226 and moved every statistic.
 */
export interface FeatureContext {
  /** The bar `n` sessions before the rebalance date. `back(0)` is the rebalance bar itself. */
  back(n: number): DailyBar | undefined;
  /** The bar at the rebalance date. */
  at: DailyBar;
  /** Every bar present in the window, oldest first — for statistics over whatever traded. */
  present: readonly DailyBar[];
}

export interface RunnerContract {
  /** Sessions of history the features need before the rebalance date. */
  lookbackSessions: number;
  holdingSessions: number;
  liquidityCohortPct: number;
  liquidityLookbackSessions: number;
  minCohortSize: number;
  costBpsPerLeg: number;
}

export interface ProbeSpec<F> {
  contract: RunnerContract;
  /** Per-candidate measurement from the formation window. `null` excludes the instrument. */
  features(ctx: FeatureContext): F | null;
  /**
   * Named groups drawn from the liquidity cohort. `null` skips the whole rebalance.
   *
   * Skipping matters: a rebalance where a cell could not be formed must not contribute a zero,
   * which would read as "no effect" for that regime rather than "not measured".
   */
  partition(cohort: readonly Candidate<F>[]): Record<string, readonly Candidate<F>[]> | null;
  /**
   * Statistics for this rebalance, from each group's mean forward return and the cohort's.
   *
   * `cohortReturn` is always supplied — a probe that ignores it is choosing to, visibly.
   */
  statistics(groupMeans: Readonly<Record<string, number>>, cohortReturn: number): Record<string, number>;
  /** Which statistic the contract pre-registered as primary. */
  primaryStatistic: string;
  /** Legs traded by each statistic: 1 for a single leg, 2 for a spread. */
  legsOf(statisticId: string): number;
}

export interface StatisticSummary {
  statisticId: string;
  isPrimary: boolean;
  observations: number;
  grossMeanBps: number;
  netMeanBps: number;
  costBps: number;
  profitFactorGross: number;
  hac: HacResult;
  bootstrapSignProbability: number;
}

export interface RebalanceRecord {
  date: string;
  cohortSize: number;
  cohortReturn: number;
  groupSizes: Record<string, number>;
  statistics: Record<string, number>;
}

export interface ProbeRun {
  rebalances: RebalanceRecord[];
  summaries: Record<string, StatisticSummary>;
  primary: StatisticSummary | null;
  byEra: { era: string; rebalances: number; primaryGrossBps: number }[];
  instrumentsSeen: number;
}

export const ERAS: readonly { name: string; from: string; to: string }[] = Object.freeze([
  { name: "2000-2007", from: "2000-01-01", to: "2007-12-31" },
  { name: "2008-2014", from: "2008-01-01", to: "2014-12-31" },
  { name: "2015-2019", from: "2015-01-01", to: "2019-12-31" },
  { name: "2020-2026", from: "2020-01-01", to: "2026-12-31" },
]);

const BPS = 10_000;

function summarise(
  statisticId: string,
  series: readonly number[],
  costBps: number,
  isPrimary: boolean,
): StatisticSummary {
  const hac = hacMean(series);
  return {
    statisticId,
    isPrimary,
    observations: series.length,
    grossMeanBps: hac.mean * BPS,
    netMeanBps: hac.mean * BPS - costBps,
    costBps,
    profitFactorGross: profitFactor(series),
    hac,
    bootstrapSignProbability: bootstrapSignProbability(series),
  };
}

const mean = (xs: readonly { forward: number }[]) =>
  xs.reduce((s, x) => s + x.forward, 0) / xs.length;

/**
 * Run a cross-sectional probe.
 *
 * `eligibleAt` answers point-in-time listing: an instrument not yet listed at a rebalance date must
 * not be ranked at that date, or the probe uses history the stock did not have.
 */
export function runCrossSectionalProbe<F>(
  universe: ReadonlyMap<string, readonly DailyBar[]>,
  eligibleAt: (instrumentId: string, date: string) => boolean,
  spec: ProbeSpec<F>,
): ProbeRun {
  const c = spec.contract;
  const allDates = [...new Set([...universe.values()].flatMap((b) => b.map((x) => x.date)))].sort();
  const indexOf = new Map(allDates.map((d, i) => [d, i]));

  // Rebalance on the last session of each calendar month.
  const monthEnds: string[] = [];
  for (let i = 0; i < allDates.length - 1; i += 1) {
    if (allDates[i]!.slice(0, 7) !== allDates[i + 1]!.slice(0, 7)) monthEnds.push(allDates[i]!);
  }

  // Built once. Rebuilding per rebalance made the probes quadratic in bar count.
  const byInstrument = new Map<string, Map<string, DailyBar>>();
  for (const [id, bars] of universe) byInstrument.set(id, new Map(bars.map((b) => [b.date, b])));

  const rebalances: RebalanceRecord[] = [];
  const seen = new Set<string>();
  const lookback = Math.max(c.lookbackSessions, c.liquidityLookbackSessions);

  for (const date of monthEnds) {
    const at = indexOf.get(date)!;
    const windowStart = at - lookback;
    const exitIndex = at + c.holdingSessions;
    if (windowStart < 0 || exitIndex >= allDates.length) continue;
    const exitDate = allDates[exitIndex]!;

    const candidates: Candidate<F>[] = [];
    for (const id of universe.keys()) {
      if (!eligibleAt(id, date)) continue;
      const byDate = byInstrument.get(id)!;
      const now = byDate.get(date);
      const exit = byDate.get(exitDate);
      if (!now || !exit || now.close <= 0) continue;

      // Liquidity reads its OWN window, by session, exactly as each probe did before extraction.
      const traded: number[] = [];
      for (let i = at - c.liquidityLookbackSessions; i <= at; i += 1) {
        const bar = byDate.get(allDates[i]!);
        if (bar) traded.push(bar.close * bar.volume);
      }
      if (traded.length < c.liquidityLookbackSessions / 2) continue;
      traded.sort((a, b) => a - b);

      // The window stops AT the rebalance date. `features` structurally cannot see the future.
      const present: DailyBar[] = [];
      for (let i = windowStart; i <= at; i += 1) {
        const bar = byDate.get(allDates[i]!);
        if (bar) present.push(bar);
      }
      const back = (n: number): DailyBar | undefined => {
        const index = at - n;
        return index < 0 ? undefined : byDate.get(allDates[index]!);
      };

      const features = spec.features({ back, at: now, present });
      if (features === null) continue;

      candidates.push({
        id,
        features,
        liquidity: traded[Math.floor(traded.length / 2)]!,
        forward: exit.close / now.close - 1,
      });
      seen.add(id);
    }

    const cohortSize = Math.floor(candidates.length * c.liquidityCohortPct);
    if (cohortSize < c.minCohortSize) continue;
    const cohort = candidates.sort((a, b) => b.liquidity - a.liquidity).slice(0, cohortSize);

    const groups = spec.partition(cohort);
    if (groups === null) continue;

    const groupMeans: Record<string, number> = {};
    const groupSizes: Record<string, number> = {};
    let incomplete = false;
    for (const [name, members] of Object.entries(groups)) {
      if (members.length === 0) {
        incomplete = true;
        break;
      }
      groupMeans[name] = mean(members);
      groupSizes[name] = members.length;
    }
    if (incomplete) continue;

    // The benchmark: the same eligible cohort, same date, equal weight.
    const cohortReturn = mean(cohort);

    rebalances.push({
      date,
      cohortSize: cohort.length,
      cohortReturn,
      groupSizes,
      statistics: spec.statistics(groupMeans, cohortReturn),
    });
  }

  const statisticIds = rebalances.length > 0 ? Object.keys(rebalances[0]!.statistics) : [];
  const summaries: Record<string, StatisticSummary> = {};
  for (const id of statisticIds) {
    summaries[id] = summarise(
      id,
      rebalances.map((r) => r.statistics[id]!),
      c.costBpsPerLeg * spec.legsOf(id),
      id === spec.primaryStatistic,
    );
  }

  return {
    rebalances,
    summaries,
    primary: summaries[spec.primaryStatistic] ?? null,
    byEra: ERAS.map((era) => {
      const inEra = rebalances.filter((r) => r.date >= era.from && r.date <= era.to);
      return {
        era: era.name,
        rebalances: inEra.length,
        primaryGrossBps: inEra.length
          ? (inEra.reduce((s, r) => s + (r.statistics[spec.primaryStatistic] ?? 0), 0) / inEra.length) *
            BPS
          : 0,
      };
    }),
    instrumentsSeen: seen.size,
  };
}
