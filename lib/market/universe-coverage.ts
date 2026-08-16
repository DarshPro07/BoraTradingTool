import { eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { MIN_BARS_FOR_RESEARCH } from "@/lib/research/bridge";
import { sessionCloseMinute, sessionOpenMinute, sessionStamps } from "./calendar";

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
/**
 * How far behind the universe's newest bar an instrument may fall before it counts as stale.
 *
 * Four days spans a weekend plus a public holiday, so a normal market closure never trips it.
 * Measured 2026-08-16: exactly three instruments were behind — RELIANCE, HDFCBANK and TCS, at
 * eight days against a universe that had moved on.
 */
export const STALE_AFTER_SECONDS = 4 * 86_400;

export const INTRADAY_SESSIONS_FLOOR = 20;
/**
 * A session counts as COMPLETE at this share of a full day's bars. Having 40 sessions is not the
 * same as having 40 CLEAN sessions (owner, 2026-08-16), and an instrument whose sessions are
 * half-empty must never read as equal to one with whole days.
 */
export const SESSION_COMPLETE_SHARE = 0.8;
/** The opening window ORB and RVOL measure their range in: the first 30 minutes. */
export const OPENING_WINDOW_MINUTES = 30;
/** Bars required inside that window for the session to carry a usable opening range (5m). */
export const OPENING_WINDOW_MIN_BARS = 5;

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
  /**
   * The quality ladder for intraday coverage — DATA PRESENT is not FAMILY READY.
   * `fiveMinuteSessions`         days holding ANY 5m bar (data present)
   * `completeFiveMinuteSessions` days holding >= SESSION_COMPLETE_SHARE of a full day (complete)
   * `openingWindowSessions`      complete days that also carry a usable opening range (quality
   *                              pass for the families that trade the open)
   */
  fiveMinuteSessions: number;
  completeFiveMinuteSessions: number;
  openingWindowSessions: number;
  /**
   * Enough history to research over. Kept as the name every existing reader uses; `historyReady`
   * is its precise synonym, introduced beside `freshnessReady` so the two dimensions stop being
   * conflated.
   */
  researchReady: boolean;
  /** DEPTH: does it hold enough bars? */
  historyReady: boolean;
  /**
   * CURRENCY: is it keeping up with the rest of the universe?
   *
   * Separate from depth because the planner excluded anything already `researchReady` from its
   * worklist, so an instrument that had enough history could never re-enter the queue and simply
   * went stale — the better covered it was, the sooner it stopped being updated.
   */
  freshnessReady: boolean;
  /** Unix seconds of the newest daily bar. Null when none is held — not 0, which would be 1970. */
  lastDailyBar: number | null;
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

  // Counting happens in SQLite, not in JavaScript. Materialising every candle row to count them
  // made this page's server render 11s at ~100k bars and would have grown with the store; the
  // aggregate returns one row per instrument instead. Only the 5-minute TIMES are pulled, because
  // session geometry genuinely needs per-bar stamps — and only for the instruments that have any.
  const dailyRows = db
    .select({
      ticker: schema.priceCandles.ticker,
      bars: sql<number>`COUNT(*)`,
      lastBar: sql<number>`MAX(${schema.priceCandles.time})`,
    })
    .from(schema.priceCandles)
    .where(eq(schema.priceCandles.resolution, "D"))
    .groupBy(schema.priceCandles.ticker)
    .all();
  const dailyByTicker = new Map<string, number>(dailyRows.map((row) => [row.ticker, Number(row.bars)]));
  const lastBarByTicker = new Map<string, number>(dailyRows.map((row) => [row.ticker, Number(row.lastBar)]));

  /**
   * The freshness reference: the newest daily bar anywhere in the universe.
   *
   * Measured against the universe rather than the wall clock on purpose — holidays, weekends and
   * a paused ingest all move the whole market together, and calling every instrument stale on a
   * public holiday would be a false alarm every few weeks. What matters is falling BEHIND the
   * rest of the market.
   */
  const universeLastBar = dailyRows.reduce((newest, row) => Math.max(newest, Number(row.lastBar)), 0);

  // Session geometry in SQL as well. Stamping every 5-minute bar through Intl.DateTimeFormat was
  // the remaining seconds of this page's render, and it scales the wrong way: the store is
  // deliberately growing ~40 sessions × 12 instruments per day, so a per-bar formatter would be
  // tens of seconds within weeks. IST is a fixed UTC+5:30 with no daylight saving — permanently,
  // by definition — so the local day and minute are exact arithmetic for THIS market, and this
  // query is NSE-only by construction (the canonical store keys XNSE instruments).
  const IST_OFFSET_SECONDS = 19_800;
  const open = sessionOpenMinute("IN");
  const close = sessionCloseMinute("IN");
  const barsPerSession = Math.floor((close - open) / 5);
  const completeFloor = Math.ceil(barsPerSession * SESSION_COMPLETE_SHARE);
  const openingEnd = open + OPENING_WINDOW_MINUTES;

  const quality = new Map<string, { present: number; complete: number; opening: number }>(
    db
      .all<{ ticker: string; present: number; complete: number; opening: number }>(sql`
        SELECT ticker,
               COUNT(*) AS present,
               SUM(CASE WHEN in_session >= ${completeFloor} THEN 1 ELSE 0 END) AS complete,
               SUM(CASE WHEN in_session >= ${completeFloor} AND in_opening >= ${OPENING_WINDOW_MIN_BARS} THEN 1 ELSE 0 END) AS opening
        FROM (
          SELECT ticker,
                 date(time + ${IST_OFFSET_SECONDS}, 'unixepoch') AS session_day,
                 SUM(CASE WHEN ((time + ${IST_OFFSET_SECONDS}) % 86400) / 60 >= ${open}
                           AND ((time + ${IST_OFFSET_SECONDS}) % 86400) / 60 < ${close}
                          THEN 1 ELSE 0 END) AS in_session,
                 SUM(CASE WHEN ((time + ${IST_OFFSET_SECONDS}) % 86400) / 60 >= ${open}
                           AND ((time + ${IST_OFFSET_SECONDS}) % 86400) / 60 < ${openingEnd}
                          THEN 1 ELSE 0 END) AS in_opening
          FROM price_candles
          WHERE resolution = '5'
          GROUP BY ticker, session_day
        )
        GROUP BY ticker
      `)
      .map((row) => [
        row.ticker,
        { present: Number(row.present), complete: Number(row.complete), opening: Number(row.opening) },
      ]),
  );

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
    const sessions = quality.get(instrumentId) ?? { present: 0, complete: 0, opening: 0 };
    const historyReady = dailyBars >= MIN_BARS_FOR_RESEARCH;
    const researchReady = historyReady;
    const lastDailyBar = lastBarByTicker.get(instrumentId) ?? null;
    // Enough history is not the same as current history. An instrument can hold three years of
    // bars and still have stopped updating a week ago — which is exactly what RELIANCE, HDFCBANK
    // and TCS did while every other name stayed current.
    const freshnessReady =
      lastDailyBar !== null && universeLastBar - lastDailyBar <= STALE_AFTER_SECONDS;
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
      fiveMinuteSessions: sessions.present,
      completeFiveMinuteSessions: sessions.complete,
      openingWindowSessions: sessions.opening,
      researchReady,
      historyReady,
      freshnessReady,
      lastDailyBar,
      backtestReady: dailyBars >= BACKTEST_BARS_FLOOR,
      validationReady: dailyBars >= VALIDATION_BARS_FLOOR,
      // INTRADAY_READY counts COMPLETE sessions, not merely present ones: forty half-empty days
      // are not forty tradable days.
      intradayReady: sessions.complete >= INTRADAY_SESSIONS_FLOOR,
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
        // Two ways to belong on the worklist, and conflating them was the bug: not enough HISTORY,
        // or history that has stopped being CURRENT. Filtering on `!researchReady` alone meant an
        // instrument left the queue permanently the moment it was deep enough, so the best-covered
        // names were the first to go stale. Three had — RELIANCE, HDFCBANK and TCS.
        (!security.historyReady || !security.freshnessReady) &&
        security.missingReason !== "INGEST_IN_FLIGHT" &&
        security.missingReason !== "INGEST_BLOCKED_PERMANENT",
    )
    .map((security) => {
      const isReferenced = referenced.has(security.instrumentId);
      const partiallyCovered = security.dailyBars > 0;
      const staleOnly = security.historyReady && !security.freshnessReady;
      const tier: 1 | 2 | 3 = isReferenced || partiallyCovered ? 1 : 2;
      return {
        instrumentId: security.instrumentId,
        tier,
        reason: staleOnly
          ? `deep but stale (${security.dailyBars} bars, last bar behind the universe) — refresh, not backfill`
          : isReferenced
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
