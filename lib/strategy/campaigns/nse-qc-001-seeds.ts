import type { StrategyDsl } from "@/lib/strategy/dsl";
import type { CrossSectionalStrategy } from "@/lib/backtest/cross-sectional";

/**
 * One canonical seed per declared NSE-QC-001 family.
 *
 * ## Why seeds have to exist at all
 *
 * `lib/factory/generation.ts` is a BREEDER, not an author: it selects a parent, mutates within
 * the parent's declared variant dimensions, and has the descendant inherit the parent's family.
 * It refuses to invent a family for a machine-generated rule, and it is right to — inventing one
 * is how a search box gets silently widened.
 *
 * The consequence, measured 2026-08-16: all five declared families held **zero** specs, so the
 * campaign could never begin. A family with no parent can never receive a descendant, and no
 * amount of autonomous work changes that. The seed is the one thing only an author can supply.
 *
 * ## What a seed is, and what it is not
 *
 * It is the family's mechanism written once, in the middle of the declared variant space —
 * deliberately not tuned, because tuning before the search is the selection bias the campaign
 * apparatus exists to prevent. Every parameter below sits inside its family's
 * `allowedVariantDimensions`, and where a dimension gives a range the seed takes a value near its
 * centre rather than its most flattering end.
 *
 * It is NOT a prediction that the family works. `0 survivors + typed rejection` is a successful
 * campaign outcome, and these seeds exist so that outcome can be *measured* rather than assumed.
 *
 * ## Session arithmetic
 *
 * NSE opens at 09:15 IST, so `minutes_since_open` counts from there: the 14:30 entry cutoff every
 * intraday family declares is minute **315**, and the 11:00 start of the midday window is minute
 * **105**. `OPENING_RANGE_MINUTES` is 15, inside the ORB family's declared 5m–60m range window.
 *
 * ## Cross-sectional momentum is absent on purpose
 *
 * `fam_qc001_xsec_momentum` declares "rank the eligible universe → hold the top N". That is a
 * universe-level operation, and the DSL is per-instrument by construction. Forcing it into a
 * boolean per-symbol condition would be a materially different and much looser strategy than the
 * one declared, so it is left un-seeded and named rather than approximated.
 */

/** Minutes after the 09:15 open at which no new intraday entry may be taken (14:30 IST). */
export const ENTRY_CUTOFF_MINUTE = 315;
/** Minutes after the open at which the midday window opens (11:00 IST). */
export const MIDDAY_START_MINUTE = 105;

export interface FamilySeed {
  familyId: string;
  /** Why each declared dimension took the value it did. */
  rationale: string;
  dsl: StrategyDsl;
}

