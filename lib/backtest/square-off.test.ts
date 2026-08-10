import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { runBacktest } from "./engine";
import { runPortfolioBacktest } from "./portfolio";

/**
 * The broker's deadline is the one exit a strategy cannot decline.
 *
 * NSE trades 09:15–15:30 IST, and Zerodha's documented equity MIS square-off for non-CAS stocks
 * is **15:25** (fetched from support.zerodha.com, 2026-08-09 — the profile carries the source).
 * A backtest that holds past it is not slightly optimistic — it is pricing a fill the account
 * could never have got, because the broker had already flattened the position.
 *
 * The deadline comes from `lib/broker/execution-profile.ts`, never from a constant: this file
 * previously asserted 15:20, which was an unsourced recollection presented as the broker's rule.
 * The expectations below moved 15:15 → 15:20 when the deadline moved 15:20 → 15:25, and the
 * mutation check in `06-verification.md` proves they follow the profile rather than luck.
 *
 * Every test works in real epoch seconds against real NSE session times, because the whole defect
 * class this guards against is a clock being wrong by a constant.
 */

/** 2026-08-03 is a Monday. 03:45Z is 09:15 IST — the NSE open. */
const SESSION_OPEN_UTC = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;
const DAY = 86_400;
const FIVE_MINUTES = 300;

/** Bars per NSE session at 5 minutes: 09:15 through 15:25 inclusive. */
const BARS_PER_SESSION = 75;

function bar(time: number, price: number, spread = 0.5): Candle {
  return {
    time,
    open: price,
    high: price + spread,
    low: price - spread,
    close: price,
    volume: 10_000,
  };
}

/** One NSE session of 5-minute bars, `count` of them, rising by `step` per bar. */
function session(dayOffset: number, count = BARS_PER_SESSION, start = 100, step = 0.1): Candle[] {
  const base = SESSION_OPEN_UTC + dayOffset * DAY;
  return Array.from({ length: count }, (_, index) => bar(base + index * FIVE_MINUTES, start + index * step));
}

