import { describe, expect, it } from "vitest";
import { getMarketPhase, toSessionState, UNAVAILABLE_PREMARKET_INPUTS } from "./phases";

/**
 * Every case pins an exact instant. Session logic that is only tested "around now" passes in
 * the morning and fails after lunch, so the clock is frozen at each boundary deliberately.
 */

/** 2026-08-06 is a Thursday, and a trading day in both markets. */
const ist = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 7, 6, hour - 5, minute - 30)); // IST = UTC+5:30
const et = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 7, 6, hour + 4, minute)); // EDT = UTC-4

describe("India pre-open is three phases, not one", () => {
  it("collects orders from 09:00", () => {
    const reading = getMarketPhase("IN", ist(9, 0));
    expect(reading.phase).toBe("PRE_OPEN_COLLECTION");
    expect(reading.session).toBe("PRE_OPEN");
    expect(reading.knowable).toMatch(/provisional/);
  });

  it("switches to matching at 09:08, not at 09:15", () => {
    expect(getMarketPhase("IN", ist(9, 7)).phase).toBe("PRE_OPEN_COLLECTION");
    expect(getMarketPhase("IN", ist(9, 8)).phase).toBe("PRE_OPEN_MATCHING");
  });

  it("buffers from 09:12 until the bell", () => {
    expect(getMarketPhase("IN", ist(9, 12)).phase).toBe("PRE_OPEN_BUFFER");
    expect(getMarketPhase("IN", ist(9, 14)).phase).toBe("PRE_OPEN_BUFFER");
  });

  it("opens continuous trading at 09:15", () => {
    expect(getMarketPhase("IN", ist(9, 15)).phase).toBe("REGULAR");
  });

  it("closes at 15:30 and has no extended session", () => {
    expect(getMarketPhase("IN", ist(15, 29)).phase).toBe("REGULAR");
    expect(getMarketPhase("IN", ist(15, 30)).phase).toBe("CLOSED");
  });

  it("is closed before the pre-open begins", () => {
    expect(getMarketPhase("IN", ist(8, 59)).phase).toBe("CLOSED");
  });
});

describe("US pre-market is five and a half hours of different things", () => {
  it("starts early trading at 04:00", () => {
    expect(getMarketPhase("US", et(4, 0)).phase).toBe("EARLY_TRADING");
    expect(getMarketPhase("US", et(3, 59)).phase).toBe("CLOSED");
  });

  it("becomes pre-market proper at 07:00", () => {
    expect(getMarketPhase("US", et(7, 0)).phase).toBe("PRE_MARKET");
  });

  it("enters the auction-imbalance window at 09:25", () => {
    expect(getMarketPhase("US", et(9, 24)).phase).toBe("PRE_MARKET");
    const reading = getMarketPhase("US", et(9, 25));
    expect(reading.phase).toBe("OPENING_AUCTION_IMBALANCE");
    // The window exists so the system can say what it cannot see, not pretend it can.
    expect(reading.knowable).toMatch(/no entitlement|must say so/);
  });

  it("opens at 09:30 and closes at 16:00 into post-close", () => {
    expect(getMarketPhase("US", et(9, 30)).phase).toBe("REGULAR");
    expect(getMarketPhase("US", et(15, 59)).phase).toBe("REGULAR");
    expect(getMarketPhase("US", et(16, 0)).phase).toBe("POST_CLOSE");
    expect(getMarketPhase("US", et(20, 0)).phase).toBe("CLOSED");
  });
});

describe("countdown to the next boundary", () => {
  it("counts down within a phase", () => {
    expect(getMarketPhase("IN", ist(9, 5)).minutesToNextBoundary).toBe(3);
    expect(getMarketPhase("IN", ist(9, 5)).nextPhase).toBe("PRE_OPEN_MATCHING");
  });

  it("counts down to the open while the market is shut", () => {
    const reading = getMarketPhase("IN", ist(8, 30));
    expect(reading.minutesToNextBoundary).toBe(30);
    expect(reading.nextPhase).toBe("PRE_OPEN_COLLECTION");
  });

  it("has no next boundary once the day is over", () => {
    expect(getMarketPhase("IN", ist(16, 0)).minutesToNextBoundary).toBeNull();
  });
});