export const NSE_QC_001_SEEDS: readonly FamilySeed[] = [
  {
    familyId: "fam_qc001_orb",
    rationale:
      "range_window 15m (declared 5m-60m, and the engine's own opening-range window); " +
      "confirmation close-beyond with rvol 1.5x (declared 1.0-3.0x, centre); " +
      "stop = opposite side of the range (declared alternative to an ATR stop); " +
      "target = time exit at 24 bars = 2 hours (declared '1R-3R or time exit'); " +
      "entry cutoff 14:30 IST as declared.",
    dsl: {
      name: "qc001_orb_seed",
      description:
        "Opening-range breakout seed for NSE-QC-001. Enters a close beyond the first 15 minutes' " +
        "high on above-average volume, exits on the opposite side of the range, a hard stop, or " +
        "time. No overnight exposure — the broker's mandatory intraday flat binds regardless.",
      universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
      entry: {
        all: [
          { compare: ["close", "opening_range_high"], op: "gt" },
          { feature: "minutes_since_open", op: "gte", value: 15 },
          { feature: "minutes_since_open", op: "lte", value: ENTRY_CUTOFF_MINUTE },
          { feature: "rvol", op: "gte", value: 1.5 },
        ],
      },
      exit: {
        condition: { compare: ["close", "opening_range_low"], op: "lt" },
        afterDays: 24,
        stopLossPct: 0.8,
        takeProfitPct: 1.6,
      },
      sizing: { maxPositionPct: 20 },
      costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
    } as StrategyDsl,
  },
  {
    familyId: "fam_qc001_rvol_breakout",
    rationale:
      "rvol_threshold 2.5x (declared 1.5-5x, centre); reference_level = 20-bar extreme " +
      "(declared 'N-bar high/low, N in 20-78'); target/stop as a 1R-2R pair; " +
      "entry cutoff 14:30 IST as declared.",
    dsl: {
      name: "qc001_rvol_breakout_seed",
      description:
        "Relative-volume breakout seed for NSE-QC-001. Requires abnormal volume AND a break of " +
        "the trailing 20-bar high, so an ordinary break on ordinary volume does not qualify.",
      universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
      entry: {
        all: [
          { feature: "rvol", op: "gte", value: 2.5 },
          { compare: ["close", "high_20d"], op: "gt" },
          { feature: "minutes_since_open", op: "lte", value: ENTRY_CUTOFF_MINUTE },
        ],
      },
      exit: { afterDays: 24, stopLossPct: 0.8, takeProfitPct: 1.6 },
      sizing: { maxPositionPct: 20 },
      costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
    } as StrategyDsl,
  },
  {
    familyId: "fam_qc001_intraday_mr",
    rationale:
      "stretch 2.0 ATR below sma20 (declared 1.5-3.0 ATR from VWAP/SMA, centre); " +
      "rvol ceiling 2.0x (declared 1.5-2.5x, centre) — the fade is of UNINFORMED pressure, so " +
      "abnormal volume disqualifies; window 11:00-14:30 IST as declared; " +
      "target = mean touch; max_hold 24 bars = 120 minutes (declared 30m-120m).",
    dsl: {
      name: "qc001_intraday_mr_seed",
      description:
        "Midday mean-reversion seed for NSE-QC-001. Fades a stretch away from the short mean " +
        "measured in ATR units, only when volume is NOT abnormal, and only away from the opening " +
        "and closing auctions.",
      universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
      entry: {
        all: [
          { feature: "atr_stretch_sma20", op: "lte", value: -2 },
          { feature: "rvol", op: "lte", value: 2 },
          { feature: "minutes_since_open", op: "gte", value: MIDDAY_START_MINUTE },
          { feature: "minutes_since_open", op: "lte", value: ENTRY_CUTOFF_MINUTE },
        ],
      },
      exit: {
        condition: { feature: "atr_stretch_sma20", op: "gte", value: 0 },
        afterDays: 24,
        stopLossPct: 0.7,
      },
      sizing: { maxPositionPct: 20 },
      costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
    } as StrategyDsl,
  },
  {
    familyId: "fam_qc001_swing_mr",
    rationale:
      "drop_trigger = 5-day return below -2.0x its own 20-day volatility (declared " +
      "'3-10 day return below -(1.5-3.0) x 20-day volatility', both centres); " +
      "trend_filter close above sma200 (declared 100-200 day SMA); " +
      "target = 20-day SMA touch (declared '10-20 day SMA touch'); max_hold 10 sessions " +
      "(declared 2-10).",
    dsl: {
      name: "qc001_swing_mr_seed",
      description:
        "Oversold snap-back seed for NSE-QC-001. Requires a multi-day drop large relative to the " +
        "instrument's OWN volatility — so one threshold means the same thing across a quiet " +
        "large-cap and a violent small-cap — while the long trend remains intact.",
      universe: { market: "NSE", maxPositions: 8, resolution: "D" },
      entry: {
        all: [
          { feature: "return_5d_in_vol", op: "lte", value: -2 },
          { compare: ["close", "sma200"], op: "gt" },
        ],
      },
      exit: {
        condition: { compare: ["close", "sma20"], op: "gte" },
        afterDays: 10,
        stopLossPct: 6,
      },
      sizing: { maxPositionPct: 12 },
      costs: { commissionBps: 5, slippageBps: 10, assumedSpreadBps: 8 },
    } as StrategyDsl,
  },
];

/**
 * The cross-sectional seed, which is not a `StrategyDsl` because it cannot be one.
 *
 * `fam_qc001_xsec_momentum` declares a ranking over the universe, and the DSL's conditions are
 * per-instrument booleans — a statement about one symbol, never about its position relative to the
 * others at the same instant. So this family is expressed in `CrossSectionalStrategy`
 * (`lib/backtest/cross-sectional.ts`), a small typed IR whose every field maps to a dimension the
 * pinned contract already names. It is not a second DSL and has no knob the contract does not.
 *
 * Values sit near the centre of each declared range, for the same reason as the others: tuning
 * before the search is the selection bias the campaign exists to prevent.
 */
