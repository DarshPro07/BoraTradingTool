import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { importedDatasets, loadStoredCandles, persistCandles, recordDatasetImport, storedCoverage } from "./candle-store";
import type { DatasetDeclaration, ImportedCandle } from "./dataset-import";

useTemporaryDatabase();

const T0 = 1_780_000_000;

function bar(offsetMinutes: number, ticker = "IN:XNSE:RELIANCE"): ImportedCandle {
  return {
    ticker,
    resolution: "1",
    time: T0 + offsetMinutes * 60,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1000,
  };
}

const DECLARATION: DatasetDeclaration = {
  source: "huggingface:example/nse-minute",
  license: "CC-BY-4.0",
  adjustment: "raw",
  includesDelisted: true,
  resolution: "1",
};

describe("persisting imported bars", () => {
  it("stores and reads back in time order", () => {
    persistCandles([bar(2), bar(0), bar(1)]);
    const loaded = loadStoredCandles("IN:XNSE:RELIANCE", "1");
    expect(loaded.map((candle) => candle.time)).toEqual([T0, T0 + 60, T0 + 120]);
  });

  it("is idempotent, so re-running an import does not double the series", () => {
    // `price_candles` has no unique constraint on (ticker, resolution, time) and adding one needs
    // a migration this agent cannot apply, so uniqueness is enforced in code. If that ever breaks,
    // a re-import silently doubles every bar and every backtest built on it is wrong.
    expect(persistCandles([bar(0), bar(1)])).toEqual({ inserted: 2, skipped: 0 });
    expect(persistCandles([bar(0), bar(1)])).toEqual({ inserted: 0, skipped: 2 });
    expect(loadStoredCandles("IN:XNSE:RELIANCE", "1")).toHaveLength(2);
  });

  it("drops a duplicate inside a single batch, not just against what is stored", () => {
    expect(persistCandles([bar(0), bar(0)])).toEqual({ inserted: 1, skipped: 1 });
  });

  it("keeps resolutions separate", () => {
    persistCandles([bar(0)]);
    persistCandles([{ ...bar(0), resolution: "5" }]);
    expect(loadStoredCandles("IN:XNSE:RELIANCE", "1")).toHaveLength(1);
    expect(loadStoredCandles("IN:XNSE:RELIANCE", "5")).toHaveLength(1);
  });

  it("filters by time range", () => {
    persistCandles([bar(0), bar(1), bar(2), bar(3)]);
    expect(loadStoredCandles("IN:XNSE:RELIANCE", "1", T0 + 60, T0 + 120)).toHaveLength(2);
  });

  it("accepts an empty import without touching the database", () => {
    expect(persistCandles([])).toEqual({ inserted: 0, skipped: 0 });
  });
});

describe("coverage reports absence as absence", () => {
  it("returns nothing when nothing is stored", () => {
    expect(storedCoverage()).toEqual([]);
  });

  it("reports the real range per ticker and resolution", () => {
    persistCandles([bar(0), bar(5), bar(2)]);
    persistCandles([bar(0, "US:XNAS:AAPL")]);
    const coverage = storedCoverage();
    const reliance = coverage.find((entry) => entry.ticker === "IN:XNSE:RELIANCE");
    expect(reliance?.bars).toBe(3);
    expect(reliance?.firstTime).toBe(T0);
    expect(reliance?.lastTime).toBe(T0 + 300);
    // Ordered by size, so the deepest series is the first thing read.
    expect(coverage[0]?.ticker).toBe("IN:XNSE:RELIANCE");
  });

  it("never reports a range starting at the epoch when empty", () => {
    // `0` here would claim bars going back to 1970 — the sort of plausible number that survives
    // review because it looks like data rather than like a missing value.
    expect(storedCoverage("IN:XNSE:NOTHING")).toEqual([]);
  });
});

describe("the declaration is recorded with the import", () => {
  it("keeps the reason a dataset is unfit, not just the fact", () => {
    recordDatasetImport(
      { ...DECLARATION, adjustment: "adjusted" },
      { inserted: 10, skipped: 0, rejected: 1, unfitForValidation: "Prices are back-adjusted." },
      "owner",
    );
    const [record] = importedDatasets();
    expect(record.source).toBe("huggingface:example/nse-minute");
    expect(record.declaration?.adjustment).toBe("adjusted");
    expect(record.unfitForValidation).toMatch(/back-adjusted/);
    expect(record.inserted).toBe(10);
  });

  it("records a usable dataset with no caveat", () => {
    recordDatasetImport(DECLARATION, { inserted: 5, skipped: 0, rejected: 0, unfitForValidation: null }, "owner");
    expect(importedDatasets()[0]?.unfitForValidation).toBeNull();
  });

  it("returns newest first", () => {
    recordDatasetImport({ ...DECLARATION, source: "kaggle:a/first" }, { inserted: 1, skipped: 0, rejected: 0, unfitForValidation: null });
    recordDatasetImport({ ...DECLARATION, source: "kaggle:b/second" }, { inserted: 1, skipped: 0, rejected: 0, unfitForValidation: null });
    expect(importedDatasets()[0]?.source).toBe("kaggle:b/second");
  });
});
