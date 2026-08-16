import { describe, expect, it } from "vitest";
import { normalizeSeries, PriceBasisUnavailableError, type CorporateAction } from "./price-basis";

/**
 * The defect this exists for, measured 2026-08-16 in the production store:
 *
 *   RELIANCE  2024-10-24 = 2655.70   beside   2024-10-27 = 1334.35
 *   HDFCBANK  2025-08-24 = 1964.10   beside   2025-08-25 =  973.40
 *
 * Yahoo retroactively adjusts its whole history at a corporate action. `persistCandles` is
 * idempotent by (ticker, resolution, time) and never revisits a stored bar, so bars written
 * before an action keep the old basis forever while later bars arrive on the new one. A 1:2 split
 * then presents as a −50% single-day drop: the strongest possible trigger for the declared
 * swing mean-reversion family, and not a market event.
 *
 * THE SUBTLETY THAT SHAPES THIS API. The store is not uniformly RAW — it is "raw as of the date
 * each bar was ingested". An instrument whose whole history was fetched *after* a split is
 * already adjusted end to end, and blindly back-adjusting it by the known ratio would corrupt a
 * series that was correct. So knowing the action is not sufficient authority to apply it: the
 * normalizer must first observe that THIS series actually steps at that boundary.
 *
 * Verify before accept, which is the same doctrine the rest of this repository already runs on.
 */

const DAY = 86_400;
const T0 = 1_700_000_000;

/** A flat series at `price`, one bar per day. */
function flat(price: number, count: number, from = T0) {
  return Array.from({ length: count }, (_unused, index) => ({
    time: from + index * DAY,
    open: price,
    high: price * 1.01,
    low: price * 0.99,
    close: price,
    volume: 1_000,
  }));
}

const SPLIT_AT = T0 + 5 * DAY;

const split2for1: CorporateAction = {
  instrumentId: "IN:XNSE:RELIANCE",
  effectiveTime: SPLIT_AT,
  kind: "SPLIT",
  ratio: 2,
  amount: null,
  source: "yahoo:events",
};

describe("normalising a series that actually steps at the action", () => {
  it("back-adjusts the pre-split half so the series is continuous", () => {
    // The RELIANCE shape: 2000 before, 1000 after — a step the market did not make.
    const bars = [...flat(2000, 5), ...flat(1000, 5, SPLIT_AT)];
    const out = normalizeSeries(bars, [split2for1], "SPLIT_ADJUSTED");

    expect(out.applied).toHaveLength(1);
    expect(out.bars.slice(0, 5).every((bar) => Math.abs(bar.close - 1000) < 1e-6)).toBe(true);
    expect(out.bars.slice(5).every((bar) => Math.abs(bar.close - 1000) < 1e-6)).toBe(true);
  });

  it("scales volume the opposite way, because the share count changed too", () => {
    const bars = [...flat(2000, 5), ...flat(1000, 5, SPLIT_AT)];
    const out = normalizeSeries(bars, [split2for1], "SPLIT_ADJUSTED");
    expect(out.bars[0].volume).toBeCloseTo(2_000, 6);
    expect(out.bars[9].volume).toBeCloseTo(1_000, 6);
  });

  it("keeps the whole bar internally coherent after adjustment", () => {
    const bars = [...flat(2000, 5), ...flat(1000, 5, SPLIT_AT)];
    const out = normalizeSeries(bars, [split2for1], "SPLIT_ADJUSTED");
    for (const bar of out.bars) {
      expect(bar.high).toBeGreaterThanOrEqual(bar.low);
      expect(bar.open).toBeGreaterThanOrEqual(bar.low);
      expect(bar.close).toBeLessThanOrEqual(bar.high);
    }
  });
});

describe("refusing to adjust a series that is already on the new basis", () => {
  it("SKIPS a known split when the series shows no step — the double-adjustment guard", () => {
    // An instrument whose entire history was fetched after the split is already continuous.
    // Applying the ratio anyway would halve a correct past and manufacture the very defect this
    // module exists to remove.
    const bars = flat(1000, 10);
    const out = normalizeSeries(bars, [split2for1], "SPLIT_ADJUSTED");

    expect(out.applied).toHaveLength(0);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0].reason).toMatch(/already/i);
    expect(out.bars.every((bar) => Math.abs(bar.close - 1000) < 1e-6)).toBe(true);
  });

  it("flags a step that does not match the declared ratio rather than forcing it", () => {
    // A real −30% day beside a declared 1:2 split is not a split. Forcing the ratio would erase a
    // genuine market move; ignoring the mismatch silently would hide a provider disagreement.
    const bars = [...flat(1430, 5), ...flat(1000, 5, SPLIT_AT)];
    const out = normalizeSeries(bars, [split2for1], "SPLIT_ADJUSTED");

    expect(out.applied).toHaveLength(0);
    expect(out.ambiguous).toHaveLength(1);
    expect(out.ambiguous[0].observedRatio).toBeCloseTo(1.43, 2);
    expect(out.ambiguous[0].declaredRatio).toBe(2);
  });
});