export const NSE_QC_001_XSEC_SEED: { familyId: string; rationale: string; strategy: CrossSectionalStrategy } = {
  familyId: "fam_qc001_xsec_momentum",
  rationale:
    "lookback 60 trading days (declared 20-120, centre — and the classic three-month formation " +
    "period); skip_recent 2 days (declared 0-5, the family's own guard against short-term " +
    "reversal contaminating the rank); top_n 10 names (declared 5-20, centre); rebalance every 7 " +
    "trading days (declared 5-10, centre); ranking raw return (a declared option, and the simpler " +
    "of the two); regime_filter none (a declared option — the filter is optional, so the seed " +
    "takes the plainer form and leaves the filter to the variant space).",
  strategy: {
    name: "qc001_xsec_momentum_seed",
    description:
      "Cross-sectional momentum seed for NSE-QC-001. Ranks the eligible universe by 60-day " +
      "return skipping the most recent 2 days, holds the top 10 as delivery positions, and " +
      "rotates every 7 trading days.",
    universe: { market: "NSE", resolution: "D" },
    lookbackDays: 60,
    skipRecentDays: 2,
    ranking: "RAW_RETURN",
    direction: "TOP",
    topN: 10,
    rebalanceDays: 7,
    sizing: { maxPositionPct: 10 },
    costs: { commissionBps: 5, slippageBps: 10, assumedSpreadBps: 8 },
  },
};

/**
 * Families this file deliberately does not seed as a spec, and why.
 *
 * Kept as data rather than prose so a reader can see the gap is CHOSEN, and so a test can assert
 * that every declared family is either seeded or listed here — the two together must cover all
 * five, or a family has been forgotten rather than deferred.
 *
 * The cross-sectional family is now EXECUTABLE (`NSE_QC_001_XSEC_SEED` runs on the engine above),
 * but it is not yet stored as a `strategy_specs` row: the spec lifecycle — cost gate, rehearsal,
 * stage ladder — is written against `StrategyDsl`, and filing an IR into that column would have
 * every downstream reader misparse it. Executability and lifecycle integration are separate steps,
 * and conflating them is how a half-wired strategy comes to look validated.
 */
export const UNSEEDED_FAMILIES: Readonly<Record<string, string>> = Object.freeze({
  fam_qc001_xsec_momentum:
    "executable via NSE_QC_001_XSEC_SEED on the cross-sectional engine, but not yet filed as a " +
    "strategy_specs row: the spec lifecycle (cost gate, rehearsal, stage ladder) is written " +
    "against StrategyDsl, and storing a cross-sectional IR in that column would be misparsed by " +
    "every downstream reader. Lifecycle integration is the next step, and is deliberately not " +
    "half-done.",
});

/**
 * Install the seeds: record each as a strategy spec and place it in its declared family.
 *
 * Idempotent — a seed already present in its family is left alone, so this can run on every boot
 * without duplicating the campaign's population. Returns what it actually did, because "installed
 * 0" is the normal steady state and must not read as a failure.
 *
 * Placement is `SAME_FAMILY` and CONFIRMED: this is not a machine guessing which family a
 * generated rule belongs to, it is an author stating that a hand-written seed implements the
 * mechanism its family declares. That judgement is exactly what the factory refuses to make for
 * itself, and it is why seeds must be authored rather than bred.
 */
export interface SeedInstallReport {
  installed: { familyId: string; specId: string; name: string }[];
  alreadyPresent: string[];
  skipped: { familyId: string; reason: string }[];
}

export async function installCampaignSeeds(
  campaignId = "camp_nse_qc_001",
  actor = "campaign-seed",
): Promise<SeedInstallReport> {
  const { getDb, schema } = await import("@/lib/db");
  const { recordStrategySpec } = await import("@/lib/knowledge/repository");
  const { placeStrategy } = await import("@/lib/strategy/research-identity");

  const report: SeedInstallReport = { installed: [], alreadyPresent: [], skipped: [] };
  const db = getDb();

  const families = new Set(
    db.select().from(schema.strategyFamilies).all().map((row) => row.id),
  );
  const occupied = new Set(
    db.select().from(schema.strategyIdentity).all().map((row) => row.strategyFamilyId),
  );

  for (const seed of NSE_QC_001_SEEDS) {
    if (!families.has(seed.familyId)) {
      report.skipped.push({
        familyId: seed.familyId,
        reason: "family is not registered in this database; register the campaign first",
      });
      continue;
    }
    if (occupied.has(seed.familyId)) {
      report.alreadyPresent.push(seed.familyId);
      continue;
    }
    const specId = recordStrategySpec({ name: seed.dsl.name, dsl: seed.dsl, createdBy: actor });
    const placement = placeStrategy({
      specId,
      campaignId,
      familyId: seed.familyId,
      dsl: seed.dsl,
      classification: "SAME_FAMILY",
      classifiedBy: actor,
      reason: seed.rationale,
      confirmed: true,
    });
    if (!placement.placed) {
      report.skipped.push({ familyId: seed.familyId, reason: placement.reason });
      continue;
    }
    report.installed.push({ familyId: seed.familyId, specId, name: seed.dsl.name });
  }
  return report;
}
