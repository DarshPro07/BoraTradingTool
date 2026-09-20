import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { DatasetDeclaration, ImportedCandle } from "./dataset-import";
import { isPlausibleDailyBarTime } from "./session-calendar";

/**
 * Local storage for imported historical bars.
 *
 * `price_candles` has existed since the first migration and had **no reader and no writer**
 * anywhere in the repository — a table defined and then never used. Market data is fetched live
 * per request into an in-memory TTL cache, which is the right design for quotes and the wrong
 * one for backtests: Yahoo serves roughly sixty days of 1-minute history, and an intraday
 * strategy cannot be validated on sixty days.
 *
 * So this is deliberately *not* a cache of the live feed. Persisting live quotes would create a
 * second source of truth about the present, and the two would eventually disagree. This holds
 * one thing only: **imported historical bars from a declared dataset**, which the live feed
 * cannot supply and never will.
 *
 * ## Why the declaration lives in `audit_events`
 *
 * A dataset's provenance — where it came from, its licence, whether prices are adjusted — is
 * exactly as important as the bars, because it decides whether the bars may be used as evidence.
 * It belongs in a table with the bars.
 *
 * It is written to `audit_events` instead, because `migrateDatabase` applies a **hardcoded**
 * `MIGRATIONS` array in an owner-reviewed file: a new `drizzle/*.sql` would sit on disk unread,
 * and the import would appear to work while its provenance silently went nowhere. `audit_events`
 * already records governed decisions with actor, action and timestamp, and admitting a dataset
 * into the evidence chain is such a decision.
 */

export const DATASET_ACTION = "dataset_import";

export interface StoredCoverage {
  ticker: string;
  resolution: string;
  bars: number;
  /** Unix seconds. Null when nothing is stored — which is not the same as a zero-length range. */
  firstTime: number | null;
  lastTime: number | null;
}

/**
 * Insert bars, skipping any timestamp already held for that ticker and resolution.
 *
 * Idempotent on purpose: re-running an import must not double the series. `price_candles` has no
 * unique constraint on `(ticker, resolution, time)` — adding one would need a migration this
 * agent cannot apply — so uniqueness is enforced here by reading the existing timestamps first.
 * That is slower than `INSERT OR IGNORE` and correct without a schema change.
 */
/**
 * Could this bar have traded as described?
 *
 * A bar whose open or close sits outside its own high/low is not a price series with a small
 * error in it — it is a quote for a trade that the bar itself says never happened, and a backtest
 * will fill at that price without hesitating. 36 such bars were found in the production daily
 * store (`HDFCBANK 2025-10-29` at `O=H=L=1007.85, C=998.15` among them).
 *
 * The accumulator carried a `high < low` check of its own, so the guard existed in one caller and
 * not at the boundary every caller shares. It belongs here.
 */
function coherent(candle: ImportedCandle): boolean {
  const { open, high, low, close } = candle;
  if (![open, high, low, close].every((price) => Number.isFinite(price))) return false;
  if (high < low) return false;
  return open >= low && open <= high && close >= low && close <= high;
}

/**
 * Could the exchange have been open on the day this bar claims?
 *
 * Applied to daily bars only, where the timestamp *is* a claim about a calendar day. `RELIANCE`,
 * `TCS` and `HDFCBANK` each held 122 Sunday-dated daily bars because their whole series was
 * stamped one day early — a full day of lookahead against every other instrument in a
 * cross-sectional join, and invisible to every check the system had: the bars were coherent, in
 * range, and `out_of_session` only ever examined a bar's minute of day.
 *
 * The guard sits here rather than in the provider that revealed it, because every ingestion path —
 * Yahoo, Upstox, the import scripts, the accumulator — funnels through `persistCandles`, and a fix
 * in one caller leaves its siblings broken.
 */
function plausibleSession(candle: ImportedCandle): boolean {
  if (candle.resolution !== "D") return true;
  return isPlausibleDailyBarTime(candle.time);
}

export function persistCandles(
  candles: readonly ImportedCandle[],
): { inserted: number; skipped: number; rejected: number } {
  if (candles.length === 0) return { inserted: 0, skipped: 0, rejected: 0 };
  const db = getDb();

  // One read per (ticker, resolution) pair rather than per bar. A million-row import must not
  // become a million queries.
  const pairs = new Map<string, Set<number>>();
  for (const candle of candles) {
    const key = `${candle.ticker}\u0000${candle.resolution}`;
    if (pairs.has(key)) continue;
    const existing = db
      .select({ time: schema.priceCandles.time })
      .from(schema.priceCandles)
      .where(
        and(
          eq(schema.priceCandles.ticker, candle.ticker),
          eq(schema.priceCandles.resolution, candle.resolution),
        ),
      )
      .all();
    pairs.set(key, new Set(existing.map((row) => row.time)));
  }

  const fresh: ImportedCandle[] = [];
  let skipped = 0;
  let rejected = 0;
  for (const candle of candles) {
    // Counted, never swallowed: one malformed row must not cost the rest of a batch its history,
    // and a silently dropped bar is a gap nobody can later account for.
    if (!coherent(candle) || !plausibleSession(candle)) {
      rejected += 1;
      continue;
    }
    const key = `${candle.ticker}\u0000${candle.resolution}`;
    const held = pairs.get(key)!;
    if (held.has(candle.time)) {
      skipped += 1;
      continue;
    }
    // Guard within the batch too: a dataset can contain a duplicate the store has never seen.
    held.add(candle.time);
    fresh.push(candle);
  }

  // Chunked because SQLite caps bound parameters per statement, and a large import would
  // otherwise fail at an arbitrary size with an opaque error.
  const CHUNK = 500;
  for (let start = 0; start < fresh.length; start += CHUNK) {
    const batch = fresh.slice(start, start + CHUNK);
    if (batch.length > 0) db.insert(schema.priceCandles).values(batch).run();
  }

  return { inserted: fresh.length, skipped, rejected };
}