/** Local session minute of a bar, for asserting *when* an exit happened. */
function istMinute(time: number): number {
  const ist = new Date((time + 5.5 * 3600) * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function intraday(overrides: Record<string, unknown> = {}): StrategyDsl {
  return StrategyDslSchema.parse({
    name: "square_off_probe",
    universe: { market: "NSE", maxPositions: 10, resolution: "5m" },
    // Fires on the first bar it can evaluate and stays true, so every test is about the exit.
    entry: { feature: "close", op: "gt", value: 0 },
    exit: { stopLossPct: 50 },
    sizing: { maxPositionPct: 5 },
    costs: { commissionBps: 3, slippageBps: 2, assumedSpreadBps: 8 },
    ...overrides,
  });
}

describe("the deadline binds whether or not the strategy mentions it", () => {
  it("flattens at the broker's 15:25 deadline with no squareOffAt declared", () => {
    const result = runBacktest(intraday(), session(0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const squared = result.trades.filter((trade) => trade.exitReason === "square_off");
    expect(squared.length).toBeGreaterThan(0);
    // The last bar that can be traded out of before 15:25 is the one opening at 15:20.
    expect(istMinute(squared[0].exitTime)).toBe(15 * 60 + 20);
    // And the run reports which assumption produced that exit — profile, broker, provenance.
    expect(result.execution?.broker).toBe("ZERODHA");
    expect(result.execution?.mandatoryExit).toBe("15:25");
    expect(result.execution?.description).toMatch(/fetched 2026-08-09/);
  });

  it("does not hold a position into the next session", () => {
    const bars = [...session(0), ...session(1)];
    const result = runBacktest(intraday(), bars);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const trade of result.trades) {
      const entryDay = Math.floor((trade.entryTime - SESSION_OPEN_UTC) / DAY);
      const exitDay = Math.floor((trade.exitTime - SESSION_OPEN_UTC) / DAY);
      expect(exitDay).toBe(entryDay);
    }
  });

  it("closes at the last bar of a truncated session, not at the ceiling that never arrived", () => {
    // A data gap: the session stops at 14:00 IST, well before 15:20. The ceiling rule alone would
    // never fire, and without the session-boundary rule the position would ride into the next day.
    const short = session(0, 57); // 09:15 → 13:55
    const bars = [...short, ...session(1)];
    const result = runBacktest(intraday(), bars);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const first = result.trades[0];
    expect(first.exitReason).toBe("square_off");
    expect(istMinute(first.exitTime)).toBe(13 * 60 + 55);
  });
});

describe("a declared square-off may tighten the ceiling, never extend it", () => {
  it("exits at the declared time when it is earlier", () => {
    const result = runBacktest(intraday({ exit: { stopLossPct: 50, squareOffAt: "14:30" } }), session(0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const squared = result.trades.find((trade) => trade.exitReason === "square_off");
    expect(squared).toBeDefined();
    expect(istMinute(squared!.exitTime)).toBe(14 * 60 + 25);
  });

  it("refuses a square-off at or after the ceiling rather than clamping it", () => {
    // Clamping would let the stored spec claim 15:29 while the run behaved as 15:20 — a
    // specification that describes something that never happened.
    const result = StrategyDslSchema.safeParse({
      name: "square_off_probe",
      universe: { market: "NSE", maxPositions: 10, resolution: "5m" },
      entry: { feature: "close", op: "gt", value: 0 },
      exit: { stopLossPct: 50, squareOffAt: "15:29" },
      sizing: { maxPositionPct: 5 },
      costs: { commissionBps: 3, slippageBps: 2, assumedSpreadBps: 8 },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toMatch(/may only tighten/);
  });

  it("accepts 15:22 — refused under the old unsourced 15:20 constant, legal under the broker's real 15:25", () => {
    // This test documents the correction. The previous ceiling was written from recollection and
    // rejected declarations the broker actually permits; a spec asking to be flat by 15:22 is a
    // *tighter* rule than Zerodha's documented 15:25 square-off and must be accepted.
    const result = StrategyDslSchema.safeParse({
      name: "square_off_probe",
      universe: { market: "NSE", maxPositions: 10, resolution: "5m" },
      entry: { feature: "close", op: "gt", value: 0 },
      exit: { stopLossPct: 50, squareOffAt: "15:22" },
      sizing: { maxPositionPct: 5 },
      costs: { commissionBps: 3, slippageBps: 2, assumedSpreadBps: 8 },
    });
    expect(result.success).toBe(true);
  });

  it("refuses a square-off on a daily strategy, which has no time of day", () => {
    const result = StrategyDslSchema.safeParse({
      name: "square_off_probe",
      universe: { market: "NSE", maxPositions: 10, resolution: "D" },
      entry: { feature: "close", op: "gt", value: 0 },
      exit: { stopLossPct: 50, squareOffAt: "14:30" },
      sizing: { maxPositionPct: 5 },
      costs: { commissionBps: 3, slippageBps: 2 },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toMatch(/daily bar has none/);
  });

  it("accepts a square-off as the only exit, since it does close positions", () => {
    const parsed = StrategyDslSchema.safeParse({
      name: "square_off_probe",
      universe: { market: "NSE", maxPositions: 10, resolution: "5m" },
      entry: { feature: "close", op: "gt", value: 0 },
      exit: { squareOffAt: "14:30" },
      sizing: { maxPositionPct: 5 },
      costs: { commissionBps: 3, slippageBps: 2, assumedSpreadBps: 8 },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("no position is opened that the ceiling would close in the same bar", () => {
  it("suppresses an entry whose fill bar is already past the square-off", () => {
    const result = runBacktest(intraday(), session(0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A fill at 15:25 or later would be flattened on the bar it opened: a round trip's costs for
    // no exposure. No trader accepts that, so the backtest must not manufacture it.
    for (const trade of result.trades) {
      expect(istMinute(trade.entryTime)).toBeLessThan(15 * 60 + 25);
      expect(trade.exitTime).toBeGreaterThan(trade.entryTime);
    }
  });
});

describe("daily strategies are untouched", () => {
  it("never reports a square-off exit", () => {
    const daily = StrategyDslSchema.parse({
      name: "daily_probe",
      universe: { market: "NSE", maxPositions: 10, resolution: "D" },
      entry: { feature: "close", op: "gt", value: 0 },
      exit: { afterDays: 3, stopLossPct: 50 },
      sizing: { maxPositionPct: 5 },
      costs: { commissionBps: 3, slippageBps: 2 },
    });
    const bars = Array.from({ length: 60 }, (_, index) => bar(SESSION_OPEN_UTC + index * DAY, 100 + index));

    const result = runBacktest(daily, bars);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades.some((trade) => trade.exitReason === "square_off")).toBe(false);
  });
});

describe("both engines square off identically", () => {
  it("the portfolio engine reaches the same exits as the single-instrument engine", () => {
    // The rehearsal runs the *portfolio* engine. A ceiling enforced only in the single-instrument
    // one would be invisible exactly where it matters, so parity is asserted rather than assumed.
    const dsl = intraday();
    const bars = session(0);

    const single = runBacktest(dsl, bars);
    const portfolio = runPortfolioBacktest(dsl, { "IN:XNSE:TEST": bars });
    expect(single.ok).toBe(true);
    expect(portfolio.ok).toBe(true);
    if (!single.ok || !portfolio.ok) return;

    expect(portfolio.trades.map((trade) => trade.exitReason)).toEqual(
      single.trades.map((trade) => trade.exitReason),
    );
    expect(portfolio.trades.map((trade) => trade.exitTime)).toEqual(single.trades.map((trade) => trade.exitTime));
    expect(portfolio.trades.map((trade) => trade.entryTime)).toEqual(single.trades.map((trade) => trade.entryTime));
  });
});
