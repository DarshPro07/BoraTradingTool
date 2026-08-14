import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { loadStoredCandles } from "@/lib/market/candle-store";
import { MIN_BARS_FOR_RESEARCH } from "@/lib/research/bridge";
import { ingestInstrumentHistory, instrumentReadiness } from "./ingest";

/**
 * In-product ingestion — the path that lets a fresh database stop refusing.
 *
 * The defect this guards: `researchInstrument` refuses an instrument with fewer than
 * MIN_BARS_FOR_RESEARCH stored bars, and the ONLY way to supply them was two CLI steps run
 * outside the application. On a fresh database every instrument therefore refused forever, which
 * blocked both 30-stock research breadth and the UI-first Golden Journey.
 *
 * These tests run in TEST_MODE so the provider chain returns deterministic fixture candles rather
 * than reaching the network — the ingestion logic under test is the validate/persist/report path,
 * not the upstream feed.
 */

const INSTRUMENT = "IN:XNSE:RELIANCE";

let previousTestMode: string | undefined;

beforeAll(() => {
  previousTestMode = process.env.MARKETPULSE_TEST_MODE;
  process.env.MARKETPULSE_TEST_MODE = "1";
});

afterAll(() => {
  // Restored rather than deleted: `delete env.X` and `X=undefined` are different states.
  if (previousTestMode === undefined) delete process.env.MARKETPULSE_TEST_MODE;
  else process.env.MARKETPULSE_TEST_MODE = previousTestMode;
});

describe("ingestInstrumentHistory", () => {
  useTemporaryDatabase();

  it("turns an un-researchable instrument into a researchable one", async () => {
    const before = instrumentReadiness(INSTRUMENT);
    expect(before.stored, "precondition: a fresh store holds no bars").toBe(0);
    expect(before.ready).toBe(false);
    expect(before.required).toBe(MIN_BARS_FOR_RESEARCH);

    const outcome = await ingestInstrumentHistory(INSTRUMENT);

    expect(outcome.ok).toBe(true);
    expect(outcome.code).toBe("INGESTED");
    expect(outcome.storedBefore).toBe(0);
    expect(outcome.storedAfter).toBeGreaterThanOrEqual(MIN_BARS_FOR_RESEARCH);
    expect(outcome.ready).toBe(true);
    expect(outcome.inserted).toBeGreaterThan(0);

    // The store, not just the report.
    expect(loadStoredCandles(INSTRUMENT, "D").length).toBeGreaterThanOrEqual(MIN_BARS_FOR_RESEARCH);
    expect(instrumentReadiness(INSTRUMENT).ready).toBe(true);
  });

  it("declares the sample unfit for validation — the declaration is the point of the import", async () => {
    const outcome = await ingestInstrumentHistory(INSTRUMENT);
    // Unadjusted prices and currently-listed symbols only. If this ever comes back null, ingested
    // bars would look promotable, which is precisely the laundering the import must not do.
    expect(outcome.unfitForValidation).toBeTruthy();
    expect(outcome.unfitForValidation).toMatch(/unadjusted|delisted/i);
    expect(outcome.message).toMatch(/unfit for validation/i);
  });

  it("is idempotent — a second ingest writes nothing and says so", async () => {
    const first = await ingestInstrumentHistory(INSTRUMENT);
    expect(first.code).toBe("INGESTED");

    const second = await ingestInstrumentHistory(INSTRUMENT);
    expect(second.code).toBe("ALREADY_READY");
    expect(second.ok).toBe(true);
    expect(second.ready).toBe(true);
    expect(second.inserted, "a repeat ingest must not duplicate bars").toBe(0);
    expect(second.storedAfter).toBe(second.storedBefore);
  });

  it("refuses an instrument it cannot resolve rather than inventing one", async () => {
    const outcome = await ingestInstrumentHistory("IN:XNSE:NOT-A-REAL-SYMBOL-ZZZ");
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("INSTRUMENT_UNKNOWN");
    expect(outcome.instrumentId).toBeNull();
    expect(outcome.storedAfter).toBe(0);
    expect(outcome.ready).toBe(false);
  });

  it("reports readiness for an unknown instrument without throwing", () => {
    const readiness = instrumentReadiness("IN:XNSE:NOT-A-REAL-SYMBOL-ZZZ");
    expect(readiness.instrumentId).toBeNull();
    expect(readiness.ready).toBe(false);
    expect(readiness.stored).toBe(0);
  });
});
