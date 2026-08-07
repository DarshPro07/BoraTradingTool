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
