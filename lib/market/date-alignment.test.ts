import { describe, expect, it } from "vitest";
import {
  assessAlignment,
  marketReturnFactor,
  pearson,
  returnsOf,
  MIN_OBSERVATIONS,
} from "./date-alignment";

/**
 * The audit that found nothing is only worth as much as its ability to find something.
 *
 * `scripts/audit-date-alignment.mts` reported 1,959 instruments aligned and zero displaced. That
 * result is meaningless unless the detector demonstrably fires on a series it should catch — an
 * all-clear from a broken test looks exactly like an all-clear from a clean store.
 *
 * So these build a synthetic universe with a known market factor, displace one member by one
 * session, and require the detector to name it.
 */

/** A deterministic pseudo-random walk — no Math.random, so a failure is reproducible. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648 - 0.5;
  };
}

const DATES = Array.from({ length: 260 }, (_unused, i) => {
  const d = new Date(Date.UTC(2025, 0, 5 + i));
  return d.toISOString().slice(0, 10);
});

/**
 * A universe whose members each track a shared market path plus their own noise — the structure the
 * detector relies on. `beta` scales market sensitivity; `noise` is idiosyncratic.
 */
function universe(count: number, seed = 42): Map<string, Map<string, number>> {
  const marketRandom = rng(seed);
  const marketReturns = DATES.map(() => marketRandom() * 0.02);
  const out = new Map<string, Map<string, number>>();
  for (let k = 0; k < count; k += 1) {
    const own = rng(seed + k * 977);
    const series = new Map<string, number>();
    let price = 100;
    DATES.forEach((date, i) => {
      price *= 1 + marketReturns[i]! * 1.0 + own() * 0.012;
      series.set(date, price);
    });
    out.set(`SYN:${k}`, series);
  }
  return out;
}

/** The same series with every close moved to the previous session's date — the real defect. */
function shiftedByOneSession(series: ReadonlyMap<string, number>): Map<string, number> {
  const dates = [...series.keys()].sort();
  const out = new Map<string, number>();
  for (let i = 1; i < dates.length; i += 1) out.set(dates[i - 1]!, series.get(dates[i]!)!);
  return out;
}

describe("pearson", () => {
  it("is 1 for a series against itself and -1 against its negation", () => {
    const a = [1, 2, 3, 4, 5.5, 2.2];
    expect(pearson(a, a)).toBeCloseTo(1, 10);
    expect(pearson(a, a.map((x) => -x))).toBeCloseTo(-1, 10);
  });

  it("returns 0 rather than NaN for a constant series", () => {
    // A zero-variance denominator must not propagate NaN into a verdict, where it would compare
    // false against every threshold and silently read as "aligned".
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
  });
});

describe("returnsOf", () => {
  it("produces one fewer value than closes", () => {
    const r = returnsOf([100, 110, 99]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(-0.1, 12);
  });

  it("does not divide by a zero previous close", () => {
    expect(returnsOf([0, 50])).toEqual([0]);
  });
});

describe("assessAlignment", () => {
  it("calls a correctly dated series ALIGNED at lag 0", () => {
    const uni = universe(30);
    const factor = marketReturnFactor(uni);
    const verdict = assessAlignment("SYN:0", uni.get("SYN:0")!, factor);

    expect(verdict.status).toBe("ALIGNED");
    expect(verdict.bestLag).toBe(0);
    expect(verdict.correlationAtZero).toBeGreaterThan(0.5);
  });

  it("CATCHES a series displaced by one session — the positive control", () => {
    // The whole audit rests on this. RELIANCE, TCS and HDFCBANK carried exactly this defect, and a
    // universe-wide sweep reporting "nothing found" is only evidence if this test passes.
    const uni = universe(30);
    const factor = marketReturnFactor(uni);
    const displaced = shiftedByOneSession(uni.get("SYN:0")!);
    const verdict = assessAlignment("SYN:0-shifted", displaced, factor);

    expect(verdict.status).toBe("DATE_ALIGNMENT_SUSPECTED");
    expect(verdict.bestLag).not.toBe(0);
    expect(
      verdict.correlationAtBest - verdict.correlationAtZero,
      "the displaced lag must beat lag 0 decisively, not marginally",
    ).toBeGreaterThan(0.15);
  });

  it("reports INSUFFICIENT_DATA rather than ALIGNED for a thin series", () => {
    // "We could not tell" and "we checked and it is fine" are different claims. Collapsing them is
    // how a short series gets a clean bill of health it never earned.
    const uni = universe(30);
    const factor = marketReturnFactor(uni);
    const thin = new Map([...uni.get("SYN:1")!].slice(0, MIN_OBSERVATIONS - 10));
    const verdict = assessAlignment("SYN:1-thin", thin, factor);

    expect(verdict.status).toBe("INSUFFICIENT_DATA");
  });

  it("reports UNCORRELATED when the instrument does not track the market", () => {
    // Without market correlation the lag test has no signal to read, so it must decline to speak
    // rather than pass the instrument as verified.
    const uni = universe(30);
    const factor = marketReturnFactor(uni);
    // A deterministic oscillation rather than another pseudo-random walk: two LCG streams can
    // correlate by accident, and a control that only sometimes controls is not one.
    let price = 100;
    const independent = new Map(
      DATES.map((d, i) => [d, (price *= 1 + Math.sin(i * 1.7) * 0.02)] as const),
    );
    const verdict = assessAlignment("SYN:independent", independent, factor);

    expect(verdict.status).toBe("UNCORRELATED");
    expect(Math.abs(verdict.correlationAtBest)).toBeLessThan(0.15);
  });
});

describe("marketReturnFactor", () => {
  it("is unmoved when the reporting instrument set changes", () => {
    // A mean of levels would jump when a member appears or drops out, manufacturing a market move
    // from a listing or a data gap. A mean of returns must not.
    const uni = universe(20);
    const full = marketReturnFactor(uni);

    const partial = new Map(uni);
    const dropped = partial.get("SYN:19")!;
    partial.set("SYN:19", new Map([...dropped].slice(120)));
    const withGap = marketReturnFactor(partial);

    const mid = DATES[200]!;
    expect(withGap.get(mid)).toBeCloseTo(full.get(mid)!, 6);
  });

  it("ignores a date too few instruments report", () => {
    const one = new Map([["SYN:only", new Map(DATES.slice(0, 5).map((d, i) => [d, 100 + i]))]]);
    expect(marketReturnFactor(one).size).toBe(0);
  });
});
