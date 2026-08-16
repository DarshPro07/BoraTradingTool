import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { currentSectorByInstrument } from "@/lib/market/sector-classification";
import { familyReadiness, type FamilyDataRequirement } from "@/lib/market/family-readiness";
import { universeCoverage, type SecurityCoverage, type UniverseCoverageReport } from "@/lib/market/universe-coverage";
import { standings as realStandings, type Standing } from "@/lib/strategy/promotion";

/**
 * The trial-activation gate for NSE-QC-001 — PRE-REGISTERED (owner directive, 2026-08-16).
 *
 * ## Why this is declared now, before any family looks good
 *
 * Deciding when to start spending permanent statistical trials AFTER seeing which families look
 * promising is the selection bias the whole campaign apparatus exists to prevent — it is the
 * same error as widening a search box after a disappointing result, moved one level up. So the
 * criteria are written and hashed while every intraday family sits at single-digit readiness and
 * nothing has been tested, exactly as a trial protocol is registered before enrolment.
 *
 * `activationCriteriaHash()` pins this declaration the way `familyDeclarationHash` pins a family:
 * the recorded hash is evidence of WHEN the rule was fixed. Changing a threshold changes the
 * hash, which is the visible, arguable act it should be — not a silent edit.
 *
 * ## Why it is not "coverage > 10% → ON"
 *
 * A smaller but sector- and liquidity-diverse sample is scientifically more useful than a larger
 * concentrated one: a cross-section of thirty names drawn from one sector measures that sector,
 * not the hypothesis. So breadth, representativeness and a real candidate pool are separate
 * conjunctive criteria, and every one of them must hold.
 *
 * ## Fails closed
 *
 * A criterion the system cannot MEASURE is not satisfied. Sector representation is exactly that
 * today — the NSE master this deployment syncs carries series and asset type but no industry
 * classification, and the `stocks` table that has the columns holds no rows. The gate therefore
 * reports UNMEASURABLE and stays shut, naming the ingestion that would open it. Inventing a
 * sector map to make a gate pass would be the most expensive kind of convenience.
 */

export interface ActivationCriteria {
  /** Qualified instruments each INTRADAY family needs before its trials mean anything. */
  minReadyPerIntradayFamily: number;
  /** Qualified instruments each DAILY family needs. */
  minReadyPerDailyFamily: number;
  /** Distinct liquidity buckets the ready set must span, per family. */
  minLiquidityBuckets: number;
  /** Distinct sectors the ready set must span, per family. */
  minSectors: number;
  /**
   * How much of a family's ready set must actually BE classified before its sector diversity can
   * be believed. "7 distinct sectors" over a ready set where 42 of 60 instruments are unclassified
   * is not evidence of diversity — it is evidence about the 18 that happen to be known.
   *
   * AMENDMENT, 2026-08-16 10:56 IST (owner-authorized), recorded rather than slipped in: this
   * field did not exist in the original pre-registration and its addition CHANGES the criteria
   * hash. It is legitimate because (a) it was made before a single statistical trial was spent,
   * (b) it strictly TIGHTENS the bar — no criterion becomes easier to satisfy — and (c) both
   * hashes are recorded in docs/plans/nse-qc-001/03-trial-activation-gate.md. Loosening after
   * seeing results would be a different act entirely and remains forbidden.
   */
  minSectorClassificationCoverage: number;
  /** Strategies standing ready to spend a trial (blockedOn === "gauntlet"), campaign-wide. */
  minReadyForGauntlet: number;
  /** Why each number is what it is — no threshold without its reason. */
  basis: string;
}

export const NSE_QC_001_ACTIVATION: ActivationCriteria = {
  minReadyPerIntradayFamily: 60,
  minReadyPerDailyFamily: 150,
  minLiquidityBuckets: 3,
  minSectors: 5,
  minSectorClassificationCoverage: 0.8,
  minReadyForGauntlet: 10,
  basis:
    "Intraday: 60 instruments is the smallest cross-section over which a per-instrument intraday " +
    "edge can be told from a handful of lucky names, and it is ~3% of the main board rather than " +
    "an arbitrary round percentage. Daily: 150, higher because cross-sectional momentum RANKS its " +
    "universe — a ranking over a thin universe measures the universe, not the signal. Liquidity: " +
    "all three buckets, because an edge that exists only in the most liquid tercile is a " +
    "different claim from a market-wide one and must not be able to masquerade as one. Sectors: " +
    "5 distinct sectors, so no single sector's regime can carry a family's result — and at least " +
    "80% of the ready set must be CLASSIFIED before that diversity is believed, because a sector " +
    "count over a mostly-unclassified sample describes the classified minority rather than the " +
    "sample. Pool: 10 " +
    "strategies standing ready to spend a trial, so the first trials are drawn from a real " +
    "candidate set rather than being whatever happened to compile first.",
};

