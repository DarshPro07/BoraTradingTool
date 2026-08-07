/**
 * Plot geometry — pure functions returning coordinates, no DOM and no dependency.
 *
 * Kept separate from the components that draw them for the same reason the memory-graph layout
 * is: binning, scaling and drawdown are logic, and logic that lives inside a React component
 * can only be checked by looking at pixels.
 *
 * The motivation is a specific complaint about the product: a simulation that reports `fail` and
 * nothing else tells you a verdict, not a shape. Two strategies can both fail with completely
 * different distributions — one marginal, one hopeless — and the number alone hides which.
 */

export interface Bin {
  from: number;
  to: number;
  count: number;
  /** Share of the sample, 0..1. */
  share: number;
}

export interface Histogram {
  bins: Bin[];
  min: number;
  max: number;
  count: number;
  /** Tallest bin's count, so a renderer can scale without a second pass. */
  peak: number;
}

/**
 * Equal-width bins across the observed range.
 *
 * A degenerate sample — every value identical — produces one bin rather than a zero-width
 * division. Returning NaN geometry for a constant series would render as an empty chart, which
 * reads as "no data" when the truth is "no variation".
 */
export function histogram(values: readonly number[], binCount = 20): Histogram {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return { bins: [], min: 0, max: 0, count: 0, peak: 0 };

  const min = Math.min(...usable);
  const max = Math.max(...usable);
  const bins = Math.max(1, Math.trunc(binCount));

  if (max === min) {
    return {
      bins: [{ from: min, to: max, count: usable.length, share: 1 }],
      min,
      max,
      count: usable.length,
      peak: usable.length,
    };
  }

  const width = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const value of usable) {
    // The maximum lands exactly on the upper edge and would index one past the end.
    const index = Math.min(bins - 1, Math.floor((value - min) / width));
    counts[index] += 1;
  }

  return {
    bins: counts.map((count, index) => ({
      from: min + index * width,
      to: min + (index + 1) * width,
      count,
      share: count / usable.length,
    })),
    min,
    max,
    count: usable.length,
    peak: Math.max(...counts),
  };
}

/** Where a reference value sits across the plot width, clamped to the drawn area. */
export function positionOf(value: number, min: number, max: number, width: number): number {
  if (!Number.isFinite(value) || max === min) return 0;
  return Math.max(0, Math.min(width, ((value - min) / (max - min)) * width));
}

export interface Series {
  /** SVG path for the line. */
  path: string;
  /** Closed path for an area fill beneath the line. */
  area: string;
  min: number;
  max: number;
  points: { x: number; y: number; value: number }[];
}

/**
 * Scales a value series into an SVG path.
 *
 * A flat series is drawn through the vertical middle rather than at y=0. Pinning a constant
 * line to the top or bottom edge implies a maximum or a minimum that the data does not contain.
 */
export function lineSeries(values: readonly number[], width: number, height: number, pad = 2): Series {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return { path: "", area: "", min: 0, max: 0, points: [] };

  const min = Math.min(...usable);
  const max = Math.max(...usable);
  const span = max - min;
  const inner = Math.max(1, height - pad * 2);
  const step = usable.length > 1 ? width / (usable.length - 1) : 0;

  const points = usable.map((value, index) => ({
    x: usable.length > 1 ? index * step : width / 2,
    y: span === 0 ? height / 2 : pad + inner - ((value - min) / span) * inner,
    value,
  }));

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const area = points.length
    ? `${path} L ${points[points.length - 1].x.toFixed(2)} ${height} L ${points[0].x.toFixed(2)} ${height} Z`
    : "";

  return { path, area, min, max, points };
}

export interface Drawdown {
  /** Peak-to-current decline at each point, as a non-positive fraction of the peak. */
  series: number[];
  /** Deepest decline, non-positive. */
  max: number;
  /** Index at which the deepest decline occurred, or -1 when there was none. */
  troughIndex: number;
}

/**
 * Running peak-to-current decline over an equity curve.
 *
 * Measured against the running peak, not against the starting value: an account up 40% and then
 * down 10% from its high has a 10% drawdown, and calling that "no drawdown because it is still
 * above where it started" is how a strategy's real pain gets hidden.
 */
export function drawdown(equity: readonly number[]): Drawdown {
  const series: number[] = [];
  let peak = Number.NEGATIVE_INFINITY;
  let deepest = 0;
  let troughIndex = -1;

  equity.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      series.push(0);
      return;
    }
    peak = Math.max(peak, value);
    // A peak at or below zero makes a percentage decline meaningless rather than infinite.
    const decline = peak > 0 ? (value - peak) / peak : 0;
    series.push(decline);
    if (decline < deepest) {
      deepest = decline;
      troughIndex = index;
    }
  });

  return { series, max: deepest, troughIndex };
}

/** Cumulative sum, for turning per-trade returns into an equity path. */
export function cumulative(values: readonly number[], start = 0): number[] {
  let running = start;
  return values.map((value) => {
    running += Number.isFinite(value) ? value : 0;
    return running;
  });
}
