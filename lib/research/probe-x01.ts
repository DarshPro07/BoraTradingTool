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
import { blockBootstrapPositive, hacMean, profitFactor, type HacResult } from "./inference";

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

export interface DailyBar {
  date: string;
  close: number;
  volume: number;
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

export interface X01Leg {
  observations: number;
  grossMeanBps: number;
  netMeanBps: number;
  profitFactorGross: number;
  hac: HacResult;
  probabilityMeanPositive: number;
}

export interface X01Result {
  contractHash: string;
  rebalances: X01Rebalance[];
  spread: X01Leg;
  highVsCohort: X01Leg;
  lowVsCohort: X01Leg;
  byEra: { era: string; rebalances: number; spreadGrossBps: number }[];
  instrumentsSeen: number;
}

export const ERAS: readonly { name: string; from: string; to: string }[] = Object.freeze([
  { name: "2000-2007", from: "2000-01-01", to: "2007-12-31" },
  { name: "2008-2014", from: "2008-01-01", to: "2014-12-31" },
  { name: "2015-2019", from: "2015-01-01", to: "2019-12-31" },
  { name: "2020-2026", from: "2020-01-01", to: "2026-12-31" },
]);

const BPS = 10_000;

function leg(series: readonly number[], costBps: number): X01Leg {
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

export function runX01Probe(
  universe: ReadonlyMap<string, readonly DailyBar[]>,
  eligibleAt: (instrumentId: string, date: string) => boolean,
): X01Result {
  const c = X01_CONTRACT;
  const allDates = [...new Set([...universe.values()].flatMap((b) => b.map((x) => x.date)))].sort();
  const indexOf = new Map(allDates.map((d, i) => [d, i]));

  const monthEnds: string[] = [];
  for (let i = 0; i < allDates.length - 1; i += 1) {
    if (allDates[i]!.slice(0, 7) !== allDates[i + 1]!.slice(0, 7)) monthEnds.push(allDates[i]!);
  }

  // Built ONCE. Rebuilding this inside the rebalance loop made the probe quadratic in bar count —
  // 122 seconds for one test file, and the same waste on every real run.
  const byInstrument = new Map<string, Map<string, DailyBar>>();
  for (const [id, bars] of universe) byInstrument.set(id, new Map(bars.map((b) => [b.date, b])));

  const rebalances: X01Rebalance[] = [];
  const seen = new Set<string>();

  for (const date of monthEnds) {
    const at = indexOf.get(date)!;
    const formationStart = at - c.formationSessions;
    const exitIndex = at + c.holdingSessions;
    if (formationStart < 1 || exitIndex >= allDates.length) continue;
    const exitDate = allDates[exitIndex]!;

    const candidates: { id: string; max: number; liquidity: number; forward: number }[] = [];
    for (const id of universe.keys()) {
      if (!eligibleAt(id, date)) continue;
      const byDate = byInstrument.get(id)!;
      const now = byDate.get(date);
      const exit = byDate.get(exitDate);
      if (!now || !exit || now.close <= 0) continue;

      // MAX and liquidity both read ONLY the formation window — never a bar at or after exit.
      let max = -Infinity;
      let observed = 0;
      const traded: number[] = [];
      for (let i = formationStart; i <= at; i += 1) {
        const bar = byDate.get(allDates[i]!);
        const prev = byDate.get(allDates[i - 1]!);
        if (bar) traded.push(bar.close * bar.volume);
        if (!bar || !prev || prev.close <= 0) continue;
        max = Math.max(max, bar.close / prev.close - 1);
        observed += 1;
      }
      if (observed < c.formationSessions / 2 || !Number.isFinite(max)) continue;
      if (traded.length < c.liquidityLookbackSessions / 2) continue;
      traded.sort((a, b) => a - b);

      candidates.push({
        id,
        max,
        liquidity: traded[Math.floor(traded.length / 2)]!,
        forward: exit.close / now.close - 1,
      });
      seen.add(id);
    }

    const cohortSize = Math.floor(candidates.length * c.liquidityCohortPct);
    if (cohortSize < c.minCohortSize) continue;
    const cohort = candidates.sort((a, b) => b.liquidity - a.liquidity).slice(0, cohortSize);

    const ranked = [...cohort].sort((a, b) => b.max - a.max);
    const legSize = Math.max(1, Math.floor(ranked.length * c.portfolioFraction));
    const mean = (xs: { forward: number }[]) => xs.reduce((s, x) => s + x.forward, 0) / xs.length;

    const highMax = mean(ranked.slice(0, legSize));
    const lowMax = mean(ranked.slice(-legSize));

    rebalances.push({
      date,
      cohortSize: cohort.length,
      spreadGross: highMax - lowMax,
      highMaxGross: highMax,
      lowMaxGross: lowMax,
      cohortGross: mean(cohort),
    });
  }

  return {
    contractHash: X01_CONTRACT_HASH,
    rebalances,
    spread: leg(rebalances.map((r) => r.spreadGross), c.costBpsPerLeg * 2),
    highVsCohort: leg(rebalances.map((r) => r.highMaxGross - r.cohortGross), c.costBpsPerLeg),
    lowVsCohort: leg(rebalances.map((r) => r.lowMaxGross - r.cohortGross), c.costBpsPerLeg),
    byEra: ERAS.map((era) => {
      const inEra = rebalances.filter((r) => r.date >= era.from && r.date <= era.to);
      return {
        era: era.name,
        rebalances: inEra.length,
        spreadGrossBps: inEra.length
          ? (inEra.reduce((s, r) => s + r.spreadGross, 0) / inEra.length) * BPS
          : 0,
      };
    }),
    instrumentsSeen: seen.size,
  };
}