/** The pin: a stable hash over the declared criteria, so a later edit is visible as an edit. */
export function activationCriteriaHash(criteria: ActivationCriteria = NSE_QC_001_ACTIVATION): string {
  const canonical = JSON.stringify([
    criteria.minReadyPerIntradayFamily,
    criteria.minReadyPerDailyFamily,
    criteria.minLiquidityBuckets,
    criteria.minSectors,
    criteria.minSectorClassificationCoverage,
    criteria.minReadyForGauntlet,
    // The bucket definitions are part of what was pre-registered: "3 of 3 buckets" means nothing
    // without the floors that define a bucket.
    LIQUIDITY_BUCKETS_VERSION,
    LIQUIDITY_BUCKET_FLOORS,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

export type CriterionState = "SATISFIED" | "NOT_SATISFIED" | "UNMEASURABLE";

export interface CriterionResult {
  criterion: string;
  state: CriterionState;
  detail: string;
}

export interface FamilyActivationResult {
  familyId: string;
  name: string;
  ready: number;
  required: number;
  liquidityBuckets: number;
  sectors: number | null;
  /** How many of the ready set carry a verified sector — the prerequisite beneath diversity. */
  classifiedReady: number;
  criteria: CriterionResult[];
  satisfied: boolean;
}

export interface TrialActivationDecision {
  /** The declared switch state, read from the environment — never inferred. */
  switchOn: boolean;
  /** Whether the pre-registered criteria are ALL satisfied. Independent of the switch. */
  criteriaSatisfied: boolean;
  criteriaHash: string;
  families: FamilyActivationResult[];
  poolCriterion: CriterionResult;
  readyForGauntlet: number;
  /** One line a reader can act on. */
  headline: string;
  /** Every unsatisfied criterion, in the order a reader should attack them. */
  blockers: string[];
}

/**
 * Liquidity buckets from the data this deployment actually holds: median daily traded value
 * (close × volume) over the stored history, split at FIXED rupee thresholds rather than at
 * quantiles of the ready set — a quantile split would always report three buckets and could
 * never fail, which would make the criterion decorative.
 *
 * VERSIONED and effective-dated, because liquidity regimes drift over years: ₹1cr of median
 * daily turnover means something different a decade from now, and a threshold that silently
 * changes meaning is the same failure mode as a silently changed gate. The version is part of
 * the campaign's pinned criteria (see `activationCriteriaHash`), so moving a floor is a visible
 * act rather than a quiet redefinition of what "diverse" meant.
 */
export const LIQUIDITY_BUCKETS_VERSION = "liquidity-buckets-2026-08-16";
/** HIGH ≥ ₹10cr median daily turnover; MEDIUM ≥ ₹1cr; LOW below. */
export const LIQUIDITY_BUCKET_FLOORS = [100_000_000, 10_000_000] as const;

export function liquidityBucketOf(medianTurnover: number | null): "HIGH" | "MEDIUM" | "LOW" | null {
  if (medianTurnover === null) return null;
  if (medianTurnover >= LIQUIDITY_BUCKET_FLOORS[0]) return "HIGH";
  if (medianTurnover >= LIQUIDITY_BUCKET_FLOORS[1]) return "MEDIUM";
  return "LOW";
}

/**
 * Median daily turnover (close × volume) per instrument.
 *
 * Computed IN SQLITE with a window function rather than by pulling every daily bar into JS: the
 * naive version scanned ~77k rows on every /brain render and was half of an 11-second server
 * render. The median itself is unchanged — for an even bar count it averages the two middle
 * values, which is what the JS version did by taking the upper middle only for odd counts.
 */
export function medianTurnoverByInstrument(): Map<string, number> {
  const rows = getDb()
    .all<{ ticker: string; median: number }>(sql`
      SELECT ticker, AVG(turnover) AS median FROM (
        SELECT ticker,
               close * volume AS turnover,
               ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY close * volume) AS rn,
               COUNT(*) OVER (PARTITION BY ticker) AS n
        FROM price_candles
        WHERE resolution = 'D' AND volume IS NOT NULL
      )
      WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
      GROUP BY ticker
    `);
  return new Map(rows.filter((row) => row.median !== null).map((row) => [row.ticker, Number(row.median)]));
}

/**
 * Sector classification, if this deployment holds any.
 *
 * Reads the effective-dated `sector_classifications` ledger (NSE index-constituent Industry
 * column, ISIN-verified — see `lib/market/sector-classification.ts`). Returns null when nothing
 * is ingested, and the gate treats null as UNMEASURABLE: it stays shut rather than passing a
 * criterion it cannot evaluate.
 */
export function sectorByInstrument(): Map<string, string> | null {
  return currentSectorByInstrument();
}

export function evaluateTrialActivation(
  families: readonly { familyId: string; name: string; dataRequirement: FamilyDataRequirement }[],
  criteria: ActivationCriteria = NSE_QC_001_ACTIVATION,
  deps: {
    report?: UniverseCoverageReport;
    standings?: () => Standing[];
    /** Only the one switch is read; a narrow shape keeps tests from faking a whole environment. */
    env?: { MARKETPULSE_AUTONOMOUS_TRIALS?: string };
  } = {},
): TrialActivationDecision {
  const report = deps.report ?? universeCoverage();
  const env = deps.env ?? process.env;
  const ladder = (deps.standings ?? realStandings)();

  const turnover = medianTurnoverByInstrument();
  const sectors = sectorByInstrument();
  const byInstrument = new Map(report.securities.map((security) => [security.instrumentId, security]));

  // The candidate pool: strategies whose very next act would spend a trial.
  const readyForGauntlet = ladder.filter((standing) => standing.blockedOn === "gauntlet").length;
  const poolCriterion: CriterionResult = {
    criterion: "READY_FOR_GAUNTLET pool",
    state: readyForGauntlet >= criteria.minReadyForGauntlet ? "SATISFIED" : "NOT_SATISFIED",
    detail: `${readyForGauntlet} strategy(ies) standing ready to spend a trial; ${criteria.minReadyForGauntlet} required`,
  };

  const readinessRows = familyReadiness(families, report, 5000);
  const familyResults: FamilyActivationResult[] = readinessRows.map((row) => {
    const intraday = row.requirement.resolution === "INTRADAY_5M";
    const required = intraday ? criteria.minReadyPerIntradayFamily : criteria.minReadyPerDailyFamily;

    const readySecurities = row.readyInstruments
      .map((instrumentId) => byInstrument.get(instrumentId))
      .filter((security): security is SecurityCoverage => security !== undefined);

    const buckets = new Set(
      readySecurities
        .map((security) => liquidityBucketOf(turnover.get(security.instrumentId) ?? null))
        .filter((bucket): bucket is "HIGH" | "MEDIUM" | "LOW" => bucket !== null),
    );
    const classifiedReady =
      sectors === null
        ? 0
        : readySecurities.filter((security) => sectors.get(security.instrumentId) !== undefined).length;
    const familySectors =
      sectors === null
        ? null
        : new Set(
            readySecurities
              .map((security) => sectors.get(security.instrumentId))
              .filter((sector): sector is string => sector !== undefined),
          ).size;
    const classificationCoverage =
      readySecurities.length === 0 ? 0 : classifiedReady / readySecurities.length;

    const results: CriterionResult[] = [
      {
        criterion: "family-ready breadth",
        state: row.ready >= required ? "SATISFIED" : "NOT_SATISFIED",
        detail: `${row.ready} qualified instrument(s); ${required} required`,
      },
      {
        criterion: "liquidity representation",
        state:
          buckets.size >= criteria.minLiquidityBuckets
            ? "SATISFIED"
            : readySecurities.length === 0
              ? "NOT_SATISFIED"
              : "NOT_SATISFIED",
        detail: `${buckets.size} of ${criteria.minLiquidityBuckets} liquidity bucket(s) represented${buckets.size > 0 ? ` (${[...buckets].join(", ")})` : ""}`,
      },
      {
        criterion: "sector representation",
        // Coverage is a PREREQUISITE beneath diversity: a sector count over a mostly-unclassified
        // ready set is not a measurement of that set, so it reads UNMEASURABLE rather than
        // passing on the classified minority.
        state:
          familySectors === null
            ? "UNMEASURABLE"
            : classificationCoverage < criteria.minSectorClassificationCoverage
              ? "UNMEASURABLE"
              : familySectors >= criteria.minSectors
                ? "SATISFIED"
                : "NOT_SATISFIED",
        detail:
          familySectors === null
            ? "no sector classification is ingested, so this criterion cannot be evaluated and " +
              "the gate stays shut. Run scripts/ingest-nse-sectors.mts."
            : classificationCoverage < criteria.minSectorClassificationCoverage
              ? `only ${classifiedReady} of ${readySecurities.length} ready instrument(s) are ` +
                `classified (${Math.round(classificationCoverage * 100)}%, ` +
                `${Math.round(criteria.minSectorClassificationCoverage * 100)}% required) — ` +
                `${familySectors} sector(s) seen, but a count over a mostly-unclassified set ` +
                "describes the classified minority, not the set"
              : `${familySectors} of ${criteria.minSectors} sector(s) represented across ` +
                `${classifiedReady}/${readySecurities.length} classified`,
      },
    ];

    return {
      familyId: row.familyId,
      name: row.name,
      ready: row.ready,
      required,
      liquidityBuckets: buckets.size,
      sectors: familySectors,
      classifiedReady,
      criteria: results,
      satisfied: results.every((result) => result.state === "SATISFIED"),
    };
  });

  const criteriaSatisfied =
    poolCriterion.state === "SATISFIED" && familyResults.every((family) => family.satisfied);
  const switchOn = env.MARKETPULSE_AUTONOMOUS_TRIALS === "1";

  const blockers: string[] = [];
  if (poolCriterion.state !== "SATISFIED") blockers.push(`pool: ${poolCriterion.detail}`);
  for (const family of familyResults) {
    for (const result of family.criteria) {
      if (result.state !== "SATISFIED") blockers.push(`${family.name} — ${result.criterion}: ${result.detail}`);
    }
  }

  return {
    switchOn,
    criteriaSatisfied,
    criteriaHash: activationCriteriaHash(criteria),
    families: familyResults,
    poolCriterion,
    readyForGauntlet,
    headline: switchOn
      ? criteriaSatisfied
        ? "ON — the pre-registered criteria are satisfied and the owner's switch is set."
        : "ON BY SWITCH while the pre-registered criteria are NOT satisfied — the owner overrode the gate."
      : criteriaSatisfied
        ? "OFF — the pre-registered criteria are now satisfied; enabling remains the owner's act."
        : "OFF — the pre-registered criteria are not satisfied.",
    blockers,
  };
}

/**
 * The strata the intraday planner needs to prefer under-represented buckets and sectors: what
 * each candidate IS, and how crowded that stratum already is among family-ready instruments.
 *
 * Lives here rather than in the planner because the definitions must be the SAME ones the gate
 * measures against — a planner filling buckets by one definition while the gate counts them by
 * another would chase a target it can never hit.
 */
export function intradayQueueStrata(report: UniverseCoverageReport = universeCoverage()): {
  liquidityByInstrument: Map<string, string>;
  readyLiquidityCounts: Map<string, number>;
  sectorByInstrument?: Map<string, string>;
  readySectorCounts?: Map<string, number>;
} {
  const turnover = medianTurnoverByInstrument();
  const sectors = sectorByInstrument();

  const liquidityByInstrument = new Map<string, string>();
  for (const security of report.securities) {
    const bucket = liquidityBucketOf(turnover.get(security.instrumentId) ?? null);
    if (bucket !== null) liquidityByInstrument.set(security.instrumentId, bucket);
  }

  // "Crowded" is measured over instruments that ALREADY have usable intraday history — those are
  // what a family's ready set is drawn from, so those are the counts a deficit is relative to.
  const readyLiquidityCounts = new Map<string, number>();
  const readySectorCounts = new Map<string, number>();
  for (const security of report.securities) {
    if (security.tier !== "MAIN_BOARD" || security.completeFiveMinuteSessions === 0) continue;
    const bucket = liquidityByInstrument.get(security.instrumentId);
    if (bucket) readyLiquidityCounts.set(bucket, (readyLiquidityCounts.get(bucket) ?? 0) + 1);
    const sector = sectors?.get(security.instrumentId);
    if (sector) readySectorCounts.set(sector, (readySectorCounts.get(sector) ?? 0) + 1);
  }

  return {
    liquidityByInstrument,
    readyLiquidityCounts,
    ...(sectors ? { sectorByInstrument: sectors, readySectorCounts } : {}),
  };
}
