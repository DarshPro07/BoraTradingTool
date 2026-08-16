import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recordAudit } from "@/lib/knowledge/repository";
import type { CandleResolution } from "@/lib/providers/types";
import type { Instrument } from "./types";
import { getNormalizedCandles } from "./service";
import { persistCandles, storedCoverage } from "./candle-store";
import { auditBars, failedFetchAudit } from "./bar-audit";
import { recordBarIngestion } from "./bar-ingestion-ledger";
import type { ImportedCandle } from "./dataset-import";

/**
 * Keeping the intraday history the provider is about to forget.
 *
 * ## The problem this solves, and why waiting never solved it
 *
 * Yahoo serves a sliding window of intraday history — roughly seven days at 1-minute resolution
 * and sixty at 5-minute. `lib/learning/dataset.ts` states the consequence plainly: an intraday
 * strategy cannot be validated on sixty days, *and no amount of waiting fixes it, because the
 * window slides*. Tomorrow's fetch gains a day at the front and loses one at the back.
 *
 * That is true of any single fetch. It stops being true the moment something **keeps** what falls
 * off the back. Fetch the window daily and persist it, and after three months the store holds
 * three months of 5-minute bars that were never available in any one request — history assembled
 * rather than purchased. The owner's constraint is "free, live-fetched only"; this respects it
 * exactly and removes the ceiling anyway.
 *
 * ## Why this does not violate the candle store's stated policy
 *
 * `candle-store.ts` says it holds "imported historical bars from a declared dataset" and warns
 * that persisting the live feed "would create a second source of truth about the present". That
 * warning is right, and this does not do it.
 *
 * A five-minute bar from two sessions ago is **settled**: it will never change, no later fetch
 * will disagree with it, and it is history in every sense except that it arrived over the same
 * pipe as the quote. What the warning guards against is persisting *the present* — the forming
 * bar, whose high and low are still moving. So only closed bars from prior sessions are kept, and
 * `SETTLE_SECONDS` below is the whole safety margin.
 *
 * ## Why the current session is excluded entirely
 *
 * Not just the forming bar — the whole day. A session can be halted, extended, or have its last
 * bars revised after the close, and a bar captured mid-session that is later corrected upstream
 * becomes a permanent disagreement inside the store that nothing will ever reconcile. Waiting one
 * session costs a day of latency and buys certainty.
 */

/** Resolutions worth accumulating. Daily bars have deep history already and need no help. */
export const ACCUMULATED_RESOLUTIONS = ["5", "15", "60"] as const satisfies readonly CandleResolution[];

/**
 * A bar is kept only once this long has passed since it closed.
 *
 * 26 hours: comfortably past the next session's open for both NSE and US markets, so a bar is only
 * stored after a full trading session has elapsed and any post-close revision has settled.
 */
export const SETTLE_SECONDS = 26 * 60 * 60;

const RESOLUTION_SECONDS: Readonly<Record<string, number>> = Object.freeze({
  "1": 60,
  "5": 300,
  "15": 900,
  "30": 1_800,
  "60": 3_600,
});

export interface AccumulationResult {
  instrumentId: string;
  resolution: string;
  fetched: number;
  /** Rejected as too recent to be settled. Not an error — the safety margin working. */
  unsettled: number;
  inserted: number;
  /** Already held. On a healthy daily run most bars are skipped, which is the point. */
  skipped: number;
  error: string | null;
}

export interface AccumulationReport {
  results: AccumulationResult[];
  inserted: number;
  failed: number;
  summary: string;
}

export type CandleFetcher = (
  instrument: Instrument,
  resolution: CandleResolution,
  from: number,
  to: number,
) => Promise<readonly { time: number; open: number; high: number; low: number; close: number; volume: number }[]>;

const defaultFetcher: CandleFetcher = async (instrument, resolution, from, to) => {
  const result = await getNormalizedCandles(instrument, resolution, from, to);
  return result.candles;
};

/**
 * Fetches the provider's intraday window and keeps the settled part of it.
 *
 * Idempotent by way of `persistCandles`, which skips any `(ticker, resolution, time)` it already
 * holds — so running this every cycle is free after the first pass of a given day, and a crashed
 * run simply resumes.
 */