/** Bars held locally for one instrument, oldest first. */
export function loadStoredCandles(
  ticker: string,
  resolution: string,
  from?: number,
  to?: number,
): ImportedCandle[] {
  const filters = [
    eq(schema.priceCandles.ticker, ticker),
    eq(schema.priceCandles.resolution, resolution),
  ];
  if (from !== undefined) filters.push(gte(schema.priceCandles.time, from));
  if (to !== undefined) filters.push(lte(schema.priceCandles.time, to));

  return getDb()
    .select()
    .from(schema.priceCandles)
    .where(and(...filters))
    .orderBy(asc(schema.priceCandles.time))
    .all()
    .map((row) => ({
      ticker: row.ticker,
      resolution: row.resolution,
      time: row.time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
}

/**
 * What is held, per instrument and resolution.
 *
 * `firstTime`/`lastTime` are null when nothing is stored. Reporting `0` would claim a range
 * beginning at the epoch, which is the sort of plausible number that survives review.
 */
export function storedCoverage(ticker?: string): StoredCoverage[] {
  // Counted in SQL, not in JavaScript.
  //
  // This used to SELECT every candle and group them in a Map. On 2026-09-20 that was 3,574,571
  // rows materialised as objects on every render, costing 12.8s here and another 17.2s through
  // `intradayDepth`, which is what made /data-quality take over two minutes to answer a question
  // about row counts. The (ticker, resolution, time) index answers it without reading a row body.
  const rows = getDb().all<{ ticker: string; resolution: string; bars: number; firstTime: number | null; lastTime: number | null }>(
    ticker
      ? sql`SELECT ticker, resolution, count(*) AS bars, min(time) AS firstTime, max(time) AS lastTime
            FROM price_candles WHERE ticker = ${ticker} GROUP BY ticker, resolution ORDER BY bars DESC`
      : sql`SELECT ticker, resolution, count(*) AS bars, min(time) AS firstTime, max(time) AS lastTime
            FROM price_candles GROUP BY ticker, resolution ORDER BY bars DESC`,
  );
  return rows.map((row) => ({
    ticker: row.ticker,
    resolution: row.resolution,
    bars: row.bars,
    firstTime: row.firstTime,
    lastTime: row.lastTime,
  }));
}

/**
 * Record that a dataset was admitted, with the declaration that decides how far it may be
 * trusted. `unfitForValidation` is stored as written so the reason survives, not just the fact.
 */
export function recordDatasetImport(
  declaration: DatasetDeclaration,
  result: { inserted: number; skipped: number; rejected: number; unfitForValidation: string | null },
  actor = "dataset-import",
): void {
  getDb()
    .insert(schema.auditEvents)
    .values({
      actor,
      action: DATASET_ACTION,
      // A dataset that cannot be used for validation is an admitted-but-limited decision, not a
      // refusal — the bars are there and exploring them is legitimate.
      decision: result.unfitForValidation ? "limited" : "allowed",
      subject: declaration.source,
      detail: JSON.stringify({ declaration, ...result }),
      createdAt: new Date(),
    })
    .run();
}

export interface DatasetRecord {
  id: number;
  importedAt: Date;
  source: string;
  declaration: DatasetDeclaration | null;
  inserted: number;
  skipped: number;
  rejected: number;
  unfitForValidation: string | null;
}

/** Every dataset ever admitted, newest first. A malformed row is reported, never dropped. */
export function importedDatasets(limit = 50): DatasetRecord[] {
  return getDb()
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.action, DATASET_ACTION))
    .all()
    .slice(-Math.max(0, Math.trunc(limit)))
    .reverse()
    .map((row) => {
      let parsed: Record<string, unknown> = {};
      try {
        const value: unknown = JSON.parse(row.detail ?? "{}");
        if (value && typeof value === "object") parsed = value as Record<string, unknown>;
      } catch {
        // A detail column that will not parse is a data fault. The import still happened, and
        // saying so with unknown numbers beats pretending it did not.
      }
      return {
        id: row.id,
        importedAt: row.createdAt,
        source: row.subject ?? "unknown",
        declaration: (parsed.declaration as DatasetDeclaration | undefined) ?? null,
        inserted: typeof parsed.inserted === "number" ? parsed.inserted : 0,
        skipped: typeof parsed.skipped === "number" ? parsed.skipped : 0,
        rejected: typeof parsed.rejected === "number" ? parsed.rejected : 0,
        unfitForValidation: typeof parsed.unfitForValidation === "string" ? parsed.unfitForValidation : null,
      };
    });
}
