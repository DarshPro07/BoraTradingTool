import { describe, expect, it } from "vitest";
import { importCandles, validationFitness, type DatasetDeclaration } from "./dataset-import";

const CLEAN: DatasetDeclaration = {
  source: "huggingface:example/nse-minute",
  license: "CC-BY-4.0",
  adjustment: "raw",
  includesDelisted: true,
  resolution: "1",
};

const T0 = 1_780_000_000;

function bar(offsetMinutes: number, overrides: Record<string, unknown> = {}) {
  return { ticker: "IN:XNSE:RELIANCE", time: T0 + offsetMinutes * 60, open: 100, high: 101, low: 99, close: 100.5, volume: 1000, ...overrides };
}

describe("a downloaded price series is the least verifiable input this system takes", () => {
  it("refuses back-adjusted prices for validation", () => {
    // The important case. Adjusting for a split that happened *after* the bar means every
    // historical decision made on it used information from the future — and unlike a missing
    // feature, this does not error. It quietly improves the equity curve.
    const reason = validationFitness({ ...CLEAN, adjustment: "adjusted" });
    expect(reason).toMatch(/after it/);
  });

  it("treats an unstated adjustment as unusable, not as safe", () => {
    // "Unknown" and "unadjusted" are opposite claims. Defaulting to the convenient one is how a
    // contaminated series becomes evidence.
    expect(validationFitness({ ...CLEAN, adjustment: "unknown" })).toMatch(/not the same as unadjusted/);
  });

  it("refuses a survivorship-biased sample, and an unstated one", () => {
    expect(validationFitness({ ...CLEAN, includesDelisted: false })).toMatch(/optimistic/);
    expect(validationFitness({ ...CLEAN, includesDelisted: null })).toMatch(/cannot be ruled out/);
  });

  it("refuses a dataset with no recorded licence", () => {
    expect(validationFitness({ ...CLEAN, license: null })).toMatch(/licence/i);
  });

  it("permits a dataset that declares all three", () => {
    expect(validationFitness(CLEAN)).toBeNull();
  });
});

describe("row validation costs the row, not the dataset", () => {
  it("accepts clean bars", () => {
    const report = importCandles([bar(0), bar(1), bar(2)], CLEAN);
    expect(report.accepted).toHaveLength(3);
    expect(report.rejected).toHaveLength(0);
    expect(report.unfitForValidation).toBeNull();
  });

  it("rejects a zero price rather than importing an infinite return", () => {
    const report = importCandles([bar(0), bar(1, { low: 0 })], CLEAN);
    expect(report.accepted).toHaveLength(1);
    expect(report.rejected[0]?.code).toBe("NON_POSITIVE_PRICE");
  });

  it("rejects a bar whose close lies outside its own range", () => {
    // Not an OHLC bar whatever the file calls it. Importing it would let a strategy fill at a
    // price the bar never contained.
    const report = importCandles([bar(0, { close: 200 })], CLEAN);
    expect(report.rejected[0]?.code).toBe("INCOHERENT_BAR");
  });

  it("rejects high below low", () => {
    expect(importCandles([bar(0, { high: 98, low: 99 })], CLEAN).rejected[0]?.code).toBe("INCOHERENT_BAR");
  });

  it("rejects a duplicated timestamp, which would double-count its signal", () => {
    const report = importCandles([bar(0), bar(0)], CLEAN);
    expect(report.accepted).toHaveLength(1);
    expect(report.rejected[0]?.code).toBe("DUPLICATE_TIME");
  });

  it("rejects a bar that precedes the previous one", () => {
    const report = importCandles([bar(5), bar(1)], CLEAN);
    expect(report.rejected[0]?.code).toBe("OUT_OF_ORDER");
  });

  it("rejects negative volume but accepts zero", () => {
    expect(importCandles([bar(0, { volume: -1 })], CLEAN).rejected[0]?.code).toBe("NEGATIVE_VOLUME");
    expect(importCandles([bar(0, { volume: 0 })], CLEAN).accepted).toHaveLength(1);
  });

  it("keeps a missing volume as null rather than as zero", () => {
    // Zero volume is a finding — nothing traded. Missing volume is an absence. A dataset that
    // omits the column must not be read as a market where nobody traded.
    const report = importCandles([bar(0, { volume: undefined })], CLEAN);
    expect(report.accepted[0]?.volume).toBeNull();
  });

  it("reports every rejection instead of silently shortening the series", () => {
    const report = importCandles([bar(0), bar(1, { open: NaN }), bar(2)], CLEAN);
    expect(report.rejected).toHaveLength(1);
    expect(report.summary).toMatch(/1 rejected/);
  });
});

describe("gaps are found, because a hole and a flat session look alike once in a table", () => {
  it("flags a run of missing bars", () => {
    const report = importCandles([bar(0), bar(1), bar(30)], CLEAN);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]?.missingBars).toBe(28);
  });

  it("tolerates ordinary spacing", () => {
    expect(importCandles([bar(0), bar(1), bar(2)], CLEAN).gaps).toHaveLength(0);
  });

  it("does not attempt gap detection for a resolution with no fixed spacing", () => {
    const weekly: DatasetDeclaration = { ...CLEAN, resolution: "W" };
    const report = importCandles([bar(0), bar(10_000)], weekly);
    expect(report.gaps).toHaveLength(0);
  });
});

describe("the report states fitness in words, not just a flag", () => {
  it("says plainly when a dataset cannot be used for a trial", () => {
    const report = importCandles([bar(0)], { ...CLEAN, adjustment: "adjusted" });
    expect(report.accepted).toHaveLength(1); // still imported — exploration is legitimate
    expect(report.summary).toMatch(/NOT usable for validation/);
  });
});
