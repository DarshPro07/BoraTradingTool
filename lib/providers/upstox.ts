/**
 * Upstox V3 — daily historical candles for NSE equities.
 *
 * ## Why this exists
 *
 * The store held 2.5 years of daily history, which `docs/plans/rehearsal-funnel/06-data-availability-and-horizon.md`
 * identified as the cap on the one research lane that is runnable at all. Upstox serves daily
 * candles back to January 2000 — 26 years — and its terms permit automation, which NSE's do not.
 *
 * ## Read-only, historical, and nothing else
 *
 * This module fetches past daily bars. It does not quote, does not stream, and has no order path.
 * `/api/trade/place` returns `EXECUTION_ADAPTER_MISSING` and nothing here changes that. The broad
 * `DataProvider` interface is deliberately NOT implemented: a class whose every other method throws
 * would advertise a capability this module does not have.
 *
 * ## Two conventions that must not be confused
 *
 * Upstox stamps a daily bar at **00:00 IST** of the session date. This store stamps a daily bar at
 * the **09:15 IST session open** (03:45 UTC). Every bar is converted on the way in — see
 * `sessionOpenEpoch`. A bar whose calendar date cannot be read from the response is dropped, never
 * guessed at.
 *
 * ## Basis
 *
 * Upstox back-adjusts for splits and bonuses: measured against the raw NSE bhavcopy, RELIANCE's
 * pre-bonus closes sit at exactly 2.0000x Upstox's across the 2024-10-28 1:1 bonus. A single
 * full-history fetch therefore carries ONE basis by construction — `SPLIT_ADJUSTED`, which is what
 * `RESEARCH_PRICE_BASIS` already wants. That is the property the accumulated Yahoo series lacked.
 */
import type { Candle } from "./types";
import { usagePermitted, type DataPurpose } from "@/lib/market/source-usage-policy";
import { isPlausibleSessionDate, sessionOpenEpoch } from "@/lib/market/session-calendar";

export const UPSTOX_SOURCE_ID = "upstox-v3" as const;

/** Upstox back-adjusts for splits and bonuses. Measured, not assumed — see the module note. */
export const UPSTOX_PRICE_BASIS = "SPLIT_ADJUSTED" as const;

/**
 * A daily request spanning much more than a decade is refused with `UDAPI1148 Invalid date range`,
 * so history is paged. Nine years keeps a comfortable margin under the observed limit.
 */
export const MAX_WINDOW_YEARS = 9;

/** Upstox serves NSE daily candles from here. Earlier windows return empty, not an error. */
export const EARLIEST_AVAILABLE = "2000-01-01";

export type UpstoxRefusalCode =
  | "USAGE_NOT_PERMITTED"
  | "INVALID_ISIN"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_MALFORMED_RESPONSE";

export class UpstoxRefusal extends Error {
  constructor(
    readonly code: UpstoxRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = "UpstoxRefusal";
  }
}

/** `NSE_EQ|INE002A01018`. The ISIN is the exchange's own identifier, so no symbol mapping is needed. */
export function instrumentKey(isin: string): string {
  if (!/^INE[0-9A-Z]{9}$/.test(isin)) {
    throw new UpstoxRefusal("INVALID_ISIN", `${isin} is not a well-formed Indian ISIN.`);
  }
  return `NSE_EQ|${isin}`;
}

/** The shape Upstox returns: `[timestamp, open, high, low, close, volume, openInterest]`. */
type RawCandle = [string, number, number, number, number, number, number];

export interface UpstoxFetcher {
  (url: string): Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}

/**
 * A conventional client identity. Upstox's terms permit automation, and its edge refuses a default
 * library agent with a Cloudflare `browser_signature_banned`. This is an honest self-identification
 * — NOT an impersonation of a browser, and no cookie, proxy or header forgery is used anywhere.
 */
const USER_AGENT = "MarketPulse/1.0 (research; +https://github.com/marketpulse-os)";

