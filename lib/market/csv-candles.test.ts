import { describe, expect, it } from "vitest";
import { parseCandleCsv, parseTime, suggestsAdjustedPrices } from "./csv-candles";
import { importCandles, type DatasetDeclaration } from "./dataset-import";

const OPTIONS = { resolution: "1", defaultTicker: "IN:XNSE:RELIANCE" };

describe("column mapping is explicit, because guessing loosely is the dangerous failure", () => {
  it("reads a conventional header", () => {
    const csv = "Date,Open,High,Low,Close,Volume\n2026-08-06T09:15:00Z,100,101,99,100.5,1000";
    const result = parseCandleCsv(csv, OPTIONS);
    expect(result.error).toBeNull();
    expect(result.rows[0]).toMatchObject({ open: 100, high: 101, low: 99, close: 100.5, volume: 1000 });
  });

  it("matches regardless of case, spacing and separators", () => {
    const csv = "date_time,OPEN,High Price,low_price,LAST,vol\n1780000000,1,2,0.5,1.5,7";
    const result = parseCandleCsv(csv, OPTIONS);
    expect(result.error).toBeNull();
    expect(result.rows[0]).toMatchObject({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 7 });
  });

  it("never maps Adj Close onto close", () => {
    // The whole point. `Adj Close` is the back-adjusted price that `dataset-import` refuses for
    // validation; accepting it as `close` would defeat that check one file earlier, where nobody
    // is looking. Without a real `Close` column this must refuse, not substitute.
    const csv = "Date,Open,High,Low,Adj Close\n1780000000,1,2,0.5,1.5";
    const result = parseCandleCsv(csv, OPTIONS);
    expect(result.error).toMatch(/close/);
    expect(result.rows).toHaveLength(0);
  });

  it("flags a file that carries adjusted columns alongside real ones", () => {
    const csv = "Date,Open,High,Low,Close,Adj Close\n1780000000,1,2,0.5,1.5,1.4";
    const result = parseCandleCsv(csv, OPTIONS);
    expect(result.error).toBeNull();
    expect(suggestsAdjustedPrices(result.header)).toBe(true);
    // Unmapped columns are reported rather than silently dropped — an `adj_close` sitting next to
    // `close` is the file telling you something about its provenance.
    expect(result.ignored).toContain("Adj Close");
  });

  it("refuses when a required column is absent, and prints the header", () => {
    const result = parseCandleCsv("Date,Open,Close\n1780000000,1,1.5", OPTIONS);
    expect(result.error).toMatch(/high, low/);
    expect(result.error).toMatch(/Header was/);
  });

  it("refuses when there is no ticker column and no default", () => {
    const csv = "Date,Open,High,Low,Close\n1780000000,1,2,0.5,1.5";
    const result = parseCandleCsv(csv, { resolution: "1" });
    expect(result.error).toMatch(/cannot be attributed/);
  });

  it("prefers a ticker column over the default", () => {
    const csv = "symbol,Date,Open,High,Low,Close\nUS:XNAS:AAPL,1780000000,1,2,0.5,1.5";
    expect(parseCandleCsv(csv, OPTIONS).rows[0]?.ticker).toBe("US:XNAS:AAPL");
  });
});

describe("timestamps", () => {
  it("reads unix seconds and milliseconds distinctly", () => {
    // A millisecond value read as seconds lands in the year 33,000 and sorts after everything,
    // which reads as a gap rather than as an error.
    expect(parseTime("1780000000")).toBe(1_780_000_000);
    expect(parseTime("1780000000000")).toBe(1_780_000_000);
  });

  it("reads ISO 8601", () => {
    expect(parseTime("2026-08-06T09:15:00Z")).toBe(Math.floor(Date.parse("2026-08-06T09:15:00Z") / 1000));
  });

  it("reads `YYYY-MM-DD HH:MM:SS` as UTC rather than local", () => {
    // Not ISO 8601 (no `T`), and runtimes disagree on whether it is local or UTC. Pinned so an
    // import is not timezone-dependent — the same file must produce the same bars everywhere.
    expect(parseTime("2026-08-06 09:15:00")).toBe(Date.parse("2026-08-06T09:15:00Z") / 1000);
    expect(parseTime("2026-08-06 09:15")).toBe(Date.parse("2026-08-06T09:15:00Z") / 1000);
  });

  it("returns null for an unparseable date rather than guessing", () => {
    expect(parseTime("not a date")).toBeNull();
    expect(parseTime("")).toBeNull();
  });
});

describe("field handling", () => {
  it("honours quoted fields containing commas", () => {
    const csv = 'symbol,Date,Open,High,Low,Close\n"TATA MOTORS, LTD",1780000000,1,2,0.5,1.5';
    expect(parseCandleCsv(csv, OPTIONS).rows[0]?.ticker).toBe("TATA MOTORS, LTD");
  });

  it("strips thousands separators", () => {
    const csv = 'Date,Open,High,Low,Close,Volume\n1780000000,1,2,0.5,1.5,"1,234,567"';
    expect(parseCandleCsv(csv, OPTIONS).rows[0]?.volume).toBe(1_234_567);
  });

  it("leaves a malformed cell undefined so the importer rejects and explains the row", () => {
    const csv = "Date,Open,High,Low,Close\n1780000000,abc,2,0.5,1.5";
    const parsed = parseCandleCsv(csv, OPTIONS);
    expect(parsed.rows[0]?.open).toBeUndefined();

    const declaration: DatasetDeclaration = {
      source: "kaggle:test/x",
      license: "CC0",
      adjustment: "raw",
      includesDelisted: true,
      resolution: "1",
    };
    const report = importCandles(parsed.rows, declaration);
    expect(report.rejected[0]?.code).toBe("NON_FINITE");
  });

  it("refuses a file with no data rows", () => {
    expect(parseCandleCsv("Date,Open,High,Low,Close", OPTIONS).error).toMatch(/no data rows/);
  });
});

describe("parse and import compose", () => {
  it("turns a realistic Kaggle-shaped file into stored-ready candles", () => {
    const csv = [
      "Datetime,Symbol,Open,High,Low,Close,Volume",
      "2026-08-06 09:15:00,IN:XNSE:RELIANCE,1330.0,1335.5,1329.0,1334.2,120000",
      "2026-08-06 09:16:00,IN:XNSE:RELIANCE,1334.2,1336.0,1333.1,1335.0,98000",
    ].join("\n");

    const parsed = parseCandleCsv(csv, { resolution: "1" });
    expect(parsed.error).toBeNull();

    const report = importCandles(parsed.rows, {
      source: "kaggle:example/nse-intraday",
      license: "CC0-1.0",
      adjustment: "raw",
      includesDelisted: true,
      resolution: "1",
    });
    expect(report.accepted).toHaveLength(2);
    expect(report.rejected).toHaveLength(0);
    expect(report.unfitForValidation).toBeNull();
  });
});
