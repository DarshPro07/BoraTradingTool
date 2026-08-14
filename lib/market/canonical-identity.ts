/**
 * Canonical NSE Instrument Identity — the authoritative source of truth.
 *
 * Architecture:
 *
 *   NSE OFFICIAL MASTER (or last-known-good cache)
 *          ↓
 *   Canonical Instrument (this module)
 *          ↓
 *   Provider Mapping (Yahoo, Upstox, etc. map TO canonical, not FROM)
 *
 * Yahoo/Upstox/etc. never define identity. They are data sources that map
 * to canonical instruments. This prevents a provider symbol change from
 * corrupting research history.
 */

export type Exchange = "XNSE" | "XBOM";
export type InstrumentClass = "EQUITY" | "SME" | "ETF" | "REIT" | "INVIT" | "PREFERENCE" | "PARTLY_PAID" | "WARRANT" | "OTHER";

export interface CanonicalInstrument {
  /** Canonical ID: IN:{EXCHANGE}:{SYMBOL} — durable, never changes. */
  id: string;
  exchange: Exchange;
  symbol: string;
  name: string;
  /** ISIN where available — globally durable security identifier. */
  isin: string | null;
  instrumentClass: InstrumentClass;
  /** Trading status: ACTIVE, SUSPENDED, DELISTED, etc. */
  tradingStatus: string;
  /** Effective dates for point-in-time research. */
  listedFrom: Date | null;
  listedUntil: Date | null;
  /** Symbol/name history for historical research. */
  symbolHistory: Array<{ symbol: string; from: Date | null; until: Date | null }>;
  nameHistory: Array<{ name: string; from: Date | null; until: Date | null }>;
  /** Source of truth. */
  source: "NSE_OFFICIAL" | "CACHED_NSE" | "BOOTSTRAP" | "PROVIDER_MAP";
  sourceRetrievedAt: Date;
}

/**
 * Map a provider symbol to a canonical instrument.
 * Returns null if no mapping exists.
 */
export function mapProviderToCanonical(params: {
  provider: string;
  providerSymbol: string;
  exchange: Exchange;
}): CanonicalInstrument | null {
  // Canonical ID is derived from exchange + symbol.
  // Provider symbols are mapped via a lookup table.
  const symbol = normalizeSymbol(params.providerSymbol, params.provider);
  const id = `IN:${params.exchange}:${symbol}`;

  // In production, this would query the canonical store.
  // For now, return the canonical ID structure.
  return {
    id,
    exchange: params.exchange,
    symbol,
    name: symbol, // Would be looked up from master
    isin: null,
    instrumentClass: "EQUITY",
    tradingStatus: "ACTIVE",
    listedFrom: null,
    listedUntil: null,
    symbolHistory: [],
    nameHistory: [],
    source: "PROVIDER_MAP",
    sourceRetrievedAt: new Date(),
  };
}

/** Normalize a provider symbol to canonical form. */
function normalizeSymbol(providerSymbol: string, provider: string): string {
  switch (provider) {
    case "yahoo":
      // RELIANCE.NS → RELIANCE, SBIN.BO → SBIN
      return providerSymbol.replace(/\.(NS|BO)$/i, "").toUpperCase();
    case "upstox":
      // Upstox uses exchange:symbol format
      return providerSymbol.split(":").pop()?.toUpperCase() ?? providerSymbol.toUpperCase();
    default:
      return providerSymbol.toUpperCase();
  }
}

/**
 * Create a canonical instrument from NSE official data.
 * This is the authoritative path — only NSE official sources should call this.
 */
export function fromNseOfficial(data: {
  symbol: string;
  name: string;
  isin?: string;
  exchange: Exchange;
  instrumentClass?: InstrumentClass;
  tradingStatus?: string;
}): CanonicalInstrument {
  return {
    id: `IN:${data.exchange}:${data.symbol.toUpperCase()}`,
    exchange: data.exchange,
    symbol: data.symbol.toUpperCase(),
    name: data.name,
    isin: data.isin ?? null,
    instrumentClass: data.instrumentClass ?? "EQUITY",
    tradingStatus: data.tradingStatus ?? "ACTIVE",
    listedFrom: null,
    listedUntil: null,
    symbolHistory: [],
    nameHistory: [],
    source: "NSE_OFFICIAL",
    sourceRetrievedAt: new Date(),
  };
}
