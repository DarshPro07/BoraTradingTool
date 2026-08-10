import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import {
  PriceDomainError,
  assertDomainForPurpose,
  isTranslationInvariant,
  logReturn,
  normalizedLocation,
  pctChange,
  priceFrame,
  requireSameDomain,
  shiftFrame,
  spread,
  tradedPrice,
} from "./price-domain";

/**
 * The rule this module exists to enforce, stated as a test.
 *
 * `lib/backtest/engine.ts:298` computes
 *
 *     grossReturn = (exit.price - entryPrice) / entryPrice
 *
 * which is a ratio. On a continuous additive series every historical price carries a cumulative
 * roll adjustment, so adding that constant changes the answer — and nothing errors. The backtest
 * simply reports a different number and looks entirely healthy.
 *
 * Translation invariance is the whole rule: an operation is legal on CONTINUOUS_ADDITIVE if and
 * only if adding a constant to every price leaves its result unchanged. These tests assert that
 * definition directly rather than trusting a hand-maintained list of banned function names.
 */

function bars(closes: readonly number[]): Candle[] {
  return closes.map((close, i) => ({
    time: 1_700_000_000 + i * 60,
    open: close,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1_000,
  }));
}

const SERIES = bars([100, 110, 121]);

describe("the ban on ratios over additive prices", () => {
  it("refuses a percentage change on a continuous additive series", () => {
    const additive = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", { instrumentId: "NSE:NIFTY" });
    expect(() => pctChange(additive as never, 1)).toThrow(PriceDomainError);
  });

  it("refuses a log return on a continuous additive series", () => {
    const additive = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", { instrumentId: "NSE:NIFTY" });
    expect(() => logReturn(additive as never, 1)).toThrow(/CONTINUOUS_ADDITIVE/);
  });

  it("allows a percentage change on raw traded prices", () => {
    const raw = priceFrame(SERIES, "RAW_TRADED", { instrumentId: "NSE:NIFTY25AUGFUT" });
    expect(pctChange(raw, 1)).toBeCloseTo(0.1, 10);
  });

  it("allows a percentage change on a ratio-adjusted series", () => {
    const ratio = priceFrame(SERIES, "CONTINUOUS_RATIO", { instrumentId: "NSE:NIFTY" });
    expect(pctChange(ratio, 1)).toBeCloseTo(0.1, 10);
  });
});

describe("translation invariance is verified, not asserted", () => {
  const additive = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", { instrumentId: "NSE:NIFTY" });

  it("proves a legal operation is unchanged by a constant shift", () => {
    // high - low. Adding 5,000 points of cumulative roll adjustment must not move it.
    expect(spread(additive, 1)).toBe(spread(shiftFrame(additive, 5_000), 1));
  });

  it("proves the banned operation really does change — the ban is not arbitrary", () => {
    const raw = priceFrame(SERIES, "RAW_TRADED", { instrumentId: "NSE:NIFTY25AUGFUT" });
    const shifted = priceFrame(shiftFrame(raw, 5_000).bars, "RAW_TRADED", { instrumentId: "x" });
    // 10% becomes ~0.2%. A backtest would report the second number and look perfectly healthy.
    expect(pctChange(shifted, 1)).not.toBeCloseTo(pctChange(raw, 1), 3);
  });

  it("classifies an invariant function as invariant", () => {
    expect(isTranslationInvariant((f) => spread(f, 1), additive)).toBe(true);
  });

  it("classifies a ratio function as variant", () => {
    expect(isTranslationInvariant((f) => f.bars[1].close / f.bars[0].close, additive)).toBe(false);
  });

  it("allows normalized location, because the shift cancels top and bottom", () => {
    // (price - low) / (high - low) is the example the specification calls out as legal.
    expect(normalizedLocation(additive, 1)).toBeCloseTo(normalizedLocation(shiftFrame(additive, 5_000), 1), 10);
  });
});

describe("execution may only ever use prices that traded", () => {
  it("refuses a fill price from a continuous additive series", () => {
    const additive = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", { instrumentId: "NSE:NIFTY" });
    expect(() => tradedPrice(additive as never, 1)).toThrow(/RAW_TRADED/);
  });

  it("refuses a fill price from a ratio-adjusted series", () => {
    const ratio = priceFrame(SERIES, "CONTINUOUS_RATIO", { instrumentId: "NSE:NIFTY" });
    expect(() => tradedPrice(ratio as never, 1)).toThrow(PriceDomainError);
  });

  it("allows a fill price from raw traded bars", () => {
    const raw = priceFrame(SERIES, "RAW_TRADED", { instrumentId: "NSE:NIFTY25AUGFUT" });
    expect(tradedPrice(raw, 1)).toBe(110);
  });
});

