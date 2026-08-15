import { expectedTradingDays, sessionCloseMinute, sessionOpenMinute, sessionStamps } from "./calendar";
import type { Market } from "./types";

/**
 * Gap and completeness auditing — because HTTP 200 is not a complete dataset.
 *
 * A single repaired intraday request now returns thousands of bars, and the failure mode changes
 * shape with the volume: not "the fetch failed" but "the fetch succeeded and quietly returned
 * less, or shifted, or duplicated". Silent truncation is exactly the defect that hid for weeks
 * (`range=1d` served for a 59-day request), and the lesson is that the system must state the
 * difference between EXPECTED and ACTUAL rather than assume completeness.
 *
 * Two independent checks, deliberately separated by how much they can be trusted:
 *
 *   PER-SESSION (exact)   for each session actually returned, does it hold the bars a full
 *                         session should? Needs no holiday calendar and cannot be wrong about
 *                         one — it is the check that catches truncated and partial sessions.
 *   WINDOW COVERAGE       how many sessions did the window contain versus how many arrived?
 *   (calendar-bounded)    Uses this deployment's declared holiday model, which covers a fixed
 *                         year set, so a shortfall inside `SESSION_SHORTFALL_TOLERANCE` is
 *                         reported as coverage rather than asserted as missing data.
 */

export type Completeness =
  | "COMPLETE"
  | "PARTIAL"
  | "SESSION_GAPS"
  | "DUPLICATES"
  | "OUT_OF_SESSION"
  | "TIMEZONE_ERROR"
  | "EMPTY";

/** Sessions may legitimately be missing (unmodelled holidays, listing date) up to this share. */
export const SESSION_SHORTFALL_TOLERANCE = 0.15;
/** A session holding less than this share of its expected bars is a gap, not a short day. */
export const SESSION_BAR_TOLERANCE = 0.8;
/** Above this share of out-of-session bars the SERIES is shifted, not a few stray bars. */
export const TIMEZONE_ERROR_SHARE = 0.5;

export interface BarAudit {
  completeness: Completeness;
  requestedStart: number;
  requestedEnd: number;
  returnedFirstBar: number | null;
  returnedLastBar: number | null;
  returnedBarCount: number;
  /** Sessions the declared calendar says the window contained (intraday only; null for daily). */
  expectedSessions: number | null;
  observedSessions: number;
  duplicateTimestamps: number;
  outOfSessionBars: number;
  /** Sessions returned holding fewer than SESSION_BAR_TOLERANCE of a full session's bars. */
  shortSessions: number;
  detail: string;
}

export interface AuditableBar {
  time: number;
}

/**
 * Audit what a provider returned against what the request asked for.
 *
 * `resolutionMinutes` is the bar width in minutes; pass null for daily+ bars, where per-session
 * bar counts do not apply and only coverage and duplicates are meaningful.
 */
export function auditBars(
  bars: readonly AuditableBar[],
  options: {
    market: Market;
    requestedStart: number;
    requestedEnd: number;
    resolutionMinutes: number | null;
  },
): BarAudit {
  const { market, requestedStart, requestedEnd, resolutionMinutes } = options;
  const times = bars.map((bar) => bar.time).sort((a, b) => a - b);

  const base: BarAudit = {
    completeness: "EMPTY",
    requestedStart,
    requestedEnd,
    returnedFirstBar: times[0] ?? null,
    returnedLastBar: times.at(-1) ?? null,
    returnedBarCount: times.length,
    expectedSessions: null,
    observedSessions: 0,
    duplicateTimestamps: 0,
    outOfSessionBars: 0,
    shortSessions: 0,
    detail: "",
  };

  if (times.length === 0) {
    // An empty response still gets its EXPECTATION recorded: "nothing arrived" only carries
    // meaning beside "this many sessions were in the window".
    const expectedSessions = expectedTradingDays(market, requestedStart, requestedEnd);
    return {
      ...base,
      expectedSessions,
      detail:
        `The provider returned no bars for a window the declared calendar says held ` +
        `${expectedSessions} trading session(s).`,
    };
  }

  const duplicateTimestamps = times.length - new Set(times).size;

  const stamps = sessionStamps(times, market);
  const bySession = new Map<string, number>();
  for (const stamp of stamps) bySession.set(stamp.date, (bySession.get(stamp.date) ?? 0) + 1);
  const observedSessions = bySession.size;

  // Daily+ bars: no intraday session geometry to check.
  if (resolutionMinutes === null) {
    const expectedSessions = expectedTradingDays(market, requestedStart, requestedEnd);
    const shortfall = expectedSessions === 0 ? 0 : 1 - times.length / expectedSessions;
    const completeness: Completeness =
      duplicateTimestamps > 0 ? "DUPLICATES" : shortfall > SESSION_SHORTFALL_TOLERANCE ? "PARTIAL" : "COMPLETE";
    return {
      ...base,
      completeness,
      expectedSessions,
      observedSessions,
      duplicateTimestamps,
      detail:
        `${times.length} daily bar(s) against ${expectedSessions} expected trading day(s) in the ` +
        `requested window (declared calendar; an instrument listed mid-window legitimately has fewer)` +
        (duplicateTimestamps > 0 ? `; ${duplicateTimestamps} duplicate timestamp(s)` : ""),
    };
  }

  const open = sessionOpenMinute(market);
  const close = sessionCloseMinute(market);
  // A bar is stamped at its OPEN, so the last bar of the session starts one width before close.
  const barsPerSession = Math.max(1, Math.floor((close - open) / resolutionMinutes));
  const outOfSessionBars = stamps.filter((stamp) => stamp.minute < open || stamp.minute >= close).length;
  const shortSessions = [...bySession.values()].filter(
    (count) => count < barsPerSession * SESSION_BAR_TOLERANCE,
  ).length;

  const expectedSessions = expectedTradingDays(market, requestedStart, requestedEnd);
  const sessionShortfall = expectedSessions === 0 ? 0 : 1 - observedSessions / expectedSessions;

  const completeness: Completeness =
    outOfSessionBars / times.length > TIMEZONE_ERROR_SHARE
      ? "TIMEZONE_ERROR"
      : duplicateTimestamps > 0
        ? "DUPLICATES"
        : outOfSessionBars > 0
          ? "OUT_OF_SESSION"
          : shortSessions > 0
            ? "SESSION_GAPS"
            : sessionShortfall > SESSION_SHORTFALL_TOLERANCE
              ? "PARTIAL"
              : "COMPLETE";

  const parts = [
    `${times.length} bar(s) across ${observedSessions} session(s); the declared calendar expected ` +
      `${expectedSessions} session(s) in the requested window`,
    `${barsPerSession} bars per full session at ${resolutionMinutes}m`,
  ];
  if (duplicateTimestamps > 0) parts.push(`${duplicateTimestamps} duplicate timestamp(s)`);
  if (outOfSessionBars > 0) parts.push(`${outOfSessionBars} bar(s) outside the regular session`);
  if (shortSessions > 0) parts.push(`${shortSessions} session(s) below ${SESSION_BAR_TOLERANCE * 100}% of a full day`);

  return {
    ...base,
    completeness,
    expectedSessions,
    observedSessions,
    duplicateTimestamps,
    outOfSessionBars,
    shortSessions,
    detail: parts.join("; "),
  };
}
