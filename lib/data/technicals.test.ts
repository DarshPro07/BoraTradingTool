import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { computeSignals, computeTechnicals, type TechnicalIndicators } from "./technicals";

/** Builds a candle series from closes; highs/lows straddle each close unless overridden. */
function candles(closes: number[], overrides: Partial<Candle>[] = []): Candle[] {
  return closes.map((close, index) => ({
    time: 1_700_000_000 + index * 86_400,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1_000,
    ...overrides[index],
  }));
}

const NO_FUNDAMENTALS = { pe: null, revenueGrowth: null, netMargin: null };

function baseTech(): TechnicalIndicators {
  return {
    sma20: null, sma50: null, sma200: null, rsi: null,
    macdLine: null, macdSignal: null, macdHist: null,
    bbUpper: null, bbMiddle: null, bbLower: null,
    support: null, resistance: null, trend: "neutral",
  };
}

describe("rsi", () => {
  it("reads a flat series as neutral, not maximally overbought", () => {
    // Both the average gain and the average loss are zero. Returning 100 here would claim
    // a stock that has not moved is as overbought as one that only ever rose.
    const { rsi } = computeTechnicals(candles(Array(30).fill(100)));
    expect(rsi).toBe(50);
  });

  it("still reads a series with no downside as 100", () => {
    const { rsi } = computeTechnicals(candles(Array.from({ length: 30 }, (_, i) => 100 + i)));
    expect(rsi).toBe(100);
  });

  it("lands between the extremes for a mixed series", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? i : -i));
    const { rsi } = computeTechnicals(candles(closes));
    expect(rsi).toBeGreaterThan(0);
    expect(rsi).toBeLessThan(100);
  });
});

describe("structural levels", () => {
  const closes = Array(30).fill(100);
  // The final bar spikes far below every other low — the shape of a developing intraday bar.
  const withSpike = candles(closes, Object.assign(Array(30).fill({}), { 29: { low: 50, high: 150 } }));

  it("uses the final bar when it is confirmed", () => {
    const tech = computeTechnicals(withSpike, { lastBarConfirmed: true });
    expect(tech.support).toBe(50);
    expect(tech.resistance).toBe(150);
  });

  it("excludes the final bar while it is still forming", () => {
    // Otherwise support moves every tick and a signal that fired can silently un-fire.
    const tech = computeTechnicals(withSpike, { lastBarConfirmed: false });
    expect(tech.support).toBe(99);
    expect(tech.resistance).toBe(101);
  });

  it("defaults to treating the series as confirmed", () => {
    expect(computeTechnicals(withSpike).support).toBe(50);
  });
});

describe("macd", () => {
  it("derives the histogram from the unrounded lines", () => {
    // Rounding the two lines to 3dp before subtracting can flip the sign of a histogram
    // that is within 0.0005 of zero — precisely the crossover it exists to detect.
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 5);
    const tech = computeTechnicals(candles(closes));
    expect(tech.macdHist).not.toBeNull();
    expect(Number.isFinite(tech.macdHist!)).toBe(true);
    // Consistent with the displayed lines to within their own rounding error.
    expect(Math.abs(tech.macdHist! - (tech.macdLine! - tech.macdSignal!))).toBeLessThanOrEqual(0.002);
  });
});

describe("computeSignals", () => {
  it("treats a negative P/E as a loss, not a discount", () => {
    const { bullSignals, bearSignals } = computeSignals(
      100, baseTech(), { ...NO_FUNDAMENTALS, pe: -5 }, 0, 0,
    );
    expect(bullSignals.map((s) => s.label)).not.toContain("Low P/E");
    expect(bearSignals.map((s) => s.label)).toContain("Negative Earnings");
  });

  it("still rewards a genuinely low positive P/E", () => {
    const { bullSignals } = computeSignals(100, baseTech(), { ...NO_FUNDAMENTALS, pe: 12 }, 0, 0);
    expect(bullSignals.map((s) => s.label)).toContain("Low P/E");
  });

  it("flags an expensive P/E", () => {
    const { bearSignals } = computeSignals(100, baseTech(), { ...NO_FUNDAMENTALS, pe: 80 }, 0, 0);
    expect(bearSignals.map((s) => s.label)).toContain("High P/E");
  });

  it("emits no P/E signal when earnings are unavailable", () => {
    const { bullSignals, bearSignals } = computeSignals(100, baseTech(), NO_FUNDAMENTALS, 0, 0);
    const labels = [...bullSignals, ...bearSignals].map((s) => s.label);
    expect(labels).not.toContain("Low P/E");
    expect(labels).not.toContain("Negative Earnings");
    expect(labels).not.toContain("High P/E");
  });

  it("does not treat a zero indicator as a missing one", () => {
    // `if (tech.sma200)` skipped a legitimate zero; `!== null` is the availability test.
    const tech = { ...baseTech(), sma200: 0 };
    const { bullSignals } = computeSignals(10, tech, NO_FUNDAMENTALS, 0, 0);
    expect(bullSignals.map((s) => s.label)).toContain("Above 200 SMA");
  });
});
