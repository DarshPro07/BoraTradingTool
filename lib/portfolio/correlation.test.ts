import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, evaluateGate } from "@/lib/risk/gate";
import { bookExposure, correlate, type ReturnPoint } from "./correlation";

const DAY = 86_400;

function series(values: readonly number[], startDay = 0, step = 1): ReturnPoint[] {
  return values.map((value, index) => ({ time: 1_700_000_000 + (startDay + index * step) * DAY, value }));
}

/** A deterministic pseudo-random series, long enough to clear the overlap minimum. */
function noise(seed: number, length = 60): number[] {
  let state = seed >>> 0;
  return Array.from({ length }, () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000 - 0.5;
  });
}

describe("correlate", () => {
  it("returns 1 for a series against itself", () => {
    const values = noise(1);
    expect(correlate(series(values), series(values)).correlation).toBeCloseTo(1, 12);
  });

  it("returns -1 for a mirrored series", () => {
    const values = noise(2);
    const result = correlate(series(values), series(values.map((v) => -v)));
    expect(result.correlation).toBeCloseTo(-1, 12);
  });

  it("never exceeds the [-1, 1] bounds", () => {
    const values = noise(3);
    const result = correlate(series(values), series(values.map((v) => v * 3)));
    expect(result.correlation).toBeLessThanOrEqual(1);
    expect(result.correlation).toBeGreaterThanOrEqual(-1);
  });

  it("finds a weak correlation between independent series", () => {
    const result = correlate(series(noise(11, 200)), series(noise(97, 200)));
    expect(Math.abs(result.correlation ?? 1)).toBeLessThan(0.3);
  });
});

describe("timestamp alignment", () => {
  it("aligns by time, not by index", () => {
    // Same underlying returns, but B skips every third day. Zipping positionally would pair
    // mismatched days and destroy a correlation that is genuinely 1 on the shared days.
    const values = noise(5, 90);
    const a = series(values);
    const b = a.filter((_, index) => index % 3 !== 0);

    const result = correlate(a, b);
    expect(result.correlation).toBeCloseTo(1, 12);
    expect(result.commonDays).toBe(b.length);
  });

  it("counts only the overlapping periods", () => {
    const a = series(noise(6, 60), 0);
    const b = series(noise(7, 60), 30); // starts 30 days later
    expect(correlate(a, b).commonDays).toBe(30);
  });

  it("is unaffected by input ordering", () => {
    const values = noise(8);
    const a = series(values);
    const forward = correlate(a, series(noise(9)));
    const shuffled = correlate([...a].reverse(), series(noise(9)));
    expect(shuffled.correlation).toBeCloseTo(forward.correlation as number, 12);
  });

  it("ignores non-finite points rather than propagating NaN", () => {
    const values = noise(10);
    const a = series(values);
    a[3].value = Number.NaN;
    const result = correlate(a, series(values));
    expect(Number.isFinite(result.correlation as number)).toBe(true);
    expect(result.commonDays).toBe(values.length - 1);
  });
});

describe("refusals", () => {
  it("refuses when the overlap is too short", () => {
    const result = correlate(series(noise(12, 10)), series(noise(13, 10)));
    expect(result.correlation).toBeNull();
    expect(result.reason).toBe("INSUFFICIENT_OVERLAP");
    expect(result.commonDays).toBe(10);
  });

  it("refuses a flat series instead of calling it uncorrelated", () => {
    // A constant series has an undefined correlation, not a zero one. Floating-point residue
    // gives it a strictly positive variance, so testing `variance <= 0` returns ~-1e-16 here —
    // a number the gate would read as "safely uncorrelated".
    const flat = series(new Array(60).fill(0.001));
    const result = correlate(flat, series(noise(14)));
    expect(result.correlation).toBeNull();
    expect(result.reason).toBe("ZERO_VARIANCE");
  });

  it("refuses a flat series at any scale, and an all-zero one", () => {
    expect(correlate(series(new Array(60).fill(1e7)), series(noise(17))).reason).toBe("ZERO_VARIANCE");
    expect(correlate(series(new Array(60).fill(0)), series(noise(18))).reason).toBe("ZERO_VARIANCE");
  });

  it("still computes a correlation for a genuine mean-zero series", () => {
    // Guarding against a constant series must not reject a series that merely averages zero.
    const alternating = Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? -1 : 1));
    const result = correlate(series(alternating), series(alternating));
    expect(result.correlation).toBeCloseTo(1, 12);
  });

  it("still computes a correlation for a genuinely tiny series", () => {
    const tiny = noise(19).map((value) => value * 1e-9);
    expect(correlate(series(tiny), series(tiny)).correlation).toBeCloseTo(1, 12);
  });

  it("reports no overlap at all as zero common days, not as an error", () => {
    const result = correlate(series(noise(15), 0), series(noise(16), 500));
    expect(result.commonDays).toBe(0);
    expect(result.correlation).toBeNull();
  });
});

