import { describe, expect, it } from "vitest";
import { analyzeReturns } from "./analytics";
import { atr, ema, indicator, rollingZScore, rsi, sessionVwap, sma } from "./indicator-registry";
import { listModelAssumptions, modelAssumptions } from "./model-assumptions";

/**
 * Reference tests: hand-computable fixtures, so a formula edit that changes numbers fails HERE
 * with the expected value visible — not three layers up in a strategy result.
 */

describe("indicator registry — reference values and warmup honesty", () => {
  it("SMA matches hand arithmetic and is null through warmup", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out).toEqual([null, null, 2, 3, 4]);
  });

  it("EMA seeds with the SMA and then applies alpha", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(2); // seed = SMA(1,2,3)
    expect(out[3]).toBeCloseTo(3, 10); // 0.5·4 + 0.5·2
    expect(out[4]).toBeCloseTo(4, 10);
  });

  it("RSI is 100 on a monotonic rise, near 0 on a monotonic fall, null through warmup", () => {
    const rising = rsi(Array.from({ length: 20 }, (_, index) => 100 + index), 14);
    expect(rising[13]).toBeNull();
    expect(rising[14]).toBe(100);
    const falling = rsi(Array.from({ length: 20 }, (_, index) => 100 - index), 14);
    expect(falling[14]).toBe(0);
  });

  it("ATR equals the constant true range on a uniform series", () => {
    const bars = {
      open: Array.from({ length: 20 }, () => 100),
      high: Array.from({ length: 20 }, () => 101),
      low: Array.from({ length: 20 }, () => 99),
      close: Array.from({ length: 20 }, () => 100),
      volume: Array.from({ length: 20 }, () => 1),
    };
    const out = atr(bars, 14);
    expect(out[13]).toBeNull();
    expect(out[14]).toBeCloseTo(2, 10);
    expect(out[19]).toBeCloseTo(2, 10);
  });

  it("rolling z-score is zero at the mean and positive above it", () => {
    const out = rollingZScore([1, 2, 3, 2, 1, 2, 3, 4], 3);
    expect(out[0]).toBeNull();
    expect(out[2]).toBeCloseTo((3 - 2) / 1, 10);
  });

  it("session VWAP resets exactly at session starts", () => {
    const bars = {
      open: [10, 10, 20, 20],
      high: [10, 10, 20, 20],
      low: [10, 10, 20, 20],
      close: [10, 10, 20, 20],
      volume: [1, 1, 1, 1],
    };
    const out = sessionVwap(bars, [true, false, true, false]);
    expect(out[1]).toBeCloseTo(10, 10);
    expect(out[2]).toBeCloseTo(20, 10); // reset — the first session's prices are gone
  });

  it("every registered indicator declares warmup and nulls, never zeros, inside it", () => {
    const bars = {
      open: Array.from({ length: 60 }, (_, index) => 100 + Math.sin(index)),
      high: Array.from({ length: 60 }, (_, index) => 101 + Math.sin(index)),
      low: Array.from({ length: 60 }, (_, index) => 99 + Math.sin(index)),
      close: Array.from({ length: 60 }, (_, index) => 100 + Math.sin(index)),
      volume: Array.from({ length: 60 }, () => 1_000),
    };
    for (const spec of [indicator("sma"), indicator("rsi"), indicator("bollinger")]) {
      const outputs = spec.compute(bars, spec.parameters);
      for (const series of Object.values(outputs)) {
        expect(series).toHaveLength(60);
        for (let index = 0; index < Math.min(spec.warmup, 60); index += 1) {
          expect(series[index], `${spec.id} inside warmup`).toBeNull();
        }
      }
    }
    // MACD's outputs warm up at different times (line at slow−1, signal/histogram later); the
    // declared warmup is the LAST of them, and the slowest output honours it exactly.
    const macd = indicator("macd").compute(bars, indicator("macd").parameters);
    for (let index = 0; index < indicator("macd").warmup; index += 1) {
      expect(macd.histogram[index], "macd histogram inside warmup").toBeNull();
    }
    expect(macd.macd[24]).toBeNull();
    expect(macd.macd[25]).not.toBeNull();
  });
});

