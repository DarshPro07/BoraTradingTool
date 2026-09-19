import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { ORB_CONTRACT, orbDailyPnl, orbDecision, orbQuantity, readOrb, runIntradayPass, type IntradayDeps } from "./orb";

describe("the ORB rule and its money management", () => {
  it("goes long only when the first candle closed up, stopped at its low", () => {
    expect(orbDecision({ open: 100, high: 103, low: 99, close: 102 })).toEqual({ long: true, stop: 99 });
    expect(orbDecision({ open: 100, high: 101, low: 97, close: 98 }).long).toBe(false);
  });

  it("risks 0.5% of the book, capped by the position cap and cash", () => {
    // 25,000 book: risk 125; stop 5 away -> 25 shares by risk; cap 15% -> 3,750 / 100 = 37. Risk binds.
    expect(orbQuantity({ entry: 100, stop: 95, book: 25_000, cash: 25_000, capPct: 15 })).toBe(25);
    // Tight stop: risk allows 250, the cap allows 37.
    expect(orbQuantity({ entry: 100, stop: 99.5, book: 25_000, cash: 25_000, capPct: 15 })).toBe(37);
    expect(orbQuantity({ entry: 95, stop: 95, book: 25_000, cash: 25_000, capPct: 15 }), "no stop distance, no trade").toBe(0);
  });
});

describe("runIntradayPass", () => {
  useTemporaryDatabase();

  /** IST wall clock on Monday 2026-09-21. */
  const at = (hhmm: string) => new Date(`2026-09-21T${hhmm}:00+05:30`);
  function fake(prices: Record<string, number>, first = { open: 100, high: 103, low: 99, close: 102 }) {
    const orders: { id: string; side: string; qty: number }[] = [];
    const deps: IntradayDeps = {
      firstCandle: async () => first,
      lastPrice: async (id) => prices[id] ?? null,
      sessionOpen: () => true,
      book: () => ({ startingCash: 25_000, cash: 25_000, capPct: 15 }),
      place: async (id, side, qty) => {
        orders.push({ id, side, qty });
        return { status: "FILLED", fillPrice: prices[id]!, fees: 1, reason: null };
      },
    };
    return { deps, orders };
  }
  const [A] = ORB_CONTRACT.universe;

  it("waits for the first candle, then decides once and enters once", async () => {
    const { deps, orders } = fake({ [A!]: 101 });
    expect(await runIntradayPass(deps, at("09:18"))).toEqual([]);
    await runIntradayPass(deps, at("09:21"));
    await runIntradayPass(deps, at("09:22"));
    expect(readOrb("decision").filter((d) => d.instrumentId === A)).toHaveLength(1);
    expect(orders.filter((o) => o.id === A && o.side === "BUY")).toHaveLength(1);
  });

  it("stops out at the first candle's low", async () => {
    const prices = { [A!]: 101 };
    const { deps, orders } = fake(prices);
    await runIntradayPass(deps, at("09:21"));
    prices[A!] = 98.9;
    await runIntradayPass(deps, at("11:00"));
    expect(orders.filter((o) => o.id === A).map((o) => o.side)).toEqual(["BUY", "SELL"]);
    expect(readOrb("execution").find((e) => e.side === "SELL")?.reason).toBe("STOP");
  });

  it("goes flat at 15:05 and books the day only once flat", async () => {
    const prices = { [A!]: 101 };
    const { deps } = fake(prices);
    await runIntradayPass(deps, at("09:21"));
    expect(orbDailyPnl(), "an open position is not yet a realized day").toEqual([]);
    prices[A!] = 104;
    await runIntradayPass(deps, at("15:05"));
    const day = orbDailyPnl().find((d) => d.day === "2026-09-21")!;
    expect(readOrb("execution").find((e) => e.side === "SELL")?.reason).toBe("EOD");
    expect(day.pnl).toBeGreaterThan(0);
  });

  it("does not enter after 10:30", async () => {
    const late = fake({ [A!]: 101 });
    await runIntradayPass(late.deps, at("10:31"));
    expect(late.orders).toHaveLength(0);
  });

  it("does nothing on a down first candle", async () => {
    // Its own test: one decision per instrument per day, so a LONG recorded earlier the same day
    // would (correctly) stand.
    const down = fake({ [A!]: 101 }, { open: 100, high: 101, low: 97, close: 98 });
    await runIntradayPass(down.deps, at("09:25"));
    expect(down.orders).toHaveLength(0);
    expect(readOrb("decision")[0]?.long).toBe(false);
  });
});
