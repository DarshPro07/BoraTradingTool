import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { buildFeaturePanel } from "./features";

/**
 * The features added so NSE-QC-001's PINNED family contracts become expressible.
 *
 * Each one is a composite the grammar cannot build — it has comparisons and no arithmetic — and
 * each corresponds to a quantity a declared mechanism names in words. The property that matters
 * for all of them is the same one the whole engine rests on: **a feature may never see a bar that
 * had not printed yet.** A lookahead here would not fail; it would produce a beautiful equity
 * curve, which is worse.
 */

const DAY = 86_400;

function daily(closes: readonly number[], from = 1_700_000_000): Candle[] {
  return closes.map((close, index) => ({
    time: from + index * DAY,
    open: close,
    high: close * 1.02,
    low: close * 0.98,
    close,
    volume: 1_000,
  }));
}

describe("N-bar extremes", () => {
  it("excludes the current bar, so a breakout is a move beyond what came before", () => {
    // 20 bars at 100, then a spike. On the spike bar, high_20d must still describe the flat run —
    // including today would make "close > high_20d" tautological on the bar that sets the high.
    const bars = daily([...Array<number>(21).fill(100), 130]);
    const panel = buildFeaturePanel(bars);
    const spike = panel.at(bars.length - 1);
    expect(spike.high_20d).toBeCloseTo(102, 4); // 100 * 1.02, the prior bars' high
    expect(spike.close).toBe(130);
  });

  it("is undefined before its window is satisfied, rather than guessing", () => {
    const panel = buildFeaturePanel(daily(Array<number>(10).fill(100)));
    expect(panel.at(5).high_20d).toBeUndefined();
  });
});

describe("distance from the short mean in ATR units", () => {
  it("is zero when price sits exactly on the mean", () => {
    // Constant closes with a real intrabar range: ATR is non-zero, the mean equals the close, so
    // the stretch is exactly zero rather than undefined. Being defined-and-zero matters — a
    // strategy asking "is the stretch beyond 1.5" must get a false, not a missing feature.
    const panel = buildFeaturePanel(daily(Array<number>(40).fill(100)));
    expect(panel.at(39).atr_stretch_sma20).toBeCloseTo(0, 10);
  });

  it("is withheld, not zero, when ATR cannot be computed", () => {
    // A series with no intrabar range at all has no ATR to divide by. Dividing anyway would be an
    // infinity dressed up as a signal.
    const flat = Array.from({ length: 40 }, (_unused, index) => ({
      time: 1_700_000_000 + index * DAY,
      open: 100, high: 100, low: 100, close: 100, volume: 1_000,
    }));
    expect(buildFeaturePanel(flat).at(39).atr_stretch_sma20).toBeUndefined();
  });

  it("reads negative when price is stretched below the mean", () => {
    const closes = [...Array.from({ length: 30 }, (_unused, i) => 100 + (i % 2 === 0 ? 1 : -1)), 90];
    const panel = buildFeaturePanel(daily(closes));
    const stretch = panel.at(closes.length - 1).atr_stretch_sma20;
    expect(stretch).toBeDefined();
    expect(stretch!).toBeLessThan(0);
  });
});

describe("short-window return, raw and volatility-scaled", () => {
  it("measures the 5-bar return", () => {
    const closes = [...Array<number>(10).fill(100), 90];
    const panel = buildFeaturePanel(daily(closes));
    expect(panel.at(closes.length - 1).return_5d).toBeCloseTo(-10, 6);
  });

  it("scales by the instrument's own volatility, so one threshold ports across names", () => {
    // The same -10% move is extreme for a quiet series and ordinary for a violent one. That is
    // exactly what the swing contract's "-(1.5-3.0) x 20-day volatility" trigger depends on.
    const quiet = [...Array.from({ length: 25 }, (_u, i) => 100 + (i % 2 === 0 ? 0.2 : -0.2)), 90];
    const wild = [...Array.from({ length: 25 }, (_u, i) => 100 + (i % 2 === 0 ? 6 : -6)), 90];

    const quietScore = buildFeaturePanel(daily(quiet)).at(quiet.length - 1).return_5d_in_vol!;
    const wildScore = buildFeaturePanel(daily(wild)).at(wild.length - 1).return_5d_in_vol!;

    expect(quietScore).toBeLessThan(0);
    expect(wildScore).toBeLessThan(0);
    expect(Math.abs(quietScore), "the same drop must look larger in a quiet series").toBeGreaterThan(
      Math.abs(wildScore),
    );
  });
});

describe("prior-session extremes", () => {
  const OPEN = Date.UTC(2026, 7, 10, 3, 45) / 1000; // 09:15 IST

  function intraday(sessions: readonly (readonly number[])[]): Candle[] {
    const bars: Candle[] = [];
    sessions.forEach((closes, day) => {
      closes.forEach((close, i) => {
        bars.push({
          time: OPEN + day * DAY + i * 300,
          open: close,
          high: close + 1,
          low: close - 1,
          close,
          volume: 100,
        });
      });
    });
    return bars;
  }

  it("serves the PREVIOUS session's range, never the one in progress", () => {
    const bars = intraday([
      [100, 110, 105],
      [200, 210, 205],
    ]);
    const panel = buildFeaturePanel(bars, { market: "IN", resolution: "5m" });

    // First bar of the second session: must describe day one, not day two.
    const secondSessionStart = panel.at(3);
    expect(secondSessionStart.prior_session_high).toBeCloseTo(111, 6);
    expect(secondSessionStart.prior_session_low).toBeCloseTo(99, 6);
  });

  it("is absent on the very first session, because there is no prior one", () => {
    const panel = buildFeaturePanel(intraday([[100, 110]]), { market: "IN", resolution: "5m" });
    expect(panel.at(1).prior_session_high).toBeUndefined();
  });
});

describe("fast RSI", () => {
  it("reaches an extreme far sooner than RSI(14) — which is why the contract names RSI(2-5)", () => {
    const closes = [...Array.from({ length: 20 }, (_u, i) => 100 + i), 118, 116, 114];
    const panel = buildFeaturePanel(daily(closes));
    const last = panel.at(closes.length - 1);
    expect(last.rsi2).toBeDefined();
    expect(last.rsi2!).toBeLessThan(last.rsi14!);
  });
});
