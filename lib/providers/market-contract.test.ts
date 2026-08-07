import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstrument } from "@/lib/market/instruments";
import { buildResearchSnapshot, getNormalizedCandles, getNormalizedQuote } from "@/lib/market/service";

const IDS = ["US:XNAS:AAPL", "IN:XNSE:RELIANCE", "IN:XBOM:500325"];

beforeEach(() => vi.stubEnv("MARKETPULSE_TEST_MODE", "1"));
afterEach(() => vi.unstubAllEnvs());

describe.each(IDS)("normalized provider contract for %s", (id) => {
  it("returns a valid quote with identity and provenance", async () => {
    const instrument = parseInstrument(id);
    const quote = await getNormalizedQuote(instrument);
    expect(quote.instrument.id).toBe(id);
    expect(quote.currency).toBe(instrument.currency);
    expect(quote.price).toBeGreaterThan(0);
    expect(quote.provenance).toMatchObject({ provider: "TEST_FIXTURE", quality: "LIVE" });
    expect(new Date(quote.provenance.ingestedAt).getTime()).not.toBeNaN();
  });

  it("returns finite ordered candles and a complete snapshot", async () => {
    const instrument = parseInstrument(id);
    const candles = await getNormalizedCandles(instrument);
    expect(candles.candles).toHaveLength(260);
    expect(candles.candles.every((candle) => Number.isFinite(candle.close) && candle.high >= candle.low)).toBe(true);
    const snapshot = await buildResearchSnapshot(instrument);
    expect(snapshot.instrument.id).toBe(id);
    expect(snapshot.snapshotId).toMatch(/^[a-f0-9]{64}$/);
  });
});