describe("bookExposure", () => {
  const base = noise(21, 80);

  it("reports the worst pair, not the average", () => {
    // AAA and BBB are identical; CCC is independent. An average would hide the 1.0.
    const exposure = bookExposure({
      AAA: series(base),
      BBB: series(base),
      CCC: series(noise(22, 80)),
    });

    expect(exposure.maxPairwiseCorrelation).toBeCloseTo(1, 12);
    expect(exposure.pair).toEqual(["AAA", "BBB"]);
    expect(exposure.pairs).toHaveLength(3);
  });

  it("treats a strongly negative correlation as equally concentrated", () => {
    const exposure = bookExposure({
      AAA: series(base),
      BBB: series(base.map((v) => -v)),
    });
    expect(exposure.maxPairwiseCorrelation).toBeCloseTo(-1, 12);
  });

  it("never lets an uncomputable pair become the maximum", () => {
    // SHORT has too little history. It must not read as the safest thing in the book.
    const exposure = bookExposure({
      AAA: series(base),
      BBB: series(noise(23, 80)),
      SHORT: series(noise(24, 5)),
    });

    expect(exposure.pair).not.toContain("SHORT");
    expect(exposure.pairs.filter((p) => p.correlation === null).length).toBe(2);
  });

  it("reports null for a book whose pairs are all uncomputable", () => {
    const exposure = bookExposure({ AAA: series(noise(25, 5)), BBB: series(noise(26, 5)) });
    expect(exposure.maxPairwiseCorrelation).toBeNull();
    expect(exposure.commonDays).toBeNull();
  });

  it("has no pairs for a single-strategy book", () => {
    expect(bookExposure({ AAA: series(base) }).pairs).toEqual([]);
  });
});

describe("feeding the risk gate", () => {
  const gateContext = (exposure: ReturnType<typeof bookExposure>) => ({
    sessionMinute: 600,
    requestedContracts: 1,
    tradesToday: 0,
    openPositions: 0,
    realisedRToday: 0,
    minutesToNearestNewsEvent: 120,
    combinedDrawdownUsd: -100,
    maxPairwiseCorrelation: exposure.maxPairwiseCorrelation,
    commonDays: exposure.commonDays,
    killSwitchEngaged: false,
  });

  const at = new Date("2026-08-06T10:00:00Z");

  it("passes the gate for a genuinely diversified book", () => {
    const exposure = bookExposure({ AAA: series(noise(31, 80)), BBB: series(noise(32, 80)) });
    expect(evaluateGate(gateContext(exposure), DEFAULT_RULES, at).allowed).toBe(true);
  });

  it("blocks the gate when two strategies are the same trade", () => {
    const shared = noise(33, 80);
    const exposure = bookExposure({ AAA: series(shared), BBB: series(shared) });
    const verdict = evaluateGate(gateContext(exposure), DEFAULT_RULES, at);
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toContain("max_pairwise_correlation");
  });

  it("blocks the gate when the book is too young to measure", () => {
    // The end-to-end property: an unmeasurable book does not trade.
    const exposure = bookExposure({ AAA: series(noise(34, 6)), BBB: series(noise(35, 6)) });
    const verdict = evaluateGate(gateContext(exposure), DEFAULT_RULES, at);
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toContain("max_pairwise_correlation");
  });
});
