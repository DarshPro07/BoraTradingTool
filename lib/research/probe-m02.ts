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
import { blockBootstrapPositive, hacMean, profitFactor, type HacResult } from "./inference";

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

/** Eras chosen for independence, predeclared with the rest of the contract. */
export const ERAS: readonly { name: string; from: string; to: string }[] = Object.freeze([
  { name: "2000-2007", from: "2000-01-01", to: "2007-12-31" },
  { name: "2008-2014", from: "2008-01-01", to: "2014-12-31" },
  { name: "2015-2019", from: "2015-01-01", to: "2019-12-31" },
  { name: "2020-2026", from: "2020-01-01", to: "2026-12-31" },
]);

export interface DailyBar {
  date: string;
  close: number;
  volume: number;
}

export interface RebalanceOutcome {
  date: string;
  cohortSize: number;
  winners: number;
  losers: number;
  /** The factor spread — a research diagnosis, not an implementable portfolio. */
  longShortGross: number;
  /** The implementable leg for a deployment that does not short delivery equities. */
  longOnlyGross: number;
  /** The equal-weight cohort return, so the long leg can be read against its own universe. */
  cohortGross: number;
}

export interface LegStatistics {
  observations: number;
  grossMeanBps: number;
  netMeanBps: number;
  profitFactorGross: number;
  hac: HacResult;
  probabilityMeanPositive: number;
}

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

const BPS = 10_000;

function statistics(series: readonly number[], costBps: number): LegStatistics {
  const hac = hacMean(series);
  return {
    observations: series.length,
    grossMeanBps: hac.mean * BPS,
    netMeanBps: hac.mean * BPS - costBps,
    profitFactorGross: profitFactor(series),
    hac,
    probabilityMeanPositive: blockBootstrapPositive(series),
  };
}

/**
 * Run the probe over a date-keyed universe.
 *
 * `eligibleAt` answers point-in-time listing: an instrument not yet listed at a rebalance date must
 * not enter the universe at that date, or the probe ranks stocks on history they did not have.
 */
export function runM02Probe(
  universe: ReadonlyMap<string, readonly DailyBar[]>,
  eligibleAt: (instrumentId: string, date: string) => boolean,
): M02Result {
  const contract = M02_CONTRACT;

  // One shared session axis, so a rebalance date means the same thing for every instrument.
  const allDates = [...new Set([...universe.values()].flatMap((bars) => bars.map((b) => b.date)))].sort();
  const indexOf = new Map(allDates.map((d, i) => [d, i]));
  const barsByDate = new Map<string, Map<string, DailyBar>>();
  for (const [id, bars] of universe) {
    for (const bar of bars) {
      let day = barsByDate.get(bar.date);
      if (!day) {
        day = new Map();
        barsByDate.set(bar.date, day);
      }
      day.set(id, bar);
    }
  }

  // Rebalance on the last session of each month.
  const monthEnds: string[] = [];
  for (let i = 0; i < allDates.length - 1; i += 1) {
    if (allDates[i]!.slice(0, 7) !== allDates[i + 1]!.slice(0, 7)) monthEnds.push(allDates[i]!);
  }

  const rebalances: RebalanceOutcome[] = [];
  const seen = new Set<string>();

  for (const date of monthEnds) {
    const at = indexOf.get(date)!;
    const formationStart = at - contract.formationSessions - contract.skipSessions;
    const exitIndex = at + contract.holdingSessions;
    if (formationStart < 0 || exitIndex >= allDates.length) continue;

    const exitDate = allDates[exitIndex]!;
    const liquidityStart = at - contract.liquidityLookbackSessions;

    const candidates: { id: string; formation: number; liquidity: number; forward: number }[] = [];
    for (const [id, bars] of universe) {
      if (!eligibleAt(id, date)) continue;

      const byDate = new Map(bars.map((b) => [b.date, b]));
      const now = byDate.get(date);
      const past = byDate.get(allDates[formationStart]!);
      const exit = byDate.get(exitDate);
      if (!now || !past || !exit || past.close <= 0 || now.close <= 0) continue;

      // Liquidity from the lookback window ONLY — never from the holding period.
      const window: number[] = [];
      for (let i = liquidityStart; i <= at; i += 1) {
        const bar = byDate.get(allDates[i]!);
        if (bar) window.push(bar.close * bar.volume);
      }
      if (window.length < contract.liquidityLookbackSessions / 2) continue;
      window.sort((a, b) => a - b);

      candidates.push({
        id,
        formation: now.close / past.close - 1,
        liquidity: window[Math.floor(window.length / 2)]!,
        forward: exit.close / now.close - 1,
      });
      seen.add(id);
    }

    // Predeclared liquidity conditioning, applied before ranking on momentum.
    const cohortSize = Math.floor(candidates.length * contract.liquidityCohortPct);
    if (cohortSize < contract.minCohortSize) continue;
    const cohort = candidates.sort((a, b) => b.liquidity - a.liquidity).slice(0, cohortSize);

    const ranked = [...cohort].sort((a, b) => b.formation - a.formation);
    const legSize = Math.max(1, Math.floor(ranked.length * contract.portfolioFraction));
    const winners = ranked.slice(0, legSize);
    const losers = ranked.slice(-legSize);

    const mean = (xs: { forward: number }[]) => xs.reduce((s, x) => s + x.forward, 0) / xs.length;
    const winnerReturn = mean(winners);
    const loserReturn = mean(losers);
    const cohortReturn = mean(cohort);

    rebalances.push({
      date,
      cohortSize: cohort.length,
      winners: winners.length,
      losers: losers.length,
      longShortGross: winnerReturn - loserReturn,
      longOnlyGross: winnerReturn,
      cohortGross: cohortReturn,
    });
  }

  const ls = rebalances.map((r) => r.longShortGross);
  const lo = rebalances.map((r) => r.longOnlyGross);
  const excess = rebalances.map((r) => r.longOnlyGross - r.cohortGross);

  return {
    contractHash: M02_CONTRACT_HASH,
    rebalances,
    // Long-short pays friction on both legs; the long-only leg pays it once.
    longShort: statistics(ls, contract.costBpsPerLeg * 2),
    longOnly: statistics(lo, contract.costBpsPerLeg),
    longVsCohort: statistics(excess, contract.costBpsPerLeg),
    byEra: ERAS.map((era) => {
      const inEra = rebalances.filter((r) => r.date >= era.from && r.date <= era.to);
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      return {
        era: era.name,
        rebalances: inEra.length,
        longShortGrossBps: avg(inEra.map((r) => r.longShortGross)) * BPS,
        longOnlyGrossBps: avg(inEra.map((r) => r.longOnlyGross)) * BPS,
      };
    }),
    instrumentsSeen: seen.size,
  };
}