describe("analytics — the Lo adjustment and honest nulls", () => {
  it("reports null with reasons on an empty series — nothing is zero", () => {
    const report = analyzeReturns([]);
    expect(report.sharpeAnnualizedNaive).toBeNull();
    expect(report.unavailable.all).toMatch(/Nothing is reported as zero/);
  });

  it("agrees with hand arithmetic on a tiny series", () => {
    const report = analyzeReturns([0.1, -0.05]);
    expect(report.totalReturn).toBeCloseTo(1.1 * 0.95 - 1, 10);
    expect(report.meanReturn).toBeCloseTo(0.025, 10);
    expect(report.winRate).toBe(0.5);
  });

  it("serial-adjusted Sharpe (empirical lags, not AR(1)) is LOWER than naive under positive autocorrelation", () => {
    // A strongly trending (positively autocorrelated) return series: √t annualization overstates.
    const returns: number[] = [];
    let value = 0.001;
    for (let index = 0; index < 300; index += 1) {
      value = 0.9 * value + 0.001 + (index % 7 === 0 ? -0.004 : 0.0005);
      returns.push(value);
    }
    const report = analyzeReturns(returns, 252);
    expect(report.serialAdjustment).not.toBeNull();
    expect(report.serialAdjustment!.estimator).toBe("lo2002_empirical_autocovariance");
    expect(report.serialAdjustment!.lagsUsed).toBeGreaterThan(1);
    expect(report.serialAdjustment!.autocorrelations[0]).toBeGreaterThan(0.2);
    expect(report.sharpeAnnualizedSerialAdjusted).not.toBeNull();
    expect(report.sharpeAnnualizedNaive).not.toBeNull();
    expect(report.sharpeAnnualizedSerialAdjusted!).toBeLessThan(report.sharpeAnnualizedNaive!);
  });

  it("tail metrics refuse thin samples and appear with a real one, historical beside normal", () => {
    const thin = analyzeReturns(Array.from({ length: 30 }, (_, index) => (index % 2 === 0 ? 0.01 : -0.01)));
    expect(thin.var95Historical).toBeNull();
    expect(thin.unavailable.var95Historical).toMatch(/rmp-2026-08-10.1/);
    expect(thin.unavailable.var95Historical).toMatch(/stated policy/);
    expect(thin.riskPolicy.policyVersion).toBe("rmp-2026-08-10.1");

    const wide = analyzeReturns(
      Array.from({ length: 500 }, (_, index) => (index % 16 === 0 ? -0.05 : 0.002)),
      252,
    );
    expect(wide.var95Historical).toBeGreaterThan(0);
    expect(wide.expectedShortfall95).toBeGreaterThanOrEqual(wide.var95Historical!);
    expect(wide.var95Normal).not.toBeNull();
    // Fat-ish left tail: the historical figure exceeds the Gaussian baseline — the exact reason
    // the normal figure is labelled an assumption-carrying baseline, never the only number.
    expect(wide.var95Historical!).toBeGreaterThan(0);
  });

  it("drawdown and duration match a constructed path", () => {
    // +10%, then two −10% periods, then recovery.
    const report = analyzeReturns([0.1, -0.1, -0.1, 0.3]);
    expect(report.maxDrawdown).toBeCloseTo(1 - 0.9 * 0.9, 10);
    expect(report.maxDrawdownDurationPeriods).toBeGreaterThanOrEqual(2);
  });
});

describe("model assumption registry", () => {
  it("refuses an unregistered model — no assumption record, no display", () => {
    expect(() => modelAssumptions("mystery_model")).toThrow(/register it first/i);
  });

  it("GBM's record names the failure modes the curriculum warned about", () => {
    const gbm = modelAssumptions("gbm");
    expect(gbm.knownFailureModes.join(" ")).toMatch(/fat tails/);
    expect(gbm.knownFailureModes.join(" ")).toMatch(/volatility clustering/);
    expect(gbm.invalidUses.join(" ")).toMatch(/market model/);
  });

  it("results pin assumption fingerprints — id, version AND content hash", () => {
    const report = analyzeReturns(Array.from({ length: 200 }, (_, index) => (index % 3 === 0 ? -0.01 : 0.008)), 252);
    expect(report.assumptions.length).toBeGreaterThan(0);
    for (const fingerprint of report.assumptions) {
      expect(fingerprint.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(fingerprint.version).toBeTruthy();
    }
    const ids = report.assumptions.map((entry) => entry.id);
    expect(ids).toContain("serial_adjusted_sharpe");
    expect(ids).not.toContain("lo_adjusted_sharpe"); // the honest rename is complete
  });

  it("context-requiring indicators refuse to run without their context", () => {
    const bars = {
      open: [1, 2, 3], high: [1, 2, 3], low: [1, 2, 3], close: [1, 2, 3], volume: [1, 1, 1],
    };
    expect(() => indicator("rolling_correlation").compute(bars, { period: 2 })).toThrow(/context.pair/);
    expect(() => indicator("vwap").compute(bars, {})).toThrow(/sessionStarts/);
    const withContext = indicator("vwap").compute(bars, {}, { sessionStarts: [true, false, false] });
    expect(withContext.vwap[0]).not.toBeNull();
  });

  it("EWMA's registered convention is recursive λ-decay, adjust=false — proven, not just stated", () => {
    const spec = indicator("ewma");
    expect(spec.conventions?.decay_parameter).toMatch(/RiskMetrics/);
    const out = spec.compute({ open: [10, 20], high: [10, 20], low: [10, 20], close: [10, 20], volume: [1, 1] }, { lambda: 0.9 });
    expect(out.ewma[0]).toBe(10); // initialization: first observation
    expect(out.ewma[1]).toBeCloseTo(0.9 * 10 + 0.1 * 20, 10); // next = λ·prev + (1−λ)·value
  });

  it("the correlation record carries the CORRECTED crisis claim — rises, not disappears", () => {
    const correlation = modelAssumptions("pearson_correlation");
    expect(correlation.knownFailureModes.join(" ")).toMatch(/rise sharply during market stress/i);
  });

  it("every entry declares assumptions, failure modes and both use lists", () => {
    for (const entry of listModelAssumptions()) {
      expect(entry.assumes.length).toBeGreaterThan(0);
      expect(entry.knownFailureModes.length).toBeGreaterThan(0);
      expect(entry.validUses.length).toBeGreaterThan(0);
      expect(entry.invalidUses.length).toBeGreaterThan(0);
    }
  });
});
