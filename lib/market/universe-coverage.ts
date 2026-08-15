import { isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { MIN_BARS_FOR_RESEARCH } from "@/lib/research/bridge";

/**
 * The NSE universe readiness index (owner directive 2026-08-16): separate the LISTED universe
 * from the TRADABLE RESEARCH universe, and say — per security, with a typed reason — how far
 * its data is from each readiness class. One grouped candle query, never a per-instrument N+1
 * over 3,325 securities.
 *
 * Tier boundaries follow the exchange's own series/asset taxonomy as synced from the five
 * official NSE archives (MAIN/SME/ETF/REIT/INVIT):
 *   MAIN_BOARD              series EQ, assetType EQUITY, LISTED — the NSE-QC research universe
 *   SME                     series SM/ST/SZ — a SEPARATE research universe (liquidity and
 *                           execution differ materially; never silently merged)
 *   SURVEILLANCE_RESTRICTED series BE/BZ — trade-for-trade/surveillance settlement, excluded
 *   ETF / REIT_INVIT        segregated instrument classes
 *   INACTIVE                listingStatus != LISTED
 *   OTHER                   anything the taxonomy does not name — surfaced, never dropped
 *
 * Readiness thresholds are DERIVED, and each carries its basis:
 *   RESEARCH_READY    ≥ MIN_BARS_FOR_RESEARCH daily bars — the research bridge's own refusal floor
 *   BACKTEST_READY    ≥ 250 daily bars — one development year for chronological walk-forward
 *   VALIDATION_READY  ≥ 340 daily bars — development year + ~90-bar holdout-generation window
 *                     (incl. purge/embargo margin); PROVISIONAL until a live holdout definition
 *                     supplies exact bars, and stated as such
 *   INTRADAY_READY    ≥ 20 5m sessions — the campaign's longest rvol baseline. Sessions may
 *                     come from HISTORICAL BACKFILL (Upstox Historical V3 serves minute
 *                     candles from Jan 2022; OpenChart serves 1m-monthly NSE history) or from
 *                     live accumulation — the class counts what the canonical store holds,
 *                     source-blind. (An earlier revision claimed intraday "cannot be
 *                     backfilled"; that was wrong — owner correction 2026-08-16.)
 */

export const BACKTEST_BARS_FLOOR = 250;
export const VALIDATION_BARS_FLOOR = 340;
export const INTRADAY_SESSIONS_FLOOR = 20;

export type UniverseTier =
  | "MAIN_BOARD"
  | "SME"
  | "SURVEILLANCE_RESTRICTED"
  | "ETF"
  | "REIT_INVIT"
  | "INACTIVE"
  | "OTHER";

export type MissingReason =
  | "NO_HISTORY"
  | "INSUFFICIENT_BARS"
  | "INGEST_IN_FLIGHT"
  | "INGEST_COOLING"
  | "INGEST_BLOCKED_PERMANENT";

export interface SecurityCoverage {
  isin: string;
  symbol: string;
  instrumentId: string;
  tier: UniverseTier;
  dailyBars: number;
  fiveMinuteSessions: number;
  researchReady: boolean;
  backtestReady: boolean;
  validationReady: boolean;
  intradayReady: boolean;
  /** Why it is not yet RESEARCH_READY; null once it is. */
  missingReason: MissingReason | null;
}

export interface UniverseCoverageReport {
  generatedBasis: string;
  tiers: Record<UniverseTier, number>;
  mainBoard: {
    total: number;
    researchReady: number;
    backtestReady: number;
    validationReady: number;
    intradayReady: number;
    researchCoveragePct: number;
    validationCoveragePct: number;
    missingReasons: Record<MissingReason, number>;
  };
  /** SME is a separate research universe — reported beside, never merged. */
  sme: { total: number; researchReady: number };
  thresholds: {
    research: number;
    backtest: number;
    validation: number;
    intradaySessions: number;
  };
  securities: SecurityCoverage[];
}

export function tierFor(listing: { series: string; assetType: string; listingStatus: string }): UniverseTier {
  if (listing.listingStatus !== "LISTED") return "INACTIVE";
  if (listing.assetType === "ETF") return "ETF";
  if (listing.assetType === "REIT" || listing.assetType === "INVIT") return "REIT_INVIT";
  if (listing.assetType === "EQUITY") {
    if (listing.series === "EQ") return "MAIN_BOARD";
    if (listing.series === "SM" || listing.series === "ST" || listing.series === "SZ") return "SME";
    if (listing.series === "BE" || listing.series === "BZ") return "SURVEILLANCE_RESTRICTED";
  }
  return "OTHER";
}

/** Ingest-job state per instrument, read from the durable queue by its dedupe key. */
function ingestStates(): Map<string, MissingReason> {
  const db = getDb();
  const states = new Map<string, MissingReason>();
  for (const job of db.select().from(schema.researchJobs).all()) {
    if (job.kind !== "ingest_history" || !job.dedupeKey?.startsWith("ingest-history-")) continue;
    const instrumentId = job.dedupeKey.slice("ingest-history-".length);
    if (job.status === "queued" || job.status === "running" || job.status === "waiting_dependency") {
      states.set(instrumentId, "INGEST_IN_FLIGHT");
    } else if (job.status === "dead") {
      // failureClass lives in the queue module; a permanent marker in lastError is the durable
      // signal it uses. Mirror the coarse split without re-importing the whole worker graph.
      const permanent = /INSTRUMENT_UNKNOWN|PERMANENT|NOT_FOUND/i.test(job.lastError ?? "");
      states.set(instrumentId, permanent ? "INGEST_BLOCKED_PERMANENT" : "INGEST_COOLING");
    }
  }
  return states;
}

export function universeCoverage(): UniverseCoverageReport {
  const db = getDb();

  // Current listings only (effective_to null). One row per ISIN by construction of the sync.
  const listings = db
    .select()
    .from(schema.nseListingVersions)
    .where(isNull(schema.nseListingVersions.effectiveTo))
    .all();

  // ONE pass over the candle store for daily counts and 5m session counts.
  const dailyByTicker = new Map<string, number>();
  const fiveMinSessions = new Map<string, Set<string>>();
  for (const candle of db
    .select({ ticker: schema.priceCandles.ticker, resolution: schema.priceCandles.resolution, time: schema.priceCandles.time })
    .from(schema.priceCandles)
    .all()) {
    if (candle.resolution === "D") {
      dailyByTicker.set(candle.ticker, (dailyByTicker.get(candle.ticker) ?? 0) + 1);
    } else if (candle.resolution === "5") {
      const day = new Date(candle.time * 1000).toISOString().slice(0, 10);
      let sessions = fiveMinSessions.get(candle.ticker);
      if (!sessions) fiveMinSessions.set(candle.ticker, (sessions = new Set()));
      sessions.add(day);
    }
  }

  const ingest = ingestStates();
  const tiers: Record<UniverseTier, number> = {
    MAIN_BOARD: 0,
    SME: 0,
    SURVEILLANCE_RESTRICTED: 0,
    ETF: 0,
    REIT_INVIT: 0,
    INACTIVE: 0,
    OTHER: 0,
  };
  const missingReasons: Record<MissingReason, number> = {
    NO_HISTORY: 0,
    INSUFFICIENT_BARS: 0,
    INGEST_IN_FLIGHT: 0,
    INGEST_COOLING: 0,
    INGEST_BLOCKED_PERMANENT: 0,
  };

  const securities: SecurityCoverage[] = listings.map((listing) => {
    const tier = tierFor(listing);
    tiers[tier] += 1;
    const instrumentId = `IN:XNSE:${listing.symbol}`;
    const dailyBars = dailyByTicker.get(instrumentId) ?? 0;
    const sessions = fiveMinSessions.get(instrumentId)?.size ?? 0;
    const researchReady = dailyBars >= MIN_BARS_FOR_RESEARCH;
    let missingReason: MissingReason | null = null;
    if (!researchReady) {
      missingReason =
        ingest.get(instrumentId) ?? (dailyBars === 0 ? "NO_HISTORY" : "INSUFFICIENT_BARS");
    }
    return {
      isin: listing.isin,
      symbol: listing.symbol,
      instrumentId,
      tier,
      dailyBars,
      fiveMinuteSessions: sessions,
      researchReady,
      backtestReady: dailyBars >= BACKTEST_BARS_FLOOR,
      validationReady: dailyBars >= VALIDATION_BARS_FLOOR,
      intradayReady: sessions >= INTRADAY_SESSIONS_FLOOR,
      missingReason,
    };
  });

  const mainBoard = securities.filter((security) => security.tier === "MAIN_BOARD");
  for (const security of mainBoard) {
    if (security.missingReason) missingReasons[security.missingReason] += 1;
  }
  const sme = securities.filter((security) => security.tier === "SME");
  const pct = (numerator: number, denominator: number) =>
    denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;

  const researchReady = mainBoard.filter((security) => security.researchReady).length;
  const validationReady = mainBoard.filter((security) => security.validationReady).length;

  return {
    generatedBasis:
      "current NSE listing versions (effective rows) × one grouped pass over the canonical candle store",
    tiers,
    mainBoard: {
      total: mainBoard.length,
      researchReady,
      backtestReady: mainBoard.filter((security) => security.backtestReady).length,
      validationReady,
      intradayReady: mainBoard.filter((security) => security.intradayReady).length,
      researchCoveragePct: pct(researchReady, mainBoard.length),
      validationCoveragePct: pct(validationReady, mainBoard.length),
      missingReasons,
    },
    sme: { total: sme.length, researchReady: sme.filter((security) => security.researchReady).length },
    thresholds: {
      research: MIN_BARS_FOR_RESEARCH,
      backtest: BACKTEST_BARS_FLOOR,
      validation: VALIDATION_BARS_FLOOR,
      intradaySessions: INTRADAY_SESSIONS_FLOOR,
    },
    securities,
  };
}

/**
 * The deterministic ingestion worklist (owner's tiers, 2026-08-16): P1 finishes what is
 * started or referenced (partially covered instruments and those an active strategy/challenger
 * names), P2/P3 expand the MAIN BOARD deterministically — liquidity-ranked once volume data
 * exists, symbol order until then (stated). SME/ETF/REIT/surveillance are SEPARATE universes
 * and are never fed from here. Instruments already research-ready or already in flight are
 * skipped; the durable queue's dedupe keys make double-planning harmless anyway.
 */
export interface PlannedIngestion {
  instrumentId: string;
  tier: 1 | 2 | 3;
  reason: string;
}

export function planUniverseIngestion(limit: number, report = universeCoverage()): PlannedIngestion[] {
  const db = getDb();
  const referenced = new Set<string>();
  for (const challenger of db.select().from(schema.forwardChallengers).all()) {
    for (const id of challenger.universe.split(",")) {
      const trimmed = id.trim();
      if (trimmed) referenced.add(trimmed);
    }
  }
  for (const row of db.select({ id: schema.userWatchlist.ticker }).from(schema.userWatchlist).all()) {
    if (row.id) referenced.add(row.id);
  }

  const candidates = report.securities
    .filter(
      (security) =>
        security.tier === "MAIN_BOARD" &&
        !security.researchReady &&
        security.missingReason !== "INGEST_IN_FLIGHT" &&
        security.missingReason !== "INGEST_BLOCKED_PERMANENT",
    )
    .map((security) => {
      const isReferenced = referenced.has(security.instrumentId);
      const partiallyCovered = security.dailyBars > 0;
      const tier: 1 | 2 | 3 = isReferenced || partiallyCovered ? 1 : 2;
      return {
        instrumentId: security.instrumentId,
        tier,
        reason: isReferenced
          ? "referenced by an active strategy/challenger/watchlist"
          : partiallyCovered
            ? `partially covered (${security.dailyBars} bars) — finish what is started`
            : "main-board expansion (deterministic symbol order until volume data can rank liquidity)",
        symbol: security.symbol,
      };
    })
    .sort((a, b) => a.tier - b.tier || a.symbol.localeCompare(b.symbol))
    .slice(0, Math.max(0, limit));

  return candidates.map(({ instrumentId, tier, reason }) => ({ instrumentId, tier, reason }));
}
