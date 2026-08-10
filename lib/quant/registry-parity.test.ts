import { describe, expect, it } from "vitest";
import { buildFeaturePanel } from "@/lib/backtest/features";
import { atr, ema, rsi, sma } from "./indicator-registry";
import type { Candle } from "@/lib/providers/types";

/**
 * Phase A closure: the engine's feature panel and the IndicatorRegistry must compute the SAME
 * numbers for the formulas both implement. Until features.ts consumes the registry directly,
 * this cross-pin is the mechanism that makes silent drift impossible — a formula edit on either
 * side fails here with both values visible.
 */

function fixtureBars(length = 260): Candle[] {
  // Deterministic, non-trivial path: trend + oscillation + volume variation.
  return Array.from({ length }, (_, index) => {
    const close = 100 + index * 0.1 + Math.sin(index / 5) * 3;
    return {
      time: 1_700_000_000 + index * 86_400,
      open: close - 0.4,
      high: close + 1.1,
      low: close - 1.2,
      close,
      volume: 1_000 + (index % 7) * 250,
    };
  });
}

describe("registry ↔ engine feature-panel parity (one formula, provably)", () => {
  const bars = fixtureBars();
  const panel = buildFeaturePanel(bars, { market: "IN", resolution: "D" });
  const closes = bars.map((bar) => bar.close);

  it("SMA20/SMA50 agree to 1e-9 — and agree on MISSING inside warmup", () => {
    const registrySma20 = sma(closes, 20);
    const registrySma50 = sma(closes, 50);
    // Inside SMA50's warmup both sides must report missing (registry: null; panel: undefined) —
    // neither may fabricate a value the other refuses.
    expect(registrySma50[25]).toBeNull();
    expect(panel.at(25)!.sma50).toBeUndefined();
    for (const index of [25, 100, 200, 259]) {
      expect(registrySma20[index]).toBeCloseTo(panel.at(index)!.sma20 as number, 9);
    }
    for (const index of [100, 200, 259]) {
      expect(registrySma50[index]).toBeCloseTo(panel.at(index)!.sma50 as number, 9);
    }
  });

  it("EMA12 agrees to 1e-6 after convergence", () => {
    const registryEma12 = ema(closes, 12);
    // Seeding conventions can differ in the first bars; after 5× the period any admissible
    // seed has washed out. Divergence HERE would be a formula difference, not a seed one.
    for (const index of [80, 150, 259]) {
      const vector = panel.at(index)!;
      expect(registryEma12[index]).toBeCloseTo(vector.ema12 as number, 6);
    }
  });

  it("RSI14 agrees to 1e-6", () => {
    const registryRsi = rsi(closes, 14);
    for (const index of [30, 120, 259]) {
      const vector = panel.at(index)!;
      expect(registryRsi[index]).toBeCloseTo(vector.rsi14 as number, 6);
    }
  });

  it("ATR14 agrees to 1e-6", () => {
    const registryAtr = atr(
      { open: bars.map((b) => b.open), high: bars.map((b) => b.high), low: bars.map((b) => b.low), close: closes, volume: bars.map((b) => b.volume) },
      14,
    );
    for (const index of [30, 120, 259]) {
      const vector = panel.at(index)!;
      expect(registryAtr[index]).toBeCloseTo(vector.atr14 as number, 6);
    }
  });
});
