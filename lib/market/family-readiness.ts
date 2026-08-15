import { universeCoverage, type SecurityCoverage, type UniverseCoverageReport } from "./universe-coverage";

/**
 * FAMILY-SPECIFIC data readiness — the metric that decides when spending statistical trials
 * becomes meaningful (owner directive, 2026-08-16).
 *
 * "143 instruments are research ready" is the wrong number to reason with: an intraday
 * opening-range family needs 5-minute sessions, a swing momentum family needs a long daily
 * development window plus room for walk-forward and a sealed holdout, and a single universal
 * threshold answers neither question. So each family declares what IT requires, and readiness is
 * counted per family against that declaration.
 *
 * What this is NOT: a change to any pinned campaign. A family's data requirement describes what
 * its bars must look like before it can be studied at all; the campaign contract's statistical
 * gates (DSR, PBO, holdout policy, trial budget) are untouched and unreadable from here.
 */

export interface FamilyDataRequirement {
  /** Which bar series the family actually trades. */
  resolution: "DAILY" | "INTRADAY_5M";
  /** Minimum daily bars — every family needs daily context even when it trades intraday. */
  minDailyBars: number;
  /**
   * Minimum QUALIFIED 5-minute sessions; null for daily-only families. Qualified means COMPLETE
   * (>= SESSION_COMPLETE_SHARE of a full day's bars), not merely present — forty half-empty days
   * are not forty tradable days.
   */
  minIntradaySessions: number | null;
  /**
   * True when the family measures something in the opening window (ORB's range, RVOL's early
   * participation). Those families additionally require sessions whose opening window is
   * actually populated — a session missing its first bars is useless to them however complete
   * the rest of the day is.
   */
  requiresOpeningWindow?: boolean;
  /** Why these numbers — stated so a threshold can never become a magic number. */
  basis: string;
}

export interface FamilyReadinessRow {
  familyId: string;
  name: string;
  requirement: FamilyDataRequirement;
  /** Main-board instruments meeting THIS family's requirement. */
  ready: number;
  /** Instruments that would be ready but for their intraday history (the actionable gap). */
  blockedOnIntraday: number;
  /** Instruments short of the family's daily-history requirement. */
  blockedOnDaily: number;
  /** Ready as a share of the tradable research universe. */
  coveragePct: number;
  /** The instruments themselves, capped — the worklist an ingestion planner can act on. */
  readyInstruments: string[];
}

/**
 * The intraday backfill queue (owner directive, 2026-08-16): instruments that are DAILY-READY,
 * missing ONLY their 5-minute sessions, and inside the campaign's tradable universe — worked
 * before intraday history is expanded indiscriminately across 2,122 main-board equities.
 *
 * The rate discipline is deliberately UNCHANGED: the accumulator still visits a small fixed
 * number of instruments per session (the past rate-limiting incident recorded at its call site
 * is why). This changes WHICH instruments those are, not how many.
 *
 * ## REPRESENTATIVENESS FIRST (owner correction, 2026-08-16 04:00)
 *
 * Closest-to-ready alone was not sufficient: the first live gate evaluation found all six
 * ORB-ready instruments sitting in the HIGH liquidity bucket, and a queue ordered purely by
 * proximity would have kept feeding that bias — producing a large sample that measures
 * large-cap liquidity rather than the hypothesis. So the ordering now prefers instruments from
 * UNDER-REPRESENTED strata (liquidity bucket first, then sector once classification exists),
 * and only then by proximity.
 *
 * This does NOT modify the statistical gate. It improves the data ACQUISITION planner so the
 * sampling requirement the gate already pins can actually be satisfied. It is deterministic and
 * tested — never a model's choice.
 */
export interface IntradayQueueStrata {
  /** Current ready-set counts per liquidity bucket, so deficits can be preferred. */
  liquidityByInstrument?: Map<string, string>;
  readyLiquidityCounts?: Map<string, number>;
  /** Same for sectors, once classification is ingested. */
  sectorByInstrument?: Map<string, string>;
  readySectorCounts?: Map<string, number>;
}

