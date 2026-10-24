import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { getDb, schema } from "@/lib/db";
import { setLearningMode } from "@/lib/governance/runtime";
import { INTRADAY_LAST_ENTRY_IST_MINUTES } from "@/lib/paper/repository";
import { ORB_CONTRACT, orbDailyPnl, orbDecision, orbQuantity, orbRowsQuery, readOrb, reconcileOrbSquareOffs, runIntradayPass, type IntradayDeps } from "./orb";

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

  it("reads its own ledger through the (decision, action) index, never a full scan of audit_events", () => {
    // 2026-10-23 09:35: after a reboot, three full scans of audit_events (916k rows) read a cold disk
    // at ~0.7 MB/s, the pass outlived its 3-minute task limit, and no decision was recorded.
    for (const kind of ["decision", "execution"] as const) {
      const { sql, params } = orbRowsQuery(kind).toSQL();
      const plan = (getDb().$client.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((r) => r.detail).join(" | ");
      expect(plan, kind).toContain("USING INDEX idx_audit_decision");
    }
  });

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

describe("positions never leak across days (review finding 2026-09-19)", () => {
  useTemporaryDatabase();
  const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);
  const [A] = ORB_CONTRACT.universe;

  function deps(prices: Record<string, number>, sellFails = false) {
    const orders: { side: string; qty: number }[] = [];
    const d: IntradayDeps = {
      firstCandle: async () => ({ open: 100, high: 103, low: 90, close: 102 }),
      lastPrice: async (id) => prices[id] ?? null,
      sessionOpen: () => true,
      book: () => ({ startingCash: 25_000, cash: 25_000, capPct: 15 }),
      place: async (id, side, qty) => {
        orders.push({ side, qty });
        if (side === "SELL" && sellFails) return { status: "REJECTED", fillPrice: null, fees: 0, reason: "INELIGIBLE_QUOTE" };
        return { status: "FILLED", fillPrice: prices[id]!, fees: 1, reason: null };
      },
    };
    return { d, orders };
  }

  it("sells a position carried from yesterday before anything else, and does not buy again that day", async () => {
    const monday = deps({ [A!]: 100 }, true); // the 15:05 exit is refused all afternoon
    await runIntradayPass(monday.d, at("2026-09-21", "09:21"));
    await runIntradayPass(monday.d, at("2026-09-21", "15:05"));

    const tuesday = deps({ [A!]: 101 });
    await runIntradayPass(tuesday.d, at("2026-09-22", "09:21"));
    expect(tuesday.orders.map((o) => o.side), "carried shares go first; no second position").toEqual(["SELL"]);
  });

  it("realizes a carried round trip on the day it closes", async () => {
    const monday = deps({ [A!]: 100 }, true);
    await runIntradayPass(monday.d, at("2026-09-21", "09:21"));
    await runIntradayPass(monday.d, at("2026-09-21", "15:05"));
    await runIntradayPass(deps({ [A!]: 104 }).d, at("2026-09-22", "09:21"));
    const pnl = orbDailyPnl();
    expect(pnl.map((d) => d.day)).toEqual(["2026-09-22"]);
    expect(pnl[0]!.pnl).toBeGreaterThan(0);
  });
});

