import { describe, expect, it } from "vitest";
import { cumulative, drawdown, histogram, lineSeries, positionOf } from "./plot";

describe("histogram", () => {
  it("bins across the observed range and counts every value", () => {
    const result = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(result.count).toBe(10);
    expect(result.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(10);
    expect(result.min).toBe(1);
    expect(result.max).toBe(10);
  });

  it("puts the maximum inside the last bin rather than one past the end", () => {
    // The classic off-by-one: (max - min) / width lands exactly on the bin count.
    const result = histogram([0, 10], 4);
    expect(result.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(2);
    expect(result.bins[result.bins.length - 1].count).toBe(1);
  });

  it("returns one bin for a constant series instead of dividing by zero", () => {
    // Zero-width bins would produce NaN geometry and render as an empty chart, which reads as
    // "no data" when the truth is "no variation".
    const result = histogram([5, 5, 5, 5], 10);
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0].count).toBe(4);
    expect(result.peak).toBe(4);
  });

  it("ignores non-finite values rather than poisoning the range", () => {
    const result = histogram([1, 2, Number.NaN, Number.POSITIVE_INFINITY, 3], 3);
    expect(result.count).toBe(3);
    expect(Number.isFinite(result.max)).toBe(true);
  });

  it("returns an empty histogram for an empty sample", () => {
    const result = histogram([], 10);
    expect(result.bins).toHaveLength(0);
    expect(result.peak).toBe(0);
  });

  it("reports shares that sum to one", () => {
    const result = histogram([1, 2, 3, 4, 5, 6], 3);
    const total = result.bins.reduce((sum, bin) => sum + bin.share, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("positionOf", () => {
  it("places a reference value proportionally across the width", () => {
    expect(positionOf(5, 0, 10, 100)).toBe(50);
  });

  it("clamps rather than drawing outside the plot", () => {
    expect(positionOf(-5, 0, 10, 100)).toBe(0);
    expect(positionOf(50, 0, 10, 100)).toBe(100);
  });

  it("does not divide by zero on a degenerate range", () => {
    expect(Number.isFinite(positionOf(5, 5, 5, 100))).toBe(true);
  });
});

describe("lineSeries", () => {
  it("spans the full width and stays inside the height", () => {
    const series = lineSeries([1, 5, 3, 8, 2], 100, 40);
    expect(series.points[0].x).toBe(0);
    expect(series.points[series.points.length - 1].x).toBeCloseTo(100, 5);
    for (const point of series.points) {
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(40);
    }
  });

  it("draws a flat series through the middle, not along an edge", () => {
    // Pinning a constant line to the top or bottom implies a maximum or minimum the data does
    // not contain.
    const series = lineSeries([7, 7, 7, 7], 100, 40);
    for (const point of series.points) expect(point.y).toBe(20);
  });

  it("puts a single point in the centre rather than at x=0 with a zero-length path", () => {
    const series = lineSeries([3], 100, 40);
    expect(series.points).toHaveLength(1);
    expect(series.points[0].x).toBe(50);
  });

  it("closes the area path so a fill cannot leak", () => {
    const series = lineSeries([1, 2, 3], 100, 40);
    expect(series.area.endsWith("Z")).toBe(true);
    expect(series.path.startsWith("M")).toBe(true);
  });

  it("produces nothing for an empty series rather than a malformed path", () => {
    const series = lineSeries([], 100, 40);
    expect(series.path).toBe("");
    expect(series.area).toBe("");
  });
});

describe("drawdown", () => {
  it("measures against the running peak, not the starting value", () => {
    // Up 40% then down from the high: the pain is 10%, and calling it "no drawdown because it
    // is still above where it started" hides exactly what the operator needs to see.
    const result = drawdown([100, 140, 126]);
    expect(result.max).toBeCloseTo(-0.1, 10);
    expect(result.troughIndex).toBe(2);
  });

  it("reports no drawdown for a monotonically rising curve", () => {
    const result = drawdown([100, 110, 120]);
    expect(result.max).toBe(0);
    expect(result.troughIndex).toBe(-1);
  });

  it("keeps the deepest trough even after recovery", () => {
    const result = drawdown([100, 50, 100, 200]);
    expect(result.max).toBeCloseTo(-0.5, 10);
    expect(result.troughIndex).toBe(1);
  });

  it("does not produce infinity when the peak is at or below zero", () => {
    const result = drawdown([-10, -20, -5]);
    expect(result.series.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("returns a value per input point", () => {
    const equity = [100, 90, 95, 80];
    expect(drawdown(equity).series).toHaveLength(equity.length);
  });
});

describe("cumulative", () => {
  it("turns per-trade returns into an equity path", () => {
    expect(cumulative([1, 2, 3], 100)).toEqual([101, 103, 106]);
  });

  it("treats a non-finite entry as no change rather than destroying the path", () => {
    expect(cumulative([1, Number.NaN, 2], 0)).toEqual([1, 1, 3]);
  });
});
