import { describe, expect, it } from "vitest";
import { judgeCalendarExtension, renderCalendarFile } from "./calendar-extension";

/**
 * The calendar extends itself from price data, and must fail CLOSED.
 *
 * Getting it wrong in the permissive direction is data loss: a date wrongly recorded as a holiday
 * makes the write guard reject that session's real bars forever. Getting it wrong in the
 * conservative direction costs only time — research keeps withholding the date until a human or a
 * later pass resolves it. So every ambiguity stops the extension rather than guessing.
 */

const REFERENCE = 100;
/** 100 reference instruments, all observed through `last`. */
const observedThrough = (last: string) => Array.from({ length: REFERENCE }, () => last);

function judge(
  participation: Record<string, number>,
  over: Partial<Parameters<typeof judgeCalendarExtension>[0]> = {},
) {
  return judgeCalendarExtension({
    derivedThrough: "2026-09-04", // Friday
    holidays: new Set(["2026-09-14"]),
    weekendSessions: new Set<string>(),
    referenceLastDates: observedThrough("2026-09-11"),
    participation: new Map(Object.entries(participation)),
    ...over,
  });
}

describe("judgeCalendarExtension", () => {
  it("advances across unambiguous sessions and a normal weekend", () => {
    const verdict = judge({
      "2026-09-07": 100, "2026-09-08": 98, "2026-09-09": 100, "2026-09-10": 97, "2026-09-11": 100,
    });
    expect(verdict.derivedThrough).toBe("2026-09-11");
    expect(verdict.addedHolidays).toEqual([]);
    expect(verdict.stopReason).toBeNull();
  });

  it("records a weekday nobody traded as a holiday", () => {
    const verdict = judge({ "2026-09-07": 100, "2026-09-09": 100, "2026-09-10": 100, "2026-09-11": 100 });
    expect(verdict.addedHolidays).toEqual(["2026-09-08"]);
    expect(verdict.derivedThrough).toBe("2026-09-11");
  });

  it("STOPS at a half-observed weekday rather than guess which way it went", () => {
    // 30% participation: too many bars for a holiday, too few to vouch for a session.
    const verdict = judge({ "2026-09-07": 100, "2026-09-08": 30, "2026-09-09": 100 });
    expect(verdict.derivedThrough).toBe("2026-09-07");
    expect(verdict.stoppedAt).toBe("2026-09-08");
    expect(verdict.stopReason).toMatch(/ambiguous/i);
    expect(verdict.addedHolidays).toEqual([]);
  });

  it("STOPS when a date the calendar already calls a holiday carries bars", () => {
    const verdict = judge(
      { "2026-09-07": 100, "2026-09-08": 100, "2026-09-09": 100, "2026-09-10": 100, "2026-09-11": 100, "2026-09-14": 100 },
      { referenceLastDates: observedThrough("2026-09-15") },
    );
    expect(verdict.stoppedAt).toBe("2026-09-14");
    expect(verdict.stopReason).toMatch(/contradict/i);
    // The empty weekend before it is judged normally; the stop is AT the contradiction.
    expect(verdict.derivedThrough).toBe("2026-09-13");
  });

  it("confirms a declared holiday that shows no bars", () => {
    const all = { "2026-09-07": 100, "2026-09-08": 100, "2026-09-09": 100, "2026-09-10": 100, "2026-09-11": 100, "2026-09-15": 100 };
    const verdict = judge(all, { referenceLastDates: observedThrough("2026-09-15") });
    expect(verdict.derivedThrough).toBe("2026-09-15");
    expect(verdict.addedHolidays).toEqual([]);
  });

  it("does not advance past the point too few instruments have been observed through", () => {
    // Half the reference is still stuck at 09-08: an ingestion backlog, not a market fact.
    const lastDates = [...Array(40).fill("2026-09-11"), ...Array(60).fill("2026-09-08")];
    const verdict = judge(
      { "2026-09-07": 100, "2026-09-08": 100, "2026-09-09": 40, "2026-09-10": 40, "2026-09-11": 40 },
      { referenceLastDates: lastDates },
    );
    expect(verdict.derivedThrough).toBe("2026-09-08");
    expect(verdict.stopReason).toBeNull(); // the frontier, not an anomaly
  });

  it("adds a weekend session only on a quorum, and stops on a weekend with a few stray bars", () => {
    const muhurat = judge({ "2026-09-05": 90, "2026-09-07": 100 }, { referenceLastDates: observedThrough("2026-09-07") });
    expect(muhurat.addedWeekendSessions).toEqual(["2026-09-05"]);
    expect(muhurat.derivedThrough).toBe("2026-09-07");

    const stray = judge({ "2026-09-05": 3, "2026-09-07": 100 }, { referenceLastDates: observedThrough("2026-09-07") });
    expect(stray.stoppedAt).toBe("2026-09-05");
    expect(stray.derivedThrough).toBe("2026-09-04");
  });

  it("refuses to judge from too small a reference set", () => {
    const verdict = judge({ "2026-09-07": 5 }, { referenceLastDates: Array(5).fill("2026-09-11") });
    expect(verdict.derivedThrough).toBe("2026-09-04");
  });
});

describe("renderCalendarFile", () => {
  it("renders every set and the derived-through date", () => {
    const text = renderCalendarFile({
      holidays: ["2026-09-14"],
      weekendSessions: ["2026-11-08"],
      declared: ["2026-09-14", "2026-11-08"],
      derivedThrough: "2026-09-11",
      provenance: "test",
    });
    expect(text).toContain('export const CALENDAR_DERIVED_THROUGH = "2026-09-11";');
    expect(text).toMatch(/NSE_TRADING_HOLIDAYS[\s\S]*"2026-09-14"/);
    expect(text).toMatch(/NSE_WEEKEND_SESSIONS[\s\S]*"2026-11-08"/);
    expect(text).toContain("GENERATED");
  });
});
