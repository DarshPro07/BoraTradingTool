/**
 * When the NSE is open — the one definition.
 *
 * This exists because the system had no answer to "could the exchange have traded on this day?".
 * The `out_of_session` audit checks a bar's **minute of day** and never its **weekday**, so 122
 * Sunday-dated daily bars sat in `RELIANCE`, `TCS` and `HDFCBANK` — the three largest weights on
 * the NSE — without tripping a single rule. See
 * `docs/plans/upstox-daily-backfill/01-reality.md`.
 *
 * Kept separate from both the provider and the store so there is one list of exchange holidays and
 * special sessions rather than a copy per caller that can drift.
 */

/** IST is UTC+5:30 with no daylight saving, so one constant is exact rather than approximate. */
export const IST_OFFSET_SECONDS = 5 * 3600 + 30 * 60;
/** NSE trades 09:15-15:30 IST. A daily bar is stamped at the session open. */
export const SESSION_OPEN_SECONDS = 9 * 3600 + 15 * 60;

/**
 * Weekend days the NSE really did trade, and weekdays it did not.
 *
 * Both lists live in `nse-calendar-data.ts`, which is **generated** rather than hand-maintained —
 * see `scripts/sync-nse-calendar.mts`. That distinction is the whole point. An earlier revision of
 * this module carried a hand-written list and asserted "NSE has no Sunday session", which silently
 * dropped real Muhurat trading; a second revision knew about weekends but nothing about holidays,
 * and could not see 6,435 daily bars sitting on four days the exchange was shut.
 */
import { NSE_TRADING_HOLIDAYS, NSE_WEEKEND_SESSIONS } from "./nse-calendar-data";

export { NSE_TRADING_HOLIDAYS, NSE_WEEKEND_SESSIONS };

/** The IST calendar date of a unix timestamp, as `YYYY-MM-DD`. */
export function istDate(unixSeconds: number): string {
  return new Date((unixSeconds + IST_OFFSET_SECONDS) * 1000).toISOString().slice(0, 10);
}

/** Unix seconds at the 09:15 IST session open for an ISO calendar day. */
export function sessionOpenEpoch(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new RangeError(`Not an ISO calendar date: ${isoDate}`);
  const [, y, m, d] = match;
  // Built from Date.UTC rather than a local-time constructor: this host runs in IST, where a local
  // constructor would agree by accident while being wrong everywhere else.
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) / 1000 + SESSION_OPEN_SECONDS - IST_OFFSET_SECONDS;
}

/**
 * Could the exchange have traded on this calendar day?
 *
 * A weekend day only if it is a declared session; a weekday unless it is a known trading holiday.
 *
 * **Fail-open on dates the calendar does not cover**, which is deliberate. A guard that refused
 * every date past its own coverage would silently halt ingestion the first time the calendar went
 * unsynced — turning a stale lookup table into data loss. This refuses only what is *known* to be
 * impossible, and `auditAgainstCalendar` exists to catch what it therefore cannot.
 */
export function isPlausibleSessionDate(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return NSE_WEEKEND_SESSIONS.has(isoDate);
  return !NSE_TRADING_HOLIDAYS.has(isoDate);
}

/** Whether a daily bar's timestamp lands on a day the exchange could have been open. */
export function isPlausibleDailyBarTime(unixSeconds: number): boolean {
  return isPlausibleSessionDate(istDate(unixSeconds));
}

export interface CalendarAudit {
  /** Dates carrying daily bars that the calendar says were not sessions. */
  impossibleDates: { date: string; instruments: number }[];
  barsAffected: number;
}

/**
 * Which dates in a set of (date, instrumentCount) pairs the exchange was shut for.
 *
 * The counterpart to `isPlausibleSessionDate` failing open. The guard refuses only what it *knows*
 * is impossible at write time; this reads what is already stored and reports what should never have
 * got in — including bars written before the guard existed, which no write-time check can reach.
 *
 * Takes rows rather than querying, so it can be run against the live store, a snapshot, or a
 * fixture without three code paths.
 */
export function auditAgainstCalendar(
  rows: readonly { date: string; instruments: number }[],
): CalendarAudit {
  const impossibleDates = rows
    .filter((row) => !isPlausibleSessionDate(row.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    impossibleDates,
    barsAffected: impossibleDates.reduce((sum, row) => sum + row.instruments, 0),
  };
}