describe("the loader gate refuses a purpose its domain cannot serve", () => {
  it("refuses execution simulation on an adjusted series", () => {
    expect(() => assertDomainForPurpose("CONTINUOUS_ADDITIVE", "EXECUTION_SIM")).toThrow(PriceDomainError);
  });

  it("refuses reconciliation on an adjusted series", () => {
    expect(() => assertDomainForPurpose("CONTINUOUS_RATIO", "RECONCILIATION")).toThrow(/RAW_TRADED/);
  });

  it("refuses a return signal on an additive series", () => {
    expect(() => assertDomainForPurpose("CONTINUOUS_ADDITIVE", "RETURN_SIGNAL")).toThrow(PriceDomainError);
  });

  it("permits point geometry on an additive series", () => {
    expect(() => assertDomainForPurpose("CONTINUOUS_ADDITIVE", "POINT_SIGNAL")).not.toThrow();
  });

  it("permits a chart on raw traded prices", () => {
    expect(() => assertDomainForPurpose("RAW_TRADED", "CHART")).not.toThrow();
  });
});

describe("operands must share a domain and an instrument", () => {
  it("refuses a raw price measured against an adjusted range", () => {
    // The failure this catches: the result looks normalized and is not, because the two sides
    // sit on axes separated by the cumulative roll adjustment.
    const raw = priceFrame(SERIES, "RAW_TRADED", { instrumentId: "NSE:NIFTY25AUGFUT" });
    const additive = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", { instrumentId: "NSE:NIFTY" });
    expect(() => requireSameDomain(raw, additive)).toThrow(PriceDomainError);
  });

  it("refuses two additive series from different instruments", () => {
    // Two additive series carry two different cumulative adjustments, so their price LEVELS are
    // not on the same axis. "NIFTY is above BANKNIFTY" is meaningless here even though both
    // numbers are finite and plausible. Distances stay comparable; levels do not.
    const nifty = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", { instrumentId: "NSE:NIFTY" });
    const bank = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", { instrumentId: "NSE:BANKNIFTY" });
    expect(() => requireSameDomain(nifty, bank)).toThrow(/instrument/i);
  });

  it("permits two frames from the same instrument and domain", () => {
    const a = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", { instrumentId: "NSE:NIFTY" });
    const b = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", { instrumentId: "NSE:NIFTY" });
    expect(() => requireSameDomain(a, b)).not.toThrow();
  });
});

describe("the compiler refuses it too, not only the runtime", () => {
  it("rejects a ratio over an additive frame at compile time", () => {
    const additive = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", { instrumentId: "NSE:NIFTY" });

    // `@ts-expect-error` is the assertion: if this line ever STOPS being a type error, the
    // directive becomes unused and `tsc --noEmit` fails. That makes the static half of the
    // guarantee a test rather than a claim — the runtime tests above pass either way, because
    // every one of them casts through `never` to reach the runtime check.
    // @ts-expect-error CONTINUOUS_ADDITIVE is not assignable to RatioSafeDomain
    expect(() => pctChange(additive, 1)).toThrow(PriceDomainError);
  });

  it("rejects an adjusted frame for execution at compile time", () => {
    const ratio = priceFrame(SERIES, "CONTINUOUS_RATIO", { instrumentId: "NSE:NIFTY" });

    // @ts-expect-error CONTINUOUS_RATIO is not assignable to ExecutionSafeDomain
    expect(() => tradedPrice(ratio, 1)).toThrow(PriceDomainError);
  });
});

describe("the frame reports its own provenance", () => {
  it("carries the cumulative adjustment on an adjusted series", () => {
    const additive = priceFrame(SERIES, "CONTINUOUS_ADDITIVE", {
      instrumentId: "NSE:NIFTY",
      cumulativeAdjustment: 1_250,
    });
    expect(additive.cumulativeAdjustment).toBe(1_250);
  });

  it("refuses a cumulative adjustment on raw traded prices", () => {
    // A raw series that claims an adjustment is mislabelled — one of the two facts is wrong,
    // and guessing which would hide the defect rather than surface it.
    expect(() =>
      priceFrame(SERIES, "RAW_TRADED", { instrumentId: "NSE:NIFTY25AUGFUT", cumulativeAdjustment: 1_250 }),
    ).toThrow(PriceDomainError);
  });
});