describe("S1.b: what stopped the clock on 2026-10-23", () => {
  useTemporaryDatabase();
  const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);
  const [A, B, C] = ORB_CONTRACT.universe;

  function deps(prices: Record<string, number>, engineEmpty = false) {
    const orders: { id: string; side: string; qty: number }[] = [];
    const d: IntradayDeps = {
      firstCandle: async () => ({ open: 100, high: 103, low: 90, close: 102 }),
      lastPrice: async (id) => prices[id] ?? null,
      sessionOpen: () => true,
      book: () => ({ startingCash: 25_000, cash: 25_000, capPct: 15 }),
      place: async (id, side, qty) => {
        orders.push({ id, side, qty });
        if (side === "SELL" && engineEmpty) return { status: "REJECTED", fillPrice: null, fees: 0, reason: "INSUFFICIENT_HOLDINGS" };
        return { status: "FILLED", fillPrice: prices[id]!, fees: 1, reason: null };
      },
    };
    return { d, orders };
  }

  it("EC-13: a position the cycle squared off is booked to IN1, so the next day trades normally", async () => {
    const monday = deps({ [A!]: 100 });
    await runIntradayPass(monday.d, at("2026-09-21", "09:21"));
    const bought = monday.orders.find((o) => o.id === A && o.side === "BUY")!.qty;
    // The minute task died before 15:05 (2026-10-23: the battery); the 15:15 cycle squared the engine off.
    const squaredAt = at("2026-09-21", "15:15");
    getDb().insert(schema.instruments).values({
      id: A!, market: "IN", exchange: "XNSE", symbol: "RELIANCE", providerSymbol: "RELIANCE.NS", name: "Reliance", currency: "INR",
      timezone: "Asia/Kolkata", assetType: "EQUITY", updatedAt: squaredAt,
    }).run();
    getDb().insert(schema.paperOrders).values({
      instrumentId: A!, side: "SELL", quantity: bought, orderType: "MARKET", status: "FILLED", quotePrice: 103, fillPrice: 103,
      fees: 2, currency: "INR", idempotencyKey: "squareoff-IN_XNSE_RELIANCE-2026-09-21-915", createdAt: squaredAt, filledAt: squaredAt, product: "INTRADAY",
    }).run();

    const tuesday = deps({ [A!]: 101 }, true); // the engine holds nothing: a carried SELL is refused
    await runIntradayPass(tuesday.d, at("2026-09-22", "09:21"));
    expect(tuesday.orders.filter((o) => o.id === A).map((o) => o.side), "no carried-sell loop; a normal entry").toEqual(["BUY"]);
    const monday21 = orbDailyPnl().find((d) => d.day === "2026-09-21")!;
    expect(monday21.pnl).toBeCloseTo(bought * 103 - 2 - (bought * 100 + 1), 6);

    const rows = readOrb("execution").length;
    reconcileOrbSquareOffs();
    expect(readOrb("execution"), "idempotent").toHaveLength(rows);
  });

  it("EC-13: IN1's own exit comes before the cycle's square-off", () => {
    expect(ORB_CONTRACT.exitMinute).toBeLessThan(INTRADAY_LAST_ENTRY_IST_MINUTES);
  });

  it("GV-8: learning mode OFF stops new entries, and a held position still exits", async () => {
    const prices = { [A!]: 101 };
    const held = deps(prices);
    await runIntradayPass(held.d, at("2026-09-21", "09:21"));
    setLearningMode("off", "owner");
    prices[A!] = 89; // below the stop (90)
    await runIntradayPass(held.d, at("2026-09-21", "11:00"));
    expect(held.orders.filter((o) => o.id === A).map((o) => o.side)).toEqual(["BUY", "SELL"]);

    const fresh = deps({ [A!]: 101 });
    await runIntradayPass(fresh.d, at("2026-09-22", "09:21"));
    expect(fresh.orders, "no entry while OFF").toHaveLength(0);
  });

  it("EC-9: one instrument's failure does not stop the others, and is reported in the same minute's lines", async () => {
    // Review 18:43: throwing at the end discarded the others' lines, so a minute that did real work
    // logged only an error and read as a coverage gap. The entry exits 1 on a `failed:` line instead.
    const p = deps({ [A!]: 101, [B!]: 101, [C!]: 101 });
    const real = p.d.firstCandle;
    p.d.firstCandle = async (id, day) => {
      if (id === A) throw new Error("provider down");
      return real(id, day);
    };
    expect(await runIntradayPass(p.d, at("2026-09-21", "09:21"))).toContainEqual({ instrumentId: A, action: "failed: provider down" });
    expect(readOrb("decision").map((d) => d.instrumentId).sort()).toEqual([B, C].sort());
    expect(p.orders.filter((o) => o.side === "BUY").map((o) => o.id).sort()).toEqual([B, C].sort());
  });

  it("EC-4: the cycle's backstop pass records decisions and places nothing", async () => {
    const p = deps({ [A!]: 101, [B!]: 101, [C!]: 101 });
    await runIntradayPass(p.d, at("2026-09-21", "09:30"), { decideOnly: true });
    expect(readOrb("decision")).toHaveLength(3);
    expect(p.orders).toHaveLength(0);
  });
});
