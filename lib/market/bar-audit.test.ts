import { describe, expect, it } from "vitest";
import { auditBars } from "./bar-audit";

/**
 * The audit exists because HTTP 200 is not a complete dataset. Its motivating case is first:
 * a 59-day request answered with one session looked like success at every layer for weeks.
 */

/** 09:15 IST on the given date, as epoch seconds. */
function sessionOpen(date: string): number {
  return Math.floor(new Date(`${date}T09:15:00+05:30`).getTime() / 1000);
}

/** A full NSE session of 5-minute bars: 09:15 → 15:30 is 375 minutes, 75 bars. */
function fullSession(date: string, bars = 75): { time: number }[] {
  const open = sessionOpen(date);
  return Array.from({ length: bars }, (_, index) => ({ time: open + index * 300 }));
}

const WEEK_START = sessionOpen("2026-06-01");
const WEEK_END = sessionOpen("2026-06-05") + 86_400;

describe("bar gap auditing", () => {
  it("catches THE defect: a wide window answered with a single session", () => {
    const audit = auditBars(fullSession("2026-06-05"), {
      market: "IN",
      requestedStart: sessionOpen("2026-04-01"),
      requestedEnd: sessionOpen("2026-06-05") + 86_400,
      resolutionMinutes: 5,
    });
    expect(audit.completeness).toBe("PARTIAL");
    expect(audit.observedSessions).toBe(1);
    expect(audit.expectedSessions).toBeGreaterThan(40);
    expect(audit.detail).toMatch(/1 session\(s\); the declared calendar expected \d+ session/);
    // The request is stored beside the response — the comparison itself is the evidence.
    expect(audit.requestedStart).toBe(sessionOpen("2026-04-01"));
    expect(audit.returnedBarCount).toBe(75);
  });

  it("calls a full week COMPLETE", () => {
    const bars = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"].flatMap((date) =>
      fullSession(date),
    );
    const audit = auditBars(bars, {
      market: "IN",
      requestedStart: WEEK_START,
      requestedEnd: WEEK_END,
      resolutionMinutes: 5,
    });
    expect(audit.completeness).toBe("COMPLETE");
    expect(audit.observedSessions).toBe(5);
    expect(audit.expectedSessions).toBe(5);
    expect(audit.shortSessions).toBe(0);
  });

  it("flags SESSION_GAPS when a returned session is short — no holiday calendar needed for that", () => {
    const bars = [...fullSession("2026-06-01"), ...fullSession("2026-06-02", 20)];
    const audit = auditBars(bars, {
      market: "IN",
      requestedStart: WEEK_START,
      requestedEnd: sessionOpen("2026-06-02") + 86_400,
      resolutionMinutes: 5,
    });
    expect(audit.completeness).toBe("SESSION_GAPS");
    expect(audit.shortSessions).toBe(1);
    expect(audit.detail).toMatch(/below 80% of a full day/);
  });

  it("flags DUPLICATES and OUT_OF_SESSION distinctly", () => {
    const duplicated = [...fullSession("2026-06-01"), { time: sessionOpen("2026-06-01") }];
    expect(auditBars(duplicated, { market: "IN", requestedStart: WEEK_START, requestedEnd: WEEK_END, resolutionMinutes: 5 }).completeness).toBe("DUPLICATES");

    const strays = [...fullSession("2026-06-01"), { time: sessionOpen("2026-06-01") + 12 * 3600 }];
    const audit = auditBars(strays, { market: "IN", requestedStart: WEEK_START, requestedEnd: WEEK_END, resolutionMinutes: 5 });
    expect(audit.completeness).toBe("OUT_OF_SESSION");
    expect(audit.outOfSessionBars).toBe(1);
  });

  it("calls a wholesale shift TIMEZONE_ERROR rather than a handful of stray bars", () => {
    // Every bar five and a half hours early: the classic UTC-vs-IST mistake.
    const shifted = fullSession("2026-06-01").map((bar) => ({ time: bar.time - 5.5 * 3600 }));
    const audit = auditBars(shifted, {
      market: "IN",
      requestedStart: WEEK_START,
      requestedEnd: WEEK_END,
      resolutionMinutes: 5,
    });
    expect(audit.completeness).toBe("TIMEZONE_ERROR");
    expect(audit.outOfSessionBars).toBeGreaterThan(audit.returnedBarCount / 2);
  });

  it("reports EMPTY as its own state — an empty response is a fact, not a completeness verdict", () => {
    const audit = auditBars([], { market: "IN", requestedStart: WEEK_START, requestedEnd: WEEK_END, resolutionMinutes: 5 });
    expect(audit.completeness).toBe("EMPTY");
    expect(audit.returnedFirstBar).toBeNull();
    expect(audit.detail).toMatch(/returned no bars for a window the declared calendar says held/);
  });

  it("audits daily bars against trading days, tolerating a listing that began mid-window", () => {
    const daily = Array.from({ length: 5 }, (_, index) => ({ time: sessionOpen("2026-06-01") + index * 86_400 }));
    const complete = auditBars(daily, { market: "IN", requestedStart: WEEK_START, requestedEnd: WEEK_END, resolutionMinutes: null });
    expect(complete.completeness).toBe("COMPLETE");
    expect(complete.expectedSessions).toBe(5);

    const short = auditBars(daily.slice(0, 2), { market: "IN", requestedStart: WEEK_START, requestedEnd: WEEK_END, resolutionMinutes: null });
    expect(short.completeness).toBe("PARTIAL");
    expect(short.detail).toMatch(/listed mid-window legitimately has fewer/);
  });

  it("uses the declared holiday model, not a naive weekday count", () => {
    // 2026-08-15 (Independence Day) is in the declared IN holiday set and must not be expected.
    const audit = auditBars([], {
      market: "IN",
      requestedStart: sessionOpen("2026-08-14"),
      requestedEnd: sessionOpen("2026-08-15") + 86_400,
      resolutionMinutes: null,
    });
    expect(audit.expectedSessions).toBe(1);
  });
});
