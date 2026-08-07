import { localParts, type MarketSession } from "./calendar";
import type { Market } from "./types";

/**
 * Fine-grained market phases.
 *
 * `getMarketSession` answers "is the market open?" in four states, and every existing screen
 * depends on that answer, so it is left alone. This answers the different question a
 * pre-market pipeline asks: *which* part of the pre-open are we in, and what is knowable now?
 *
 * The distinction is not cosmetic. India's 09:00–09:15 is one label today, but NSE runs three
 * operationally different phases inside it: orders are collected, then matched at an
 * equilibrium price, then nothing happens until the bell. A strategy that reads the indicative
 * price during collection is reading a number that is still being formed and can be withdrawn;
 * the same read after matching is final. The US bucket is worse — 04:00 to 09:30 ET is five
 * and a half hours in a single state, spanning the quietest and busiest moments of the day.
 *
 * Times are exchange rules, not data. Nothing here fetches anything, so it is pure and can be
 * tested against a frozen clock.
 */

export type IndiaPhase =
  | "CLOSED"
  | "PRE_OPEN_COLLECTION"
  | "PRE_OPEN_MATCHING"
  | "PRE_OPEN_BUFFER"
  | "REGULAR";

export type UsPhase =
  | "CLOSED"
  | "EARLY_TRADING"
  | "PRE_MARKET"
  | "OPENING_AUCTION_IMBALANCE"
  | "REGULAR"
  | "POST_CLOSE";

export type MarketPhase = IndiaPhase | UsPhase;

/**
 * The scalping evaluator declares its own session union with POST_CLOSE where the calendar
 * says EXTENDED. Same concept, different word — which made passing one into the other a type
 * error nobody had hit yet because nothing had tried. This is the single conversion point.
 */
export type SessionState = "PRE_OPEN" | "REGULAR" | "POST_CLOSE" | "CLOSED";

export function toSessionState(session: MarketSession): SessionState {
  return session === "EXTENDED" ? "POST_CLOSE" : session;
}

interface PhaseWindow {
  phase: MarketPhase;
  /** Minutes from local midnight, inclusive start, exclusive end. */
  from: number;
  to: number;
  /** What a strategy may legitimately read during this window. */
  knowable: string;
}

const minutes = (hour: number, minute = 0) => hour * 60 + minute;

const PHASES: Record<Market, readonly PhaseWindow[]> = {
  IN: [
    {
      phase: "PRE_OPEN_COLLECTION",
      from: minutes(9),
      to: minutes(9, 8),
      knowable:
        "Orders are being collected. Any indicative price is provisional and orders may still be withdrawn — treat it as a signal about intent, not about the open.",
    },
    {
      phase: "PRE_OPEN_MATCHING",
      from: minutes(9, 8),
      to: minutes(9, 12),
      knowable: "Equilibrium price and matched quantity are being determined. The result is final once published.",
    },
    {
      phase: "PRE_OPEN_BUFFER",
      from: minutes(9, 12),
      to: minutes(9, 15),
      knowable: "Transition to continuous trading. No new pre-open information arrives in this window.",
    },
    { phase: "REGULAR", from: minutes(9, 15), to: minutes(15, 30), knowable: "Continuous trading." },
  ],
  US: [
    {
      phase: "EARLY_TRADING",
      from: minutes(4),
      to: minutes(7),
      knowable:
        "Thin extended-hours trading. Spreads are wide and a single print can move the quoted price; size any read on it accordingly.",
    },
    {
      phase: "PRE_MARKET",
      from: minutes(7),
      to: minutes(9, 25),
      knowable: "Extended-hours trading with earnings and macro releases landing. Gap versus prior official close is meaningful.",
    },
    {
      phase: "OPENING_AUCTION_IMBALANCE",
      from: minutes(9, 25),
      to: minutes(9, 30),
      knowable:
        "Venues begin disseminating opening-cross imbalance information. This system has no entitlement to that feed and must say so rather than infer it.",
    },
    { phase: "REGULAR", from: minutes(9, 30), to: minutes(16), knowable: "Continuous trading." },
    {
      phase: "POST_CLOSE",
      from: minutes(16),
      to: minutes(20),
      knowable: "Extended-hours trading after the closing auction. The official close is already set.",
    },
  ],
};

/**
 * US half-days. Modelled separately from full holidays because the difference matters: on
 * these dates the market opens normally and closes at 13:00 ET, so a strategy holding to the
 * close is three hours out unless it knows.
 */
const EARLY_CLOSES: Record<Market, Readonly<Record<string, number>>> = {
  US: { "2026-11-27": minutes(13), "2026-12-24": minutes(13) },
  IN: {},
};

