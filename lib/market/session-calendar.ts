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
 * Weekend days the NSE really did trade.
 *
 * A first version of this list held Saturdays only, on the reasoning that "Sunday never trades".
 * **That was wrong**, and the provider data corrected it: NSE holds Muhurat trading on Diwali
 * whichever day it falls, and 2019-10-27, 2023-11-12 and 2026-02-01 are all Sundays with real
 * sessions. Banning Sunday outright would have deleted genuine history to protect against a
 * different fault.
 *
 * These dates are **corroborated, not assumed**: each appears independently in RELIANCE, TCS and
 * HDFCBANK's histories. A further 21 weekend dates appear in RELIANCE alone, all 2016 or earlier;
 * single-instrument evidence is not enough to call a date an exchange-wide session, so they are
 * refused — and counted and reported, never silently dropped.
 *
 * Extend this list only with corroboration. Note what it deliberately does not do: it does not
 * encode the trading-holiday calendar, because a bar on Diwali is a data question this module has
 * no source for, whereas a bar on an ordinary Sunday is arithmetic.
 */
export const DECLARED_WEEKEND_SESSIONS: readonly string[] = Object.freeze([
  "2019-10-27", // Sun — Muhurat trading, Diwali
  "2020-02-01", // Sat — Union Budget live session
  "2020-11-14", // Sat — Muhurat trading, Diwali
  "2023-11-12", // Sun — Muhurat trading, Diwali
  "2024-01-20", // Sat — special live trading session
  "2024-03-02", // Sat — special live trading session
  "2024-05-18", // Sat — special live trading session
  "2025-02-01", // Sat — Union Budget live session
  "2026-02-01", // Sun — Union Budget live session
]);

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
 * Monday to Friday always; a weekend day only if it is a declared session. This catches the fault
 * it was written for — a series stamped one day early puts a bar on *every* weekend, and no such
 * run of dates can be declared — while leaving the exchange's genuine special sessions intact.
 */
export function isPlausibleSessionDate(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return DECLARED_WEEKEND_SESSIONS.includes(isoDate);
  return true;
}

/** Whether a daily bar's timestamp lands on a day the exchange could have been open. */
export function isPlausibleDailyBarTime(unixSeconds: number): boolean {
  return isPlausibleSessionDate(istDate(unixSeconds));
}
