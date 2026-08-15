import type { Market } from "./types";

export type MarketSession = "CLOSED" | "PRE_OPEN" | "REGULAR" | "EXTENDED";

const HOLIDAYS: Record<Market, ReadonlySet<string>> = {
  US: new Set(["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]),
  IN: new Set(["2026-01-26", "2026-03-03", "2026-03-26", "2026-04-03", "2026-04-14", "2026-05-01", "2026-08-15", "2026-10-02", "2026-11-09", "2026-12-25"]),
};

const CONFIG = {
  US: { timezone: "America/New_York", preOpen: 4 * 60, open: 9 * 60 + 30, close: 16 * 60, extendedClose: 20 * 60 },
  IN: { timezone: "Asia/Kolkata", preOpen: 9 * 60, open: 9 * 60 + 15, close: 15 * 60 + 30, extendedClose: 15 * 60 + 30 },
} as const;

/**
 * Identity of the session/holiday model an experiment ran under (13b manifest field).
 * Bump when session times, holidays or timezone semantics change.
 */
export const MARKET_CALENDAR_VERSION = "calendar-2026-08-09";

/** Exported so the phase model can reuse one timezone conversion rather than write a second. */
export function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
    localTime: `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`,
  };
}

/** A bar's position in its local trading day. */
export interface SessionStamp {
  /** Minutes since local midnight — 09:15 IST is 555. */
  readonly minute: number;
  /** Local calendar date, `YYYY-MM-DD`. Two bars with different dates are different sessions. */
  readonly date: string;
}

/**
 * Local session position for a whole series, in one pass.
 *
 * Batched deliberately. `localParts` constructs an `Intl.DateTimeFormat` per call, and a backtest
 * asks for a bar's session minute inside its inner loop — per bar, per instrument, per candidate.
 * Building the formatter once and walking the array turns that from the dominant cost into noise.
 *
 * Arithmetic on a fixed offset would be faster still and is what IST alone would permit, since it
 * has no daylight saving. It is not used, because US bars go through the same path and a
 * hand-rolled offset would be wrong twice a year in exactly the way nobody notices.
 */
export function sessionStamps(times: readonly number[], market: Market): SessionStamp[] {
  const timeZone = CONFIG[market].timezone;
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return times.map((time) => {
    const parts = format.formatToParts(new Date(time * 1000));
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return {
      minute: Number(value("hour")) * 60 + Number(value("minute")),
      date: `${value("year")}-${value("month")}-${value("day")}`,
    };
  });
}

/** The local minute a market's regular session opens. 09:15 IST is 555. */
export function sessionOpenMinute(market: Market): number {
  return CONFIG[market].open;
}

/** The local minute a market's regular session closes. 15:30 IST is 930. */
export function sessionCloseMinute(market: Market): number {
  return CONFIG[market].close;
}

/**
 * Trading days in a window, from the SAME weekend+holiday model the session logic uses — so a
 * gap audit measures against this deployment's declared calendar rather than a guess at one.
 *
 * The holiday set is a fixed 2026 list (`HOLIDAYS` above), so a window reaching outside the
 * years it covers overstates the session count. Callers that classify on this number must treat
 * a small shortfall as unexplained-but-tolerable rather than as missing data — the audit does.
 */
export function expectedTradingDays(market: Market, fromEpochSeconds: number, toEpochSeconds: number): number {
  const timeZone = CONFIG[market].timezone;
  let count = 0;
  // Step by whole days from the start, in the market's own timezone.
  for (let time = fromEpochSeconds; time <= toEpochSeconds; time += 86_400) {
    const local = localParts(new Date(time * 1000), timeZone);
    if (local.weekday === "Sat" || local.weekday === "Sun") continue;
    if (HOLIDAYS[market].has(local.date)) continue;
    count += 1;
  }
  return count;
}

export function getMarketSession(market: Market, at = new Date()): {
  session: MarketSession;
  localTime: string;
  timezone: string;
  holidaySource: "MARKETPULSE_2026_V1";
} {
  const config = CONFIG[market];
  const local = localParts(at, config.timezone);
  const closedDay = local.weekday === "Sat" || local.weekday === "Sun" || HOLIDAYS[market].has(local.date);
  let session: MarketSession = "CLOSED";
  if (!closedDay && local.minutes >= config.preOpen && local.minutes < config.open) session = "PRE_OPEN";
  if (!closedDay && local.minutes >= config.open && local.minutes < config.close) session = "REGULAR";
  if (!closedDay && local.minutes >= config.close && local.minutes < config.extendedClose) session = "EXTENDED";
  return {
    session,
    localTime: local.localTime,
    timezone: config.timezone,
    holidaySource: "MARKETPULSE_2026_V1",
  };
}
