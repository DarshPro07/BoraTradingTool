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
import { CALENDAR_DERIVED_THROUGH, EXCHANGE_DECLARED_DATES, NSE_TRADING_HOLIDAYS, NSE_WEEKEND_SESSIONS } from "./nse-calendar-data";

export { CALENDAR_DERIVED_THROUGH, EXCHANGE_DECLARED_DATES, NSE_TRADING_HOLIDAYS, NSE_WEEKEND_SESSIONS };

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

/**
 * How well the calendar knows a given date.
 *
 * Ingestion fails open and research fails closed, and this type is what lets those two differ
 * without either guessing. The race it prevents:
 *
 * ```
 * a bar past the calendar's coverage is ingested   (correct — never halt ingestion)
 *   -> research runs and consumes it               (WRONG — nothing has vouched for the date)
 *   -> the calendar is synced later
 *   -> the date turns out to be a holiday          (too late; a backtest already saw it)
 * ```
 *
 * `SESSION_UNVERIFIED` is the state that closes it. The date is not known to be bad — it is not
 * known to be anything, and research is exactly the consumer that must not accept that.
 */
export type SessionVerification = "SESSION_VERIFIED" | "SESSION_IMPOSSIBLE" | "SESSION_UNVERIFIED";

/**
 * Classify a date against the calendar.
 *
 * Distinguishes "the exchange was shut" from "the calendar cannot say", which
 * `isPlausibleSessionDate` deliberately cannot: it returns one boolean because a write guard needs
 * one answer, and it treats unknown as permitted.
 */
export function verifySessionDate(isoDate: string): SessionVerification {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) {
    return NSE_WEEKEND_SESSIONS.has(isoDate) ? "SESSION_VERIFIED" : "SESSION_IMPOSSIBLE";
  }
  if (NSE_TRADING_HOLIDAYS.has(isoDate)) return "SESSION_IMPOSSIBLE";
  // A weekday inside the derived span that no reference instrument missed is a real session. Past
  // that span the holiday list came only from the API's forward window, so a weekday that is not
  // listed is unproven rather than confirmed.
  return isoDate <= CALENDAR_DERIVED_THROUGH ? "SESSION_VERIFIED" : "SESSION_UNVERIFIED";
}

/** Research-grade admission: only dates the calendar positively vouches for. */
export function isResearchEligibleSessionDate(isoDate: string): boolean {
  return verifySessionDate(isoDate) === "SESSION_VERIFIED";
}

/**
 * How a date's session status was established — never merged into the status itself.
 *
 * `EXCHANGE_DECLARED` is the exchange's own published calendar. `PRICE_CONSENSUS_DERIVED` is
 * inferred from hundreds of instruments agreeing about which days they traded. That inference is
 * strong — it did not move when its evidence base grew from 53 instruments to 358 — but it is an
 * inference, and a 2004 date deduced from price observations must not claim the standing of a 2026
 * date the exchange published. `SPECIAL_SESSION_CORROBORATED` sits between: a Muhurat or Budget
 * session confirmed across independent instrument histories.
 *
 * This exists because of the naming rule, applied to this module's own output: a name must not
 * imply a stronger guarantee than the evidence establishes, and "the NSE calendar" reads as
 * authoritative when most of it is reconstructed.
 */
export type SessionAuthority =
  | "EXCHANGE_DECLARED"
  | "SPECIAL_SESSION_CORROBORATED"
  | "PRICE_CONSENSUS_DERIVED";

export function sessionAuthority(isoDate: string): SessionAuthority {
  if (EXCHANGE_DECLARED_DATES.has(isoDate)) return "EXCHANGE_DECLARED";
  if (NSE_WEEKEND_SESSIONS.has(isoDate)) return "SPECIAL_SESSION_CORROBORATED";
  return "PRICE_CONSENSUS_DERIVED";
}

/**
 * `count` consecutive real session dates starting at or after `startIso`.
 *
 * Walking the calendar rather than adding 86,400 seconds. That arithmetic is how synthetic series
 * end up with Saturday and Sunday bars — a shape no exchange ever emitted, which then fails the
 * session guard for reasons that have nothing to do with what the caller was testing.
 */
export function sessionDatesFrom(startIso: string, count: number): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00Z`);
  // Bounded so a caller asking for more sessions than the calendar holds terminates with a short
  // list rather than spinning.
  for (let guard = 0; out.length < count && guard < count * 4 + 4_000; guard += 1) {
    const iso = cursor.toISOString().slice(0, 10);
    if (isPlausibleSessionDate(iso)) out.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
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