export function intradayBackfillQueue(
  families: readonly { dataRequirement: FamilyDataRequirement }[],
  report: UniverseCoverageReport = universeCoverage(),
  limit = 12,
  strata: IntradayQueueStrata = {},
): { instrumentId: string; dailyBars: number; fiveMinuteSessions: number; needed: number; stratum: string }[] {
  const sessionsNeeded = families
    .map((family) => family.dataRequirement.minIntradaySessions)
    .filter((sessions): sessions is number => sessions !== null);
  if (sessionsNeeded.length === 0) return [];
  // The easiest bar to clear first: an instrument that satisfies the least demanding intraday
  // family has already become useful to the campaign.
  const target = Math.min(...sessionsNeeded);
  const minDaily = Math.min(
    ...families
      .filter((family) => family.dataRequirement.minIntradaySessions !== null)
      .map((family) => family.dataRequirement.minDailyBars),
  );

  const candidates = report.securities.filter(
    (security) =>
      security.tier === "MAIN_BOARD" &&
      security.dailyBars >= minDaily &&
      security.completeFiveMinuteSessions < target,
  );

  // Deficit = how under-represented a candidate's stratum currently is in the ready set. A
  // candidate from a stratum with NOTHING in it outranks one from a crowded stratum, however
  // close the crowded one is to the bar.
  const liquidityCounts = strata.readyLiquidityCounts ?? new Map<string, number>();
  const sectorCounts = strata.readySectorCounts ?? new Map<string, number>();
  const deficitOf = (security: (typeof candidates)[number]): { score: number; label: string } => {
    const bucket = strata.liquidityByInstrument?.get(security.instrumentId);
    const sector = strata.sectorByInstrument?.get(security.instrumentId);
    // Lower count = larger deficit = better. Unknown stratum sorts last among known ones, since
    // a candidate whose stratum cannot be determined cannot be shown to reduce a deficit.
    const liquidityDeficit = bucket === undefined ? Number.MAX_SAFE_INTEGER : (liquidityCounts.get(bucket) ?? 0);
    const sectorDeficit = sector === undefined ? Number.MAX_SAFE_INTEGER : (sectorCounts.get(sector) ?? 0);
    const parts = [bucket ?? "liquidity:unknown", sector ?? "sector:unclassified"];
    return { score: liquidityDeficit * 1_000_000 + sectorDeficit, label: parts.join(" · ") };
  };

  return candidates
    .map((security) => ({ security, deficit: deficitOf(security) }))
    .sort(
      (a, b) =>
        // 1. the most under-represented stratum first (liquidity dominates, then sector);
        a.deficit.score - b.deficit.score ||
        // 2. then closest to clearing the bar;
        b.security.completeFiveMinuteSessions - a.security.completeFiveMinuteSessions ||
        // 3. then a stable, deterministic tiebreak.
        a.security.symbol.localeCompare(b.security.symbol),
    )
    .slice(0, Math.max(0, limit))
    .map(({ security, deficit }) => ({
      instrumentId: security.instrumentId,
      dailyBars: security.dailyBars,
      fiveMinuteSessions: security.completeFiveMinuteSessions,
      needed: target - security.completeFiveMinuteSessions,
      stratum: deficit.label,
    }));
}

/**
 * The quality ladder, applied: DATA PRESENT → SESSION COMPLETE → QUALITY PASS → FAMILY READY.
 * A family is ready on an instrument only at the top of that ladder, and each family declares
 * which rung it needs.
 */
export function meetsRequirement(security: SecurityCoverage, requirement: FamilyDataRequirement): boolean {
  if (security.dailyBars < requirement.minDailyBars) return false;
  if (requirement.minIntradaySessions === null) return true;
  const qualified = requirement.requiresOpeningWindow
    ? security.openingWindowSessions
    : security.completeFiveMinuteSessions;
  return qualified >= requirement.minIntradaySessions;
}

/**
 * Per-family readiness over the tradable research universe (main board only — SME and the other
 * segregated tiers are separate universes and are never counted into a campaign's pool).
 */
export function familyReadiness(
  families: readonly { familyId: string; name: string; dataRequirement: FamilyDataRequirement }[],
  report: UniverseCoverageReport = universeCoverage(),
  sampleLimit = 25,
): FamilyReadinessRow[] {
  const mainBoard = report.securities.filter((security) => security.tier === "MAIN_BOARD");

  return families.map((family) => {
    const requirement = family.dataRequirement;
    const ready = mainBoard.filter((security) => meetsRequirement(security, requirement));
    const dailyOk = mainBoard.filter((security) => security.dailyBars >= requirement.minDailyBars);
    const blockedOnIntraday =
      requirement.minIntradaySessions === null ? 0 : dailyOk.length - ready.length;

    return {
      familyId: family.familyId,
      name: family.name,
      requirement,
      ready: ready.length,
      blockedOnIntraday,
      blockedOnDaily: mainBoard.length - dailyOk.length,
      coveragePct:
        mainBoard.length === 0 ? 0 : Math.round((ready.length / mainBoard.length) * 1000) / 10,
      readyInstruments: ready.slice(0, sampleLimit).map((security) => security.instrumentId),
    };
  });
}
