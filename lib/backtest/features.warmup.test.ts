import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { buildFeaturePanel, FEATURE_WARMUP_BARS, warmupBarsFor } from "./features";

/**
 * Pin `FEATURE_WARMUP_BARS` against the ACTUAL panel, so the declared warm-up can never drift from
 * the computation. For each mapped feature: it must be undefined one bar before its warm-up and
 * defined exactly at it. This is what makes "barsHeld / barsNeeded" a trustworthy data condition.
 */

/** A long, gently varying daily series — enough bars to warm every feature. */
function series(count = 300): Candle[] {
  const bars: Candle[] = [];
  const base = Math.floor(Date.parse("2024-01-01T00:00:00Z") / 1000);
  for (let i = 0; i < count; i += 1) {
    const price = 100 + Math.sin(i / 7) * 8 + i * 0.03;
    bars.push({ time: base + i * 86_400, open: price, high: price + 1.5, low: price - 1.5, close: price + 0.4, volume: 10_000 + (i % 5) * 500 });
  }
  return bars;
}

describe("FEATURE_WARMUP_BARS pins the real panel warm-up", () => {
  const panel = buildFeaturePanel(series());

  for (const [feature, warmup] of Object.entries(FEATURE_WARMUP_BARS)) {
    it(`${feature} is undefined at ${warmup! - 1} bars and defined at ${warmup}`, () => {
      // `warmup` bars means indices 0..warmup-1 are held; the feature is first defined at index warmup-1.
      const definedIndex = warmup! - 1;
      expect(panel.at(definedIndex)[feature as keyof ReturnType<typeof panel.at>], `defined at its warm-up`).toBeTypeOf("number");
      if (definedIndex >= 1) {
        expect(panel.at(definedIndex - 1)[feature as keyof ReturnType<typeof panel.at>], `undefined one bar earlier`).toBeUndefined();
      }
    });
  }
});

describe("warmupBarsFor", () => {
  it("returns the max warm-up across required features", () => {
    expect(warmupBarsFor(["sma20", "rsi14"])).toBe(20);
    expect(warmupBarsFor(["sma200", "ema12"])).toBe(200);
    expect(warmupBarsFor(["gap_pct"])).toBe(2);
  });

  it("treats raw and unknown features as one bar, never below 1", () => {
    expect(warmupBarsFor(["close", "high"])).toBe(1);
    expect(warmupBarsFor([])).toBe(1);
    expect(warmupBarsFor(["some_unmapped_feature"])).toBe(1);
  });
});
