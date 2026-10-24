import { describe, expect, it } from "vitest";
import { clockPlan, inMarketHours } from "./schedule";

const ist = (s: string) => new Date(`${s}:00+05:30`);
const hhmm = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);

describe("what a cloud clock run does, by when it starts (docs/plans/cloud-clock)", () => {
  it("loops at most 5 h 25 min from a morning start, inside GitHub's 6-hour job limit", () => {
    const plan = clockPlan(ist("2026-10-26T08:13"));
    expect(plan.mode).toBe("session");
    expect(hhmm(plan.deadline)).toBe("13:38");
  });

  it("ends a late or continuing run at 15:42, after IN1's window and the 15:31 coverage step", () => {
    expect(hhmm(clockPlan(ist("2026-10-26T13:40")).deadline)).toBe("15:42");
    expect(hhmm(clockPlan(ist("2026-10-26T09:40")).deadline), "a run GitHub started late").toBe("15:05");
  });

  it("does the slim cycle once outside the window, at weekends and on NSE holidays", () => {
    expect(clockPlan(ist("2026-10-26T15:45")).mode).toBe("once");
    expect(clockPlan(ist("2026-10-26T07:50")).mode).toBe("once");
    expect(clockPlan(ist("2026-10-24T10:00")).mode, "Saturday").toBe("once");
    expect(clockPlan(ist("2026-10-02T10:00")).mode, "Gandhi Jayanti").toBe("once");
  });

  it("expects a live quote only while the market trades", () => {
    expect(inMarketHours(ist("2026-10-26T10:00"))).toBe(true);
    expect(inMarketHours(ist("2026-10-26T09:10"))).toBe(false);
    expect(inMarketHours(ist("2026-10-26T15:35"))).toBe(false);
    expect(inMarketHours(ist("2026-10-24T10:00"))).toBe(false);
  });
});