export async function accumulateIntraday(
  instruments: readonly Instrument[],
  resolutions: readonly CandleResolution[] = ACCUMULATED_RESOLUTIONS,
  now = Math.floor(Date.now() / 1000),
  fetchCandles: CandleFetcher = defaultFetcher,
): Promise<AccumulationReport> {
  const results: AccumulationResult[] = [];

  for (const instrument of instruments) {
    for (const resolution of resolutions) {
      const span = RESOLUTION_SECONDS[resolution];
      if (!span) continue;

      // The widest window the provider will serve for this resolution. Asking for more is not an
      // error upstream — it silently returns less — so the request is sized to what is known to
      // work rather than to what would be nice.
      const window = resolution === "1" ? 7 * 86_400 : 59 * 86_400;

      const result: AccumulationResult = {
        instrumentId: instrument.id,
        resolution,
        fetched: 0,
        unsettled: 0,
        inserted: 0,
        skipped: 0,
        error: null,
      };

      try {
        const bars = await fetchCandles(instrument, resolution, now - window, now);
        result.fetched = bars.length;

        const settled: ImportedCandle[] = [];
        for (const bar of bars) {
          // The bar's *close*, not its open, is what has to be old enough.
          if (bar.time + span + SETTLE_SECONDS > now) {
            result.unsettled += 1;
            continue;
          }
          if (!Number.isFinite(bar.open) || !Number.isFinite(bar.close) || bar.high < bar.low) {
            // A malformed bar is dropped rather than stored. Once in the store it is
            // indistinguishable from history, and nothing downstream would ever question it.
            continue;
          }
          settled.push({
            ticker: instrument.id,
            resolution,
            time: bar.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: Number.isFinite(bar.volume) ? bar.volume : null,
          });
        }

        const persisted = persistCandles(settled);
        result.inserted = persisted.inserted;
        result.skipped = persisted.skipped;

        // The request beside the response — the comparison that makes silent truncation visible.
        // This is the exact path where a 59-day request was served one day for weeks.
        recordBarIngestion({
          instrumentId: instrument.id,
          resolution,
          source: "yahoo",
          identityVerdict: "UNSTATED",
          audit: auditBars(bars, {
            market: "IN",
            requestedStart: now - window,
            requestedEnd: now,
            resolutionMinutes: span / 60,
          }),
          inserted: persisted.inserted,
          skipped: persisted.skipped,
          rejected: bars.length - settled.length - result.unsettled,
        });
      } catch (caught) {
        // One instrument failing must not cost the rest their accumulation. The window slides
        // whether or not this run succeeded, so a failure here is a day of history lost — worth
        // reporting, never worth aborting the pass for.
        result.error = caught instanceof Error ? caught.message.split("\n")[0] : String(caught);

        // ...and worth RECORDING, which for three consecutive production passes it was not.
        // The success path above wrote the ledger row; this one wrote an in-memory field, so
        // "3 fetch(es) failed" was the entire durable trace and no later reader could learn which
        // instrument, which resolution, or why. A count cannot be diagnosed.
        recordBarIngestion({
          instrumentId: instrument.id,
          resolution,
          source: "yahoo",
          identityVerdict: "UNSTATED",
          audit: failedFetchAudit({ requestedStart: now - window, requestedEnd: now, error: caught }),
          inserted: 0,
          skipped: 0,
          rejected: 0,
        });
      }

      results.push(result);
    }
  }

  const inserted = results.reduce((total, item) => total + item.inserted, 0);
  const failed = results.filter((item) => item.error !== null).length;

  return {
    results,
    inserted,
    failed,
    summary:
      inserted === 0 && failed === 0
        ? "Intraday accumulation: nothing new to keep; the store already holds every settled bar the provider offers."
        : `Intraday accumulation: kept ${inserted} settled bar(s) the provider's window will drop` +
          (failed > 0 ? `, ${failed} fetch(es) failed` : "") +
          ". History the live feed cannot serve is built by keeping it, not by waiting for it.",
  };
}

export const ACCUMULATION_ACTION = "intraday_accumulation";

/** Bars settle once a session; running more often than daily fetches nothing and costs quota. */
const ACCUMULATION_INTERVAL_SECONDS = 20 * 60 * 60;

/**
 * Whether a pass is due.
 *
 * The cycle runs every fifteen minutes and accumulation is idempotent, so an unguarded call would
 * be *correct* and still wrong: twelve instruments across three resolutions is 36 provider
 * requests, ninety-six times a day, to discover that nothing new has settled. That is precisely
 * the load that rate-limited the feed earlier in this system's life and made the rehearsal report
 * "No stored candles" for a market whose data was fine.
 *
 * A bar settles once per session. So does this.
 */
export function accumulationDue(now = Math.floor(Date.now() / 1000)): boolean {
  try {
    const last = getDb()
      .select({ createdAt: schema.auditEvents.createdAt })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, ACCUMULATION_ACTION))
      .orderBy(desc(schema.auditEvents.id))
      .get();
    if (!last?.createdAt) return true;
    const at = last.createdAt instanceof Date ? Math.floor(last.createdAt.getTime() / 1000) : Number(last.createdAt);
    return now - at >= ACCUMULATION_INTERVAL_SECONDS;
  } catch {
    // Unknown means due. Skipping on an unreadable marker would silently stop accumulating, and
    // the cost of one extra pass is a few requests.
    return true;
  }
}

/** Marks a pass as done, so the next cycle can tell whether another is owed. */
export function markAccumulated(report: AccumulationReport, actor = "learning-cycle"): void {
  recordAudit({
    actor,
    action: ACCUMULATION_ACTION,
    decision: "allowed",
    detail: report.summary,
  });
}

export interface IntradayDepth {
  instrumentId: string;
  resolution: string;
  bars: number;
  /** Calendar days between the oldest and newest stored bar. Null when nothing is held. */
  spanDays: number | null;
  /** True once the span exceeds what the provider's sliding window could ever return. */
  beyondProvider: boolean;
}

/**
 * How much history has been assembled beyond what any single fetch could return.
 *
 * The number worth watching: the day it exceeds the provider's window, the store is holding
 * something that cannot be obtained any other way without paying for it.
 */
export function intradayDepth(): IntradayDepth[] {
  return storedCoverage()
    .filter((entry) => entry.resolution in RESOLUTION_SECONDS)
    .map((entry) => {
      const spanDays =
        entry.firstTime !== null && entry.lastTime !== null
          ? Math.round((entry.lastTime - entry.firstTime) / 86_400)
          : null;
      const providerWindow = entry.resolution === "1" ? 7 : 59;
      return {
        instrumentId: entry.ticker,
        resolution: entry.resolution,
        bars: entry.bars,
        spanDays,
        beyondProvider: spanDays !== null && spanDays > providerWindow,
      };
    })
    .sort((a, b) => b.bars - a.bars);
}
