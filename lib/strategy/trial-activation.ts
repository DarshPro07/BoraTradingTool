import { createHash } from "node:crypto";
import { getDb, schema } from "@/lib/db";
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
  minReadyForGauntlet: 10,
  basis:
    "Intraday: 60 instruments is the smallest cross-section over which a per-instrument intraday " +
    "edge can be told from a handful of lucky names, and it is ~3% of the main board rather than " +
    "an arbitrary round percentage. Daily: 150, higher because cross-sectional momentum RANKS its " +
    "universe — a ranking over a thin universe measures the universe, not the signal. Liquidity: " +
    "all three buckets, because an edge that exists only in the most liquid tercile is a " +
    "different claim from a market-wide one and must not be able to masquerade as one. Sectors: " +
    "5 distinct sectors, so no single sector's regime can carry a family's result. Pool: 10 " +
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
    criteria.minReadyForGauntlet,
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
 * (close × volume) over the stored history, split at fixed rupee thresholds rather than at
 * quantiles of the ready set — a quantile split would always report three buckets and could
 * never fail, which would make the criterion decorative.
 */
export const LIQUIDITY_BUCKET_FLOORS = [100_000_000, 10_000_000] as const;

export function liquidityBucketOf(medianTurnover: number | null): "HIGH" | "MEDIUM" | "LOW" | null {
  if (medianTurnover === null) return null;
  if (medianTurnover >= LIQUIDITY_BUCKET_FLOORS[0]) return "HIGH";
  if (medianTurnover >= LIQUIDITY_BUCKET_FLOORS[1]) return "MEDIUM";
  return "LOW";
}

/** Median daily turnover per instrument, from the canonical store. Null when unmeasurable. */
export function medianTurnoverByInstrument(): Map<string, number> {
  const db = getDb();
  const byTicker = new Map<string, number[]>();
  for (const candle of db
    .select({ ticker: schema.priceCandles.ticker, resolution: schema.priceCandles.resolution, close: schema.priceCandles.close, volume: schema.priceCandles.volume })
    .from(schema.priceCandles)
    .all()) {
    if (candle.resolution !== "D" || candle.volume === null) continue;
    let values = byTicker.get(candle.ticker);
    if (!values) byTicker.set(candle.ticker, (values = []));
    values.push(candle.close * candle.volume);
  }
  const medians = new Map<string, number>();
  for (const [ticker, values] of byTicker) {
    if (values.length === 0) continue;
    values.sort((a, b) => a - b);
    medians.set(ticker, values[Math.floor(values.length / 2)]);
  }
  return medians;
}

/**
 * Sector classification, if this deployment holds any.
 *
 * Returns null when it does not — which is the case today: the synced NSE master carries series
 * and asset type but no industry classification, and the `stocks` table that has the columns is
 * empty. The gate treats null as UNMEASURABLE and stays shut rather than passing a criterion it
 * cannot evaluate.
 */
export function sectorByInstrument(): Map<string, string> | null {
  const db = getDb();
  const sectors = new Map<string, string>();
  try {
    for (const row of db.select().from(schema.stocks).all()) {
      if (row.sector && row.ticker) sectors.set(row.ticker, row.sector);
    }
  } catch {
    return null;
  }
  return sectors.size > 0 ? sectors : null;
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
    const familySectors =
      sectors === null
        ? null
        : new Set(
            readySecurities
              .map((security) => sectors.get(security.instrumentId))
              .filter((sector): sector is string => sector !== undefined),
          ).size;

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
        state: familySectors === null ? "UNMEASURABLE" : familySectors >= criteria.minSectors ? "SATISFIED" : "NOT_SATISFIED",
        detail:
          familySectors === null
            ? "no sector classification is ingested — the synced NSE master carries series and " +
              "asset type but no industry map, so this criterion cannot be evaluated and the gate " +
              "stays shut. Ingesting NSE's industry classification is the work that opens it."
            : `${familySectors} of ${criteria.minSectors} sector(s) represented`,
      },
    ];

    return {
      familyId: row.familyId,
      name: row.name,
      ready: row.ready,
      required,
      liquidityBuckets: buckets.size,
      sectors: familySectors,
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
