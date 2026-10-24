import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { intradayReport } from "./report";

describe("TL-1: IN1's denominator", () => {
  useTemporaryDatabase();
  const t1 = (at: Date) => intradayReport(at).gates.reasons.find((r) => r.startsWith("T1"));

  it("counts every session since activation, so a clock that never decided is not 0/0", () => {
    // 2026-09-21 to 2026-10-22: 22 sessions (Gandhi Jayanti 10-02 and Dussehra 10-20 closed).
    expect(t1(new Date("2026-10-22T16:00:00+05:30"))).toContain("0/22 decisions");
  });

  it("counts today only once it has closed or decided: no dip before 09:20", () => {
    expect(t1(new Date("2026-10-22T09:00:00+05:30"))).toContain("0/21 decisions");
    getDb().insert(schema.auditEvents).values({
      actor: "intraday", action: "intraday_decision", decision: "allowed", subject: "IN1:d", createdAt: new Date(),
      detail: JSON.stringify({ hash: "h", day: "2026-10-22", instrumentId: "IN:XNSE:RELIANCE", long: false, stop: 1, first: { open: 1, high: 1, low: 1, close: 1 } }),
    }).run();
    expect(t1(new Date("2026-10-22T09:21:00+05:30"))).toContain("1/22 decisions");
  });
});
