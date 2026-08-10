import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { compileStrategy, StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { buildFeaturePanel } from "./features";

/**
 * The opening range, and a bar's place in its session.
 *
 * These are the features that make an opening-range breakout expressible. The property that has to
 * hold is the same one the whole feature panel exists for: the value at bar `i` depends only on
 * bars `0..i`. For an opening range that is subtle — the range is a *level* computed from the
 * session's first bars, and serving it while it is still forming would let a breakout fire against
 * a level the same bar is still moving.
 */

/** 2026-08-03 is a Monday. 03:45Z is 09:15 IST — the NSE open. */
const SESSION_OPEN_UTC = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;
const DAY = 86_400;
const FIVE_MINUTES = 300;

function session(dayOffset: number, count = 75, start = 100, step = 0.1): Candle[] {
  const base = SESSION_OPEN_UTC + dayOffset * DAY;
  return Array.from({ length: count }, (_, index) => {
    const price = start + index * step;
    return {
      time: base + index * FIVE_MINUTES,
      open: price,
      high: price + 0.5,
      low: price - 0.5,
      close: price,
      volume: 10_000,
    };
  });
}

const intradayPanel = (bars: Candle[]) => buildFeaturePanel(bars, { market: "IN", resolution: "5m" });

describe("the opening range is the first fifteen minutes of the bar's own session", () => {
  it("is the extreme of the 09:15, 09:20 and 09:25 bars", () => {
    const bars = session(0);
    const panel = intradayPanel(bars);

    // Highs of the first three bars: 100.5, 100.6, 100.7. Lows: 99.5, 99.6, 99.7.
    const vector = panel.at(3);
    expect(vector.opening_range_high).toBeCloseTo(100.7, 6);
    expect(vector.opening_range_low).toBeCloseTo(99.5, 6);
  });

  it("is withheld while the range is still forming", () => {
    const panel = intradayPanel(session(0));
    // 09:15, 09:20, 09:25 — the range is not complete until 09:30.
    for (const index of [0, 1, 2]) {
      expect(panel.at(index).opening_range_high).toBeUndefined();
      expect(panel.at(index).opening_range_low).toBeUndefined();
    }
    expect(panel.at(3).opening_range_high).toBeDefined();
  });

  it("does not carry one session's range into the next", () => {
    // The second session opens 50 points higher. Borrowing yesterday's level — which a bar-count
    // window would do the moment a session had a missing bar — would make every breakout on day
    // two fire instantly.
    const bars = [...session(0), ...session(1, 75, 150)];
    const panel = intradayPanel(bars);

    const dayOne = panel.at(3).opening_range_high;
    const dayTwo = panel.at(75 + 3).opening_range_high;
    expect(dayOne).toBeCloseTo(100.7, 6);
    expect(dayTwo).toBeCloseTo(150.7, 6);
  });

  it("holds the range steady for the rest of the session", () => {
    const panel = intradayPanel(session(0));
    expect(panel.at(50).opening_range_high).toBeCloseTo(panel.at(3).opening_range_high!, 6);
  });
});

describe("minutes_since_open locates a bar in its trading day", () => {
  it("counts from the 09:15 open, and resets each session", () => {
    const bars = [...session(0), ...session(1)];
    const panel = intradayPanel(bars);

    expect(panel.at(0).minutes_since_open).toBe(0);
    expect(panel.at(1).minutes_since_open).toBe(5);
    expect(panel.at(12).minutes_since_open).toBe(60);
    // First bar of the second session, not 1440 + something.
    expect(panel.at(75).minutes_since_open).toBe(0);
  });
});

describe("session features without session context", () => {
  it("are absent rather than wrong when the panel is not told the market", () => {
    // This is a wiring bug, not a user error — `compileStrategy` refuses the daily combination, so
    // any panel reaching here without context was built by code that forgot to pass it. Absent is
    // the right failure: `evaluate` returns undefined and the strategy abstains.
    const panel = buildFeaturePanel(session(0));
    expect(panel.at(10).opening_range_high).toBeUndefined();
    expect(panel.at(10).minutes_since_open).toBeUndefined();
  });
});

describe("session features are a compile error at daily resolution", () => {
  it("refuses rather than leaving them undefined forever", () => {
    // Undefined on every bar means the strategy never evaluates and reports zero trades — which
    // reads as a finding about the market rather than a broken specification.
    const result = compileStrategy(
      StrategyDslSchema.parse({
        name: "orb_at_daily",
        universe: { market: "NSE", maxPositions: 10, resolution: "D" },
        entry: { compare: ["close", "opening_range_high"], op: "gt" },
        exit: { stopLossPct: 1 },
        sizing: { maxPositionPct: 5 },
        costs: { commissionBps: 3, slippageBps: 2 },
      }) as StrategyDsl,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("SESSION_FEATURE_AT_DAILY");
    expect(result.message).toMatch(/opening_range_high/);
  });

  it("accepts them at intraday resolution", () => {
    const result = compileStrategy(
      StrategyDslSchema.parse({
        name: "orb_at_5m",
        universe: { market: "NSE", maxPositions: 10, resolution: "5m" },
        entry: { compare: ["close", "opening_range_high"], op: "gt" },
        exit: { stopLossPct: 1 },
        sizing: { maxPositionPct: 5 },
        costs: { commissionBps: 3, slippageBps: 2, assumedSpreadBps: 8 },
      }) as StrategyDsl,
    );
    expect(result.ok).toBe(true);
  });
});