const defaultFetcher: UpstoxFetcher = (url) =>
  fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });

export interface DailyHistoryOptions {
  from?: string;
  to?: string;
  purpose?: DataPurpose;
  fetcher?: UpstoxFetcher;
  now?: Date;
}

export interface DailyHistoryResult {
  candles: Candle[];
  /** Bars the provider returned that were refused, with the reason. Never silently dropped. */
  rejected: { date: string; reason: string }[];
  windows: number;
  basis: typeof UPSTOX_PRICE_BASIS;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Decade-sized [from, to] windows covering the range, oldest first. */
export function paginate(from: string, to: string): { from: string; to: string }[] {
  const windows: { from: string; to: string }[] = [];
  let cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const stop = new Date(cursor);
    stop.setUTCFullYear(stop.getUTCFullYear() + MAX_WINDOW_YEARS);
    const windowEnd = stop > end ? end : stop;
    windows.push({ from: isoDay(cursor), to: isoDay(windowEnd) });
    cursor = new Date(windowEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return windows;
}

/**
 * Fetch daily candles for one NSE equity, oldest first.
 *
 * Refuses rather than returns partial silence: an HTTP failure on any window throws, because a
 * quietly short series is indistinguishable from a genuinely short listing history downstream.
 */
export async function getUpstoxDailyHistory(
  isin: string,
  options: DailyHistoryOptions = {},
): Promise<DailyHistoryResult> {
  const purpose = options.purpose ?? "BACKTEST";
  const decision = usagePermitted(UPSTOX_SOURCE_ID, purpose, { now: options.now });
  if (decision.verdict !== "PERMITTED") {
    throw new UpstoxRefusal(
      "USAGE_NOT_PERMITTED",
      `${decision.code}: ${decision.reason}`,
    );
  }

  const key = encodeURIComponent(instrumentKey(isin));
  const from = options.from ?? EARLIEST_AVAILABLE;
  const to = options.to ?? isoDay(options.now ?? new Date());
  const fetcher = options.fetcher ?? defaultFetcher;

  const bySecond = new Map<number, Candle>();
  const rejected: { date: string; reason: string }[] = [];
  const windows = paginate(from, to);

  for (const window of windows) {
    const url = `https://api.upstox.com/v3/historical-candle/${key}/days/1/${window.to}/${window.from}`;
    const response = await fetcher(url);
    if (!response.ok) {
      throw new UpstoxRefusal(
        "PROVIDER_HTTP_ERROR",
        `Upstox returned HTTP ${response.status} for ${isin} ${window.from}..${window.to}.`,
      );
    }

    let payload: { data?: { candles?: RawCandle[] } };
    try {
      payload = JSON.parse(await response.text());
    } catch {
      throw new UpstoxRefusal("PROVIDER_MALFORMED_RESPONSE", `Unparseable response for ${isin}.`);
    }

    for (const raw of payload.data?.candles ?? []) {
      const [stamp, open, high, low, close, volume] = raw;
      const date = String(stamp).slice(0, 10);

      if (!isPlausibleSessionDate(date)) {
        rejected.push({ date, reason: "WEEKEND_DATE" });
        continue;
      }
      if (![open, high, low, close].every((n) => Number.isFinite(n))) {
        rejected.push({ date, reason: "NON_FINITE_PRICE" });
        continue;
      }
      // Mirrors the store's own coherence guard, so an impossible bar is refused at the edge
      // rather than at the write funnel.
      if (high < low || open < low || open > high || close < low || close > high) {
        rejected.push({ date, reason: "INCOHERENT_OHLC" });
        continue;
      }

      const time = sessionOpenEpoch(date);
      bySecond.set(time, { time, open, high, low, close, volume: Number(volume) || 0 });
    }
  }

  return {
    candles: [...bySecond.values()].sort((a, b) => a.time - b.time),
    rejected,
    windows: windows.length,
    basis: UPSTOX_PRICE_BASIS,
  };
}