describe("when the market next opens", () => {
  it("names the next trading day once today is over", () => {
    // 2026-08-06 is a Thursday, so the answer is simply tomorrow.
    expect(getMarketPhase("IN", ist(16, 0)).nextSessionOpen).toEqual({
      date: "2026-08-07",
      weekday: "Fri",
      localTime: "09:00",
      phase: "PRE_OPEN_COLLECTION",
    });
  });

  it("skips the weekend", () => {
    // 2026-08-08 is a Saturday; the next open is Monday, not Sunday.
    const saturday = new Date(Date.UTC(2026, 7, 8, 6, 0));
    expect(getMarketPhase("IN", saturday).nextSessionOpen?.date).toBe("2026-08-10");
    expect(getMarketPhase("IN", saturday).nextSessionOpen?.weekday).toBe("Mon");
  });

  it("skips a holiday that falls against a weekend", () => {
    // 2026-08-14 Friday, 16:00 IST. The 15th is Independence Day *and* a Saturday, so a naive
    // "next weekday" answer would be Monday by luck rather than by checking the calendar.
    const friday = new Date(Date.UTC(2026, 7, 14, 10, 30));
    expect(getMarketPhase("IN", friday).nextSessionOpen?.date).toBe("2026-08-17");
  });

  it("opens the half-day after a holiday like any other day", () => {
    // Thanksgiving 2026-11-26 (Thursday, EST). The next open is the 27th at 04:00 — a half day
    // still opens on time; it is the close that moves.
    const thanksgiving = new Date(Date.UTC(2026, 10, 26, 17, 0));
    expect(getMarketPhase("US", thanksgiving).nextSessionOpen).toEqual({
      date: "2026-11-27",
      weekday: "Fri",
      localTime: "04:00",
      phase: "EARLY_TRADING",
    });
  });

  it("is null while a boundary is still coming today", () => {
    expect(getMarketPhase("IN", ist(8, 30)).nextSessionOpen).toBeNull(); // pre-open ahead
    expect(getMarketPhase("IN", ist(10, 0)).nextSessionOpen).toBeNull(); // mid-session
  });
});

describe("non-trading days", () => {
  it("is closed at the weekend", () => {
    // 2026-08-08 is a Saturday.
    const saturday = new Date(Date.UTC(2026, 7, 8, 6, 0));
    expect(getMarketPhase("IN", saturday).phase).toBe("CLOSED");
    expect(getMarketPhase("IN", saturday).knowable).toBe("Weekend.");
  });

  it("is closed on an exchange holiday and says which kind", () => {
    // 2026-08-15 is Independence Day in India — and a Saturday, so the US case proves the
    // holiday branch independently: 2026-09-07 is Labor Day, a Monday.
    const labourDay = new Date(Date.UTC(2026, 8, 7, 14, 0));
    const reading = getMarketPhase("US", labourDay);
    expect(reading.phase).toBe("CLOSED");
    expect(reading.knowable).toBe("Exchange holiday.");
  });
});

describe("US early closes", () => {
  // 2026-11-27 is the half-day after Thanksgiving: open normally, close at 13:00 ET.
  const halfDay = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 27, hour + 5, minute)); // EST = UTC-5

  it("trades normally in the morning", () => {
    const reading = getMarketPhase("US", halfDay(10, 0));
    expect(reading.phase).toBe("REGULAR");
    expect(reading.isEarlyClose).toBe(true);
  });

  it("closes at 13:00 rather than 16:00", () => {
    expect(getMarketPhase("US", halfDay(12, 59)).phase).toBe("REGULAR");
    expect(getMarketPhase("US", halfDay(13, 0)).phase).toBe("CLOSED");
  });

  it("has no post-close session on a half day", () => {
    expect(getMarketPhase("US", halfDay(17, 0)).phase).toBe("CLOSED");
  });
});

describe("the two session vocabularies now reconcile", () => {
  it("maps EXTENDED to the POST_CLOSE the scalping evaluator expects", () => {
    expect(toSessionState("EXTENDED")).toBe("POST_CLOSE");
    expect(toSessionState("REGULAR")).toBe("REGULAR");
    expect(toSessionState("PRE_OPEN")).toBe("PRE_OPEN");
    expect(toSessionState("CLOSED")).toBe("CLOSED");
  });

  it("exposes a sessionState on every reading, ready to hand to the scalper", () => {
    expect(getMarketPhase("US", et(17, 0)).sessionState).toBe("POST_CLOSE");
    expect(getMarketPhase("US", et(9, 25)).sessionState).toBe("PRE_OPEN");
  });
});

describe("honesty about missing inputs", () => {
  it("names every pre-market input it cannot supply, with a reason", () => {
    expect(UNAVAILABLE_PREMARKET_INPUTS.length).toBeGreaterThanOrEqual(5);
    for (const entry of UNAVAILABLE_PREMARKET_INPUTS) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });
});
