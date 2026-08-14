import { ingestNseInstrument, type IngestionResult } from "./nse-connector";
import { loadStoredCandles, type StoredCoverage } from "./candle-store";
import { snapshotFromStore } from "@/lib/research-data/snapshot";

/**
 * DataConnector — the interface for all market data sources.
 *
 * Architecture: Provider → DataConnector → Canonical Store → Dataset Snapshot → Research/Backtest
 *
 * Each connector normalizes data into the canonical store format.
 */

export type DataProviderId = "yahoo" | "jugaad" | "nse-official" | "broker" | "alpha-vantage";

export interface DataConnector {
  id: DataProviderId;
  displayName: string;
  ingest(instrumentId: string, resolution: string): Promise<IngestionResult>;
}

export interface DataReadiness {
  instrumentId: string;
  status: "READY" | "PARTIAL" | "MISSING" | "STALE" | "INGESTION_PENDING";
  coverage: StoredCoverage[];
  message: string;
}

/**
 * Check data readiness for an instrument.
 */
export function checkReadiness(instrumentId: string): DataReadiness {
  const coverage = getCoverage(instrumentId);
  const daily = coverage.find((c) => c.resolution === "D");

  if (!daily || daily.bars === 0) {
    return {
      instrumentId,
      status: "MISSING",
      coverage,
      message: `No data for ${instrumentId}. Ingestion required.`,
    };
  }

  if (daily.bars < 60) {
    return {
      instrumentId,
      status: "PARTIAL",
      coverage,
      message: `Only ${daily.bars} daily bars for ${instrumentId}. Need 60+ for research.`,
    };
  }

  return {
    instrumentId,
    status: "READY",
    coverage,
    message: `${daily.bars} daily bars available for ${instrumentId}.`,
  };
}

function getCoverage(instrumentId: string): StoredCoverage[] {
  // Imported from candle-store.
  const { storedCoverage } = require("./candle-store");
  return storedCoverage(instrumentId);
}

/**
 * Get a data connector by ID.
 */
export function getDataConnector(id: DataProviderId): DataConnector {
  switch (id) {
    case "yahoo":
      return {
        id: "yahoo",
        displayName: "Yahoo Finance",
        ingest: (instrumentId, resolution) =>
          ingestNseInstrument(instrumentId, resolution as "D"),
      };
    default:
      throw new Error(`Data connector '${id}' not implemented.`);
  }
}