const HOLIDAYS: Record<Market, ReadonlySet<string>> = {
  US: new Set(["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]),
  IN: new Set(["2026-01-26", "2026-03-03", "2026-03-26", "2026-04-03", "2026-04-14", "2026-05-01", "2026-08-15", "2026-10-02", "2026-11-09", "2026-12-25"]),
};

const TIMEZONE: Record<Market, string> = { US: "America/New_York", IN: "Asia/Kolkata" };

export interface PhaseReading {
  market: Market;
  phase: MarketPhase;
  /** The coarse session, so existing consumers keep working unchanged. */
  session: MarketSession;
  sessionState: SessionState;
  knowable: string;
  localTime: string;
  timezone: string;
  localDate: string;
  isEarlyClose: boolean;
  /** Minutes until the phase changes, or null when the market is shut for the day. */
  minutesToNextBoundary: number | null;
  nextPhase: MarketPhase | null;
  /**
   * When the market next opens, populated only once it is shut for the day — which is exactly
   * when someone reading a pre-market screen wants it. Null while there is still a boundary
   * today, because `minutesToNextBoundary` already answers that.
   */
  nextSessionOpen: NextSessionOpen | null;
  holidaySource: "MARKETPULSE_2026_V2";
}

export interface NextSessionOpen {
  /** Local date at the exchange, YYYY-MM-DD. */
  date: string;
  weekday: string;
  /** Local clock time the first phase begins, HH:MM. */
  localTime: string;
  phase: MarketPhase;
}

const DAY_MS = 86_400_000;

function isTradingDay(market: Market, parts: { date: string; weekday: string }): boolean {
  return parts.weekday !== "Sat" && parts.weekday !== "Sun" && !HOLIDAYS[market].has(parts.date);
}

function clockTime(minutesFromMidnight: number): string {
  const hour = Math.floor(minutesFromMidnight / 60);
  return `${String(hour).padStart(2, "0")}:${String(minutesFromMidnight % 60).padStart(2, "0")}`;
}

/**
 * The next day this market opens.
 *
 * Reported as a local date and clock time rather than a minute countdown on purpose: a
 * countdown that spans a DST boundary is wrong by an hour twice a year, and a number that is
 * quietly wrong is worse than a date that is plainly right.
 *
 * Ten days covers any weekend plus the longest holiday cluster in either calendar; returning
 * null past that is honest, since a gap that long means the holiday table is stale.
 */
function findNextSessionOpen(market: Market, at: Date, today: string): NextSessionOpen | null {
  const first = PHASES[market][0];
  for (let dayOffset = 1; dayOffset <= 10; dayOffset += 1) {
    const parts = localParts(new Date(at.getTime() + dayOffset * DAY_MS), TIMEZONE[market]);
    // A DST shift can land the +24h step back on the same local date. Skip, do not double-count.
    if (parts.date === today || !isTradingDay(market, parts)) continue;
    return { date: parts.date, weekday: parts.weekday, localTime: clockTime(first.from), phase: first.phase };
  }
  return null;
}

function coarseSession(market: Market, phase: MarketPhase): MarketSession {
  if (phase === "REGULAR") return "REGULAR";
  if (phase === "CLOSED") return "CLOSED";
  if (phase === "POST_CLOSE") return "EXTENDED";
  return "PRE_OPEN";
}

export function getMarketPhase(market: Market, at: Date = new Date()): PhaseReading {
  const timezone = TIMEZONE[market];
  const local = localParts(at, timezone);
  const closedDay =
    local.weekday === "Sat" || local.weekday === "Sun" || HOLIDAYS[market].has(local.date);

  const earlyCloseAt = EARLY_CLOSES[market][local.date];
  const isEarlyClose = earlyCloseAt !== undefined;

  const base: Omit<
    PhaseReading,
    "phase" | "session" | "sessionState" | "knowable" | "minutesToNextBoundary" | "nextPhase" | "nextSessionOpen"
  > = {
    market,
    localTime: local.localTime,
    timezone,
    localDate: local.date,
    isEarlyClose,
    holidaySource: "MARKETPULSE_2026_V2",
  };

  if (closedDay) {
    return {
      ...base,
      phase: "CLOSED",
      session: "CLOSED",
      sessionState: "CLOSED",
      knowable: HOLIDAYS[market].has(local.date) ? "Exchange holiday." : "Weekend.",
      minutesToNextBoundary: null,
      nextPhase: null,
      nextSessionOpen: findNextSessionOpen(market, at, local.date),
    };
  }

  // An early close truncates every window that would have run past it.
  const windows = PHASES[market]
    .map((window) => (isEarlyClose ? { ...window, to: Math.min(window.to, earlyCloseAt) } : window))
    .filter((window) => window.to > window.from);

  const current = windows.find((window) => local.minutes >= window.from && local.minutes < window.to);
  if (!current) {
    const upcoming = windows.find((window) => window.from > local.minutes);
    return {
      ...base,
      phase: "CLOSED",
      session: "CLOSED",
      sessionState: "CLOSED",
      knowable: isEarlyClose && !upcoming ? "Early close: the session ended ahead of the usual time." : "Outside session hours.",
      minutesToNextBoundary: upcoming ? upcoming.from - local.minutes : null,
      nextPhase: upcoming?.phase ?? null,
      nextSessionOpen: upcoming ? null : findNextSessionOpen(market, at, local.date),
    };
  }

  const next = windows.find((window) => window.from === current.to);
  const session = coarseSession(market, current.phase);

  return {
    ...base,
    phase: current.phase,
    session,
    sessionState: toSessionState(session),
    knowable: current.knowable,
    minutesToNextBoundary: current.to - local.minutes,
    nextPhase: next?.phase ?? "CLOSED",
    nextSessionOpen: null,
  };
}

/**
 * Inputs a pre-market pipeline wants and this system genuinely cannot supply. Enumerated so a
 * screen can show what it could not see, rather than rendering a confident-looking report with
 * silent holes in it. Missing is not zero.
 */
export const UNAVAILABLE_PREMARKET_INPUTS: readonly { input: string; market: Market | "BOTH"; why: string }[] =
  Object.freeze([
    { input: "NSE pre-open equilibrium price and imbalance", market: "IN", why: "Requires NSE's licensed real-time feed; no entitlement configured." },
    { input: "F&O ban list, price bands, ASM/GSM stage", market: "IN", why: "Requires official NSE/BSE daily files; no ingestion configured." },
    { input: "Opening-cross imbalance (NOII)", market: "US", why: "Requires a Nasdaq/NYSE entitlement; not available to this deployment." },
    { input: "LULD bands and halt state", market: "US", why: "Requires the consolidated SIP feed; not available to this deployment." },
    { input: "Scheduled earnings dates", market: "BOTH", why: "The provider returns historical earnings records, not a forward calendar." },
  ]);
