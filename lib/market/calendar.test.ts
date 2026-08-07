import { describe, expect, it } from "vitest";
import { getMarketSession } from "./calendar";

describe("getMarketSession", () => {
  it("classifies regular US and India cash sessions", () => {
    expect(getMarketSession("US", new Date("2026-07-06T14:00:00Z"))).toMatchObject({
      session: "REGULAR",
      timezone: "America/New_York",
    });
    expect(getMarketSession("IN", new Date("2026-07-06T04:00:00Z"))).toMatchObject({
      session: "REGULAR",
      timezone: "Asia/Kolkata",
    });
  });

  it("classifies pre-open and US extended sessions", () => {
    expect(getMarketSession("US", new Date("2026-07-06T12:00:00Z")).session).toBe("PRE_OPEN");
    expect(getMarketSession("US", new Date("2026-07-06T21:00:00Z")).session).toBe("EXTENDED");
    expect(getMarketSession("IN", new Date("2026-07-06T03:40:00Z")).session).toBe("PRE_OPEN");
  });

  it("closes weekends and versioned holidays", () => {
    expect(getMarketSession("US", new Date("2026-07-05T15:00:00Z")).session).toBe("CLOSED");
    expect(getMarketSession("US", new Date("2026-07-03T15:00:00Z")).session).toBe("CLOSED");
    expect(getMarketSession("IN", new Date("2026-01-26T05:00:00Z")).session).toBe("CLOSED");
  });
});
