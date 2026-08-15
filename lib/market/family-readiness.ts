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
  /** Minimum accumulated/backfilled 5-minute sessions; null for daily-only families. */
  minIntradaySessions: number | null;
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

export function meetsRequirement(security: SecurityCoverage, requirement: FamilyDataRequirement): boolean {
  if (security.dailyBars < requirement.minDailyBars) return false;
  if (requirement.minIntradaySessions === null) return true;
  return security.fiveMinuteSessions >= requirement.minIntradaySessions;
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
