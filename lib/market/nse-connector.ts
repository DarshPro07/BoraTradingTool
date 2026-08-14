import { getYahooCandles } from "@/lib/providers/yahoo";
import { persistCandles, storedCoverage, type StoredCoverage } from "./candle-store";
import type { ImportedCandle } from "./dataset-import";

/**
 * NSE Data Connector — fetches historical bars from Yahoo Finance and stores in the canonical store.
 *
 * IMPORTANT: Yahoo is a RESEARCH/EDUCATIONAL fallback, NOT the canonical identity source.
 * Canonical identity comes from NSE official data (see canonical-identity.ts).
 *
 * Architecture:
 *   NSE OFFICIAL MASTER → Canonical Instrument → Provider Mapping (Yahoo) → Ingestion → Canonical Store
 *
 * Yahoo uses ".NS" suffix for NSE instruments (e.g., "RELIANCE.NS").
 */

export interface IngestionResult {
  ok: boolean;
  instrumentId: string;
  symbol: string;
  barsIngested: number;
  coverage: StoredCoverage;
  reason?: string;
}

/** Map internal instrument ID to Yahoo ticker. */
function toYahooTicker(instrumentId: string): string {
  // IN:XNSE:RELIANCE → RELIANCE.NS
  const symbol = instrumentId.split(":").pop() ?? instrumentId;
  if (instrumentId.startsWith("IN:XNSE:")) return `${symbol}.NS`;
  if (instrumentId.startsWith("IN:XBOM:")) return `${symbol}.BO`;
  return symbol;
}

/**
 * Ingest daily bars for an NSE instrument from Yahoo.
 * Fetches up to 5 years of daily history.
 */
export async function ingestNseInstrument(
  instrumentId: string,
  resolution: "D" = "D",
): Promise<IngestionResult> {
  const symbol = toYahooTicker(instrumentId);
  const now = Math.floor(Date.now() / 1000);
  const fiveYearsAgo = now - 5 * 365 * 24 * 60 * 60;

  try {
    const bars = await getYahooCandles(symbol, resolution, fiveYearsAgo, now);

    if (bars.length === 0) {
      return {
        ok: false,
        instrumentId,
        symbol,
        barsIngested: 0,
        coverage: { ticker: instrumentId, resolution, bars: 0, firstTime: null, lastTime: null },
        reason: "No bars returned from Yahoo.",
      };
    }

    // Convert to ImportedCandle format and store in canonical store.
    const imported: ImportedCandle[] = bars.map((bar) => ({
      ticker: instrumentId,
      resolution,
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume ?? null,
    }));

    const result = persistCandles(imported);

    const coverage = storedCoverage(instrumentId).find((c) => c.resolution === resolution);

    return {
      ok: true,
      instrumentId,
      symbol,
      barsIngested: result.inserted,
      coverage: coverage ?? { ticker: instrumentId, resolution, bars: 0, firstTime: null, lastTime: null },
    };
  } catch (error) {
    return {
      ok: false,
      instrumentId,
      symbol,
      barsIngested: 0,
      coverage: { ticker: instrumentId, resolution, bars: 0, firstTime: null, lastTime: null },
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Ingest multiple NSE instruments.
 */
export async function ingestNseInstruments(
  instrumentIds: string[],
  resolution: "D" = "D",
): Promise<IngestionResult[]> {
  const results: IngestionResult[] = [];
  for (const id of instrumentIds) {
    results.push(await ingestNseInstrument(id, resolution));
  }
  return results;
}
