import { describe, expect, it } from "vitest";
import { clockPlan, daySnapshotDue, inMarketHours, istParts, nextChain, nextPassAt } from "./schedule";

const ist = (s: string) => new Date(`${s}:00+05:30`);
const hhmm = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16);

describe("what a cloud clock run does, by when it starts (docs/plans/cloud-clock)", () => {
  it("loops at most 5 h 25 min, inside GitHub's 6-hour job limit", () => {
    const plan = clockPlan(ist("2026-10-26T09:12"));
    expect(plan.mode).toBe("session");
    expect(hhmm(plan.deadline)).toBe("14:37");
  });

  it("hands an early run over at 09:10, so only one hand-over falls inside the 09:20-15:30 window", () => {
    expect(hhmm(clockPlan(ist("2026-10-26T04:15")).deadline)).toBe("09:10");
    expect(hhmm(clockPlan(ist("2026-10-26T08:13")).deadline)).toBe("09:10");
    // Tue 10-27: successors started at 09:09:02 and 09:09:24 were cut to 09:10 and hopped twice in a
    // minute, using the whole hand-over cap. A run from 09:00 runs its full 5 h 25 min instead.
    expect(hhmm(clockPlan(ist("2026-10-27T09:09")).deadline)).toBe("14:34");
  });

  it("ends a late or continuing run at 15:42, after IN1's window and the 15:31 coverage step", () => {
    expect(hhmm(clockPlan(ist("2026-10-26T13:40")).deadline)).toBe("15:42");
    expect(hhmm(clockPlan(ist("2026-10-26T09:40")).deadline), "a run GitHub started late").toBe("15:05");
  });

  it("starts the session from 03:30, because GitHub starts this repo's crons hours late", () => {
    // 2026-10-26: the 08:13 run had not begun at 09:11. An early run idles until 09:15 (orb.ts:210).
    expect(clockPlan(ist("2026-10-26T07:50")).mode).toBe("session");
    expect(clockPlan(ist("2026-10-26T03:20")).mode).toBe("once");
  });

  it("caps the hand-over chain, so a fault can never start runs without end", () => {
    // External review 2026-10-26: a self-starting chain needs a maximum continuation count. A lineage
    // needs at most three (the walk below); the fourth is spare, the fifth is refused.
    expect(nextChain(0)).toBe(1);
    expect(nextChain(3)).toBe(4);
    expect(nextChain(4)).toBeNull();
  });

  it("never needs more hand-overs than the cap allows, from any start", () => {
    // Review 2026-10-26: a start at 03:30-03:44 ends before 09:10 and needs three. Walk every minute.
    for (let start = ist("2026-10-27T03:30").getTime(); start < ist("2026-10-27T15:42").getTime(); start += 60_000) {
      let at = new Date(start);
      let chain = 0;
      for (let plan = clockPlan(at); plan.handOver; plan = clockPlan(at)) {
        const next = nextChain(chain);
        expect(next, `start ${hhmm(new Date(start))}`).not.toBeNull();
        chain = next!;
        at = new Date(plan.deadline.getTime() + 30_000); // the successor starts half a minute later
      }
    }
  });

  it("hands the session on when its cap comes before the close", () => {
    expect(clockPlan(ist("2026-10-26T08:13")).handOver).toBe(true);
    expect(clockPlan(ist("2026-10-26T13:40")).handOver, "this run reaches the close").toBe(false);
    expect(clockPlan(ist("2026-10-26T15:45")).handOver, "once").toBe(false);
  });

  it("does the slim cycle once outside the window, at weekends and on NSE holidays", () => {
    expect(clockPlan(ist("2026-10-26T15:45")).mode).toBe("once");
    expect(clockPlan(ist("2026-10-24T10:00")).mode, "Saturday").toBe("once");
    expect(clockPlan(ist("2026-10-02T10:00")).mode, "Gandhi Jayanti").toBe("once");
  });

  it("expects a live quote only while the market trades", () => {
    expect(inMarketHours(ist("2026-10-26T10:00"))).toBe(true);
    expect(inMarketHours(ist("2026-10-26T09:10"))).toBe(false);
    expect(inMarketHours(ist("2026-10-26T15:35"))).toBe(false);
    expect(inMarketHours(ist("2026-10-24T10:00"))).toBe(false);
  });

  it("hands over right after the last pass, not after idling to the deadline", () => {
    // Review 2026-10-24: idling up to 60 s before the hand-over pushed the gap between runs past
    // the 120 s coverage rule, so most sessions would read PARTIAL by construction.
    const deadline = Date.parse("2026-10-26T08:08:30Z");
    expect(nextPassAt(Date.parse("2026-10-26T08:07:10Z"), deadline)).toBe(Date.parse("2026-10-26T08:08:01Z"));
    expect(nextPassAt(Date.parse("2026-10-26T08:08:05Z"), deadline)).toBeNull();
  });

  it("snapshots the day only once the session's coverage row exists, 15:50 IST", () => {
    expect(daySnapshotDue(ist("2026-10-26T15:49"))).toBe(false);
    expect(daySnapshotDue(ist("2026-10-26T15:50"))).toBe(true);
    expect(daySnapshotDue(ist("2026-10-26T09:30"))).toBe(false);
    expect(daySnapshotDue(ist("2026-10-24T16:00")), "Saturday: no session, no snapshot").toBe(false);
    // 00:10 IST on the 26th is still the 25th in UTC: the snapshot is named for the IST day.
    expect(istParts(ist("2026-10-26T00:10")).day).toBe("2026-10-26");
    expect(istParts(ist("2026-10-26T23:50")).day).toBe("2026-10-26");
  });
});