describe("the basis contract", () => {
  it("AS_FETCHED returns the stored bars untouched", () => {
    const bars = [...flat(2000, 5), ...flat(1000, 5, SPLIT_AT)];
    const out = normalizeSeries(bars, [split2for1], "AS_FETCHED");
    expect(out.basis).toBe("AS_FETCHED");
    expect(out.applied).toHaveLength(0);
    expect(out.bars[0].close).toBe(2000);
  });

  it("REFUSES RAW rather than aliasing it to AS_FETCHED", () => {
    /**
     * VERIFIED against Yahoo, 2026-08-16, around RELIANCE's 1:1 bonus of ex-date 2024-10-28:
     *
     *   2024-10-22   as fetched then   O 2675.00  C 2677.05
     *                as fetched now    O 1369.20  C 1343.35
     *
     * The provider retroactively adjusts the WHOLE OHLC, so a stored bar carries whatever basis
     * was current the day it was written. "RAW" claims the numbers printed on the tape, and this
     * store cannot make that claim about history — reconstructing it needs per-bar ingestion dates
     * that predate the ingestion ledger.
     *
     * Refusing is the point. Execution simulation and cost accounting are exactly where the
     * difference decides whether a fill was possible, so letting AS_FETCHED answer to the name
     * RAW would put the error where it does the most damage.
     */
    const bars = [...flat(2000, 5), ...flat(1000, 5, SPLIT_AT)];
    expect(() => normalizeSeries(bars, [split2for1], "RAW")).toThrow(PriceBasisUnavailableError);
    expect(() => normalizeSeries(bars, [split2for1], "RAW")).toThrow(/retroactively adjusts/i);
  });

  it("TOTAL_RETURN applies dividends on top of splits", () => {
    const dividend: CorporateAction = {
      instrumentId: "IN:XNSE:RELIANCE",
      effectiveTime: SPLIT_AT,
      kind: "DIVIDEND",
      ratio: null,
      amount: 10,
      source: "yahoo:events",
    };
    const bars = flat(1000, 10);
    const adjusted = normalizeSeries(bars, [dividend], "TOTAL_RETURN");
    const splitOnly = normalizeSeries(bars, [dividend], "SPLIT_ADJUSTED");

    // A dividend is a real distribution: the pre-ex history is scaled down so the return series
    // credits it. SPLIT_ADJUSTED deliberately ignores it.
    expect(adjusted.bars[0].close).toBeLessThan(1000);
    expect(splitOnly.bars[0].close).toBe(1000);
  });

  it("is deterministic — the same inputs give byte-identical output", () => {
    const bars = [...flat(2000, 5), ...flat(1000, 5, SPLIT_AT)];
    const a = normalizeSeries(bars, [split2for1], "SPLIT_ADJUSTED");
    const b = normalizeSeries(bars, [split2for1], "SPLIT_ADJUSTED");
    expect(JSON.stringify(a.bars)).toBe(JSON.stringify(b.bars));
  });

  it("applies multiple actions cumulatively, oldest bar most adjusted", () => {
    const second: CorporateAction = { ...split2for1, effectiveTime: T0 + 8 * DAY, ratio: 5 };
    const bars = [...flat(10_000, 5), ...flat(5_000, 3, SPLIT_AT), ...flat(1_000, 2, T0 + 8 * DAY)];
    const out = normalizeSeries(bars, [split2for1, second], "SPLIT_ADJUSTED");

    expect(out.applied).toHaveLength(2);
    // 10,000 / (2 x 5) = 1,000 — continuous with the final segment.
    expect(out.bars[0].close).toBeCloseTo(1_000, 6);
    expect(out.bars[9].close).toBeCloseTo(1_000, 6);
  });

  it("leaves a series with no actions exactly as it found it", () => {
    const bars = flat(1000, 10);
    const out = normalizeSeries(bars, [], "SPLIT_ADJUSTED");
    expect(JSON.stringify(out.bars)).toBe(JSON.stringify(bars));
  });
});

describe("locating the boundary when the action date does not match the bar labels", () => {
  /**
   * The production failure this pins, measured 2026-08-16. Yahoo dates RELIANCE's 2:1 split
   * `2024-10-28`; our stored series steps between `2024-10-24` and `2024-10-27`. Measuring the
   * step at exactly the nominal instant landed inside the post-split half, read 0.996, and
   * concluded "already adjusted" — ALL 26 affected instruments were skipped and nothing was fixed.
   *
   * Whatever boundary is found must still match the declared ratio, so this is date tolerance and
   * not a licence to hunt for a step.
   */
  it("finds the step when the action is dated a few days off the bar", () => {
    const bars = [...flat(2000, 5), ...flat(1000, 5, SPLIT_AT)];
    const lateByThreeDays: CorporateAction = { ...split2for1, effectiveTime: SPLIT_AT + 3 * DAY };
    const out = normalizeSeries(bars, [lateByThreeDays], "SPLIT_ADJUSTED");

    expect(out.applied, "a split dated 3 days off must still be found").toHaveLength(1);
    expect(out.bars[0].close).toBeCloseTo(1000, 6);
  });

  it("still refuses when nothing inside the window matches the declared ratio", () => {
    // Date tolerance must not become "find any step". A flat series near the date is flat.
    const bars = flat(1000, 12);
    const out = normalizeSeries(bars, [{ ...split2for1, effectiveTime: SPLIT_AT + 2 * DAY }], "SPLIT_ADJUSTED");
    expect(out.applied).toHaveLength(0);
    expect(out.skipped).toHaveLength(1);
  });

  it("does not reach outside the search window for a step", () => {
    // A real split far from the declared date is not this action; adjusting there would move a
    // boundary the feed never claimed.
    const bars = [...flat(2000, 5), ...flat(1000, 20, SPLIT_AT)];
    const wayOff: CorporateAction = { ...split2for1, effectiveTime: SPLIT_AT + 18 * DAY };
    const out = normalizeSeries(bars, [wayOff], "SPLIT_ADJUSTED");
    expect(out.applied).toHaveLength(0);
  });
});
