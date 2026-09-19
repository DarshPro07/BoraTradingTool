import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { MANDATES, shiftDate, type Close, type MandateContract } from "./mandates";
import { readFund } from "./ledger";
import { runFundPass, type Execution, type FundDeps } from "./run";

/**
 * The autonomous pass, driven with fake bars and fake engines so every branch is exercised without
 * the network: decide once, execute on the right side of the session, mark every bar, kill on breach.
 */
useTemporaryDatabase();

type Bars = Record<string, Close[]>;
function fakeDeps(bars: Bars, opts: { nseOpen?: boolean } = {}) {
  const orders: { mandate: string; side: string; amount: number }[] = [];
  const deps: FundDeps = {
    loadCloses: async (m) => bars[m.id] ?? [],
    bookCapital: (m) => (m.venue === "NSE" ? 25_000 : 300),
    canExecute: (m) => m.venue === "SOLANA" || (opts.nseOpen ?? false),
    execute: async (m: MandateContract, side, amount, price): Promise<Execution> => {
      orders.push({ mandate: m.id, side, amount });
      const quantity = side === "BUY" ? Math.floor((amount / price) * 1e6) / 1e6 : amount;
      return {
        status: "FILLED", reason: null, fillPrice: price, fees: 0,
        quantityDelta: side === "BUY" ? quantity : -quantity,
        cashDelta: side === "BUY" ? -quantity * price : quantity * price,
      };
    },
    tradeDate: (_m, now) => now.toISOString().slice(0, 10),
  };
  return { deps, orders };
}

/** Daily closes ending the day before `end`, rising or falling linearly. */
function closes(end: string, count: number, from: number, to: number): Close[] {
  return Array.from({ length: count }, (_, i) => ({
    date: shiftDate(end, i - count),
    close: from + ((to - from) * i) / (count - 1),
  }));
}

const NOW = new Date("2026-09-21T06:00:00Z"); // Monday: Sunday 09-20 is the latest completed crypto bar

describe("runFundPass", () => {
  it("bootstraps each mandate once and is idempotent when run again", async () => {
    const bars = { FN1: closes("2026-09-21", 260, 200, 260), FC1: closes("2026-09-21", 60, 100, 150), FC2: closes("2026-09-21", 60, 100, 150) };
    const { deps } = fakeDeps(bars);
    await runFundPass(deps, NOW);
    await runFundPass(deps, NOW);
    for (const m of MANDATES) {
      const decisions = readFund("decision", m.id);
      expect(decisions, `${m.id} decides exactly once`).toHaveLength(1);
      expect(decisions[0]!.bootstrap).toBe(true);
      expect(decisions[0]!.hold, "rising prices -> hold").toBe(true);
      expect(readFund("nav", m.id), `${m.id} marks each bar once`).toHaveLength(1);
    }
    expect(readFund("decision", "FN1")[0]!.capital).toBe(0.15 * 25_000);
  });

  it("waits for the NSE session to execute, while crypto executes at once", async () => {
    const bars = { FN1: closes("2026-09-21", 260, 200, 260), FC1: closes("2026-09-21", 60, 100, 150) };
    const closed = fakeDeps(bars, { nseOpen: false });
    await runFundPass(closed.deps, NOW);
    expect(closed.orders.map((o) => o.mandate)).toEqual(["FC1"]);

    const open = fakeDeps(bars, { nseOpen: true });
    await runFundPass(open.deps, NOW);
    expect(open.orders.map((o) => o.mandate), "FN1 buys at the next opportunity; FC1 already holds").toEqual(["FN1"]);
    expect(readFund("execution", "FC1")).toHaveLength(1);
  });

  it("decides only the latest due date, never a missed one after the fact", async () => {
    const early = { FC1: closes("2026-09-07", 60, 100, 150) };
    await runFundPass(fakeDeps(early).deps, new Date("2026-09-07T06:00:00Z"));
    // Two Sundays (09-13, 09-20) pass while the machine is off.
    const later = { FC1: closes("2026-09-21", 74, 100, 150) };
    await runFundPass(fakeDeps(later).deps, NOW);
    expect(readFund("decision", "FC1").map((d) => d.decisionDate)).toEqual(["2026-09-06", "2026-09-20"]);
  });

  it("kills a mandate past its drawdown limit, goes flat, and stops deciding", async () => {
    const up = { FC1: closes("2026-09-14", 60, 100, 150) };
    await runFundPass(fakeDeps(up).deps, new Date("2026-09-14T06:00:00Z"));
    // A 60% crash in a week breaches FC1's 50% kill drawdown.
    const crash = { FC1: [...up.FC1, ...closes("2026-09-21", 7, 140, 60).map((c) => c)] };
    const { deps, orders } = fakeDeps(crash);
    await runFundPass(deps, NOW);
    expect(readFund("kill", "FC1")).toHaveLength(1);
    await runFundPass(deps, NOW);
    expect(orders.some((o) => o.side === "SELL"), "suspended means flat").toBe(true);
    const decisionsAfter = readFund("decision", "FC1").length;
    await runFundPass(deps, new Date("2026-09-29T06:00:00Z"));
    expect(readFund("decision", "FC1").length, "no new decisions once suspended").toBe(decisionsAfter);
  });
});
