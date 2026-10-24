import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { coverageFor, heartbeats, recordSessionCoverage, runLog } from "./coverage";

const ist = (day: string, hhmm: string) => Date.parse(`${day}T${hhmm}:00+05:30`);
const everyMinute = (day: string, from: string, to: string) => {
  const beats: number[] = [];
  for (let t = ist(day, from); t <= ist(day, to); t += 60_000) beats.push(t + 4_000);
  return beats;
};

describe("EC-2: every run leaves a line", () => {
  it("writes a heartbeat even when the pass did nothing", () => {
    // Before S1.b the entry printed only when it had lines: a quiet minute left no trace, so a dead
    // clock and an idle one looked the same in logs/intraday.log.
    const at = new Date("2026-09-21T03:50:04.000Z");
    expect(runLog("intraday-scheduler", at, { acquired: true, blockedBy: null, result: [] })).toBe("[intraday-scheduler] 2026-09-21T03:50:04.000Z ran\n");
    expect(runLog("intraday-scheduler", at, { acquired: false, blockedBy: { holder: "cycle", acquiredAt: 0 }, result: null }))
      .toBe("[intraday-scheduler] 2026-09-21T03:50:04.000Z skipped: cycle holds the intraday lease\n");
  });

  it("reads back ran and skipped lines only", () => {
    const log = [
      "[intraday-scheduler] 2026-09-21T03:50:04.000Z ran",
      "  IN:XNSE:RELIANCE: decided LONG, stop 90",
      "[intraday-scheduler] 2026-09-21T03:51:04.000Z skipped: cycle holds the intraday lease",
      "[intraday-scheduler] 2026-09-21T03:52:04.000Z error: provider down",
      "[intraday-scheduler] 2026-09-21T03:53:04.000Z idle: the cloud clock owns the ledger", // the laptop while the cloud runs IN1
      "[intraday-scheduler] 2026-10-23T04:31:55.146Z", // the pre-S1.b format: not a heartbeat
    ].join("\n");
    expect(heartbeats(log)).toEqual([Date.parse("2026-09-21T03:50:04.000Z"), Date.parse("2026-09-21T03:51:04.000Z")]);
  });
});

describe("EC-1: session coverage", () => {
  const day = "2026-09-21";

  it("COVERED with no gap over 2 minutes from 09:20 to 15:30", () => {
    expect(coverageFor(day, everyMinute(day, "09:14", "15:39")).coverage).toBe("COVERED");
  });

  it("PARTIAL for 2026-10-23's shape: the charger out at 12:07, a flat battery at 13:15", () => {
    const result = coverageFor(day, everyMinute(day, "09:46", "12:07"));
    expect(result.coverage).toBe("PARTIAL");
    expect(result.maxGapSeconds).toBeGreaterThan(3 * 3600);
  });

  it("CENSORED with no heartbeat in the window", () => {
    expect(coverageFor(day, everyMinute(day, "08:00", "09:10")).coverage).toBe("CENSORED");
  });

  describe("the cycle's writer", () => {
    useTemporaryDatabase();
    const log = everyMinute(day, "09:14", "15:39").map((t) => `[intraday-scheduler] ${new Date(t).toISOString()} ran`).join("\n");
    const rows = () => getDb().select().from(schema.auditEvents).all().filter((r) => r.action === "session_coverage");

    it("judges nothing from a missing or empty log: a permanent CENSORED row needs evidence the log exists", () => {
      // Review 18:43: a missing logs/intraday.log made every day CENSORED, for good (the rows are never rewritten).
      expect(recordSessionCoverage("", new Date("2026-09-23T16:00:00+05:30"), "2026-09-19")).toEqual([]);
      expect(rows()).toHaveLength(0);
    });

    it("writes one row per session day from go-live, today only after 15:31, idempotent", () => {
      const wednesday = new Date("2026-09-23T15:00:00+05:30");
      expect(recordSessionCoverage(log, wednesday, "2026-09-19")).toHaveLength(2); // Sat 19, Sun 20 skipped; Wed not yet
      expect(rows().map((r) => r.subject)).toEqual(["coverage:2026-09-21", "coverage:2026-09-22"]);
      expect(JSON.parse(rows()[0]!.detail!).coverage).toBe("COVERED");
      expect(JSON.parse(rows()[1]!.detail!).coverage).toBe("CENSORED");

      recordSessionCoverage(log, new Date("2026-09-23T15:31:00+05:30"), "2026-09-19");
      recordSessionCoverage(log, new Date("2026-09-23T16:00:00+05:30"), "2026-09-19");
      expect(rows().map((r) => r.subject)).toEqual(["coverage:2026-09-21", "coverage:2026-09-22", "coverage:2026-09-23"]);
    });
  });
});
