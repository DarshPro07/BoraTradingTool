import { INSTRUMENT_CATALOG } from "./catalog";
import type { Exchange, Instrument, Market } from "./types";

const CANONICAL_PATTERN = /^(US|IN):(XNAS|XNYS|XNSE|XBOM):([A-Z0-9][A-Z0-9.-]{0,19})$/;
const PROVIDER_PATTERN = /^([A-Z0-9][A-Z0-9.-]{0,19})\.(NS|BO)$/;

export class InstrumentError extends Error {
  readonly code = "INVALID_INSTRUMENT";

  constructor(message: string) {
    super(message);
    this.name = "InstrumentError";
  }
}

function isValidMarketExchange(market: Market, exchange: Exchange): boolean {
  return market === "US" ? exchange === "XNAS" || exchange === "XNYS" : exchange === "XNSE" || exchange === "XBOM";
}

function buildExplicit(market: Market, exchange: Exchange, symbol: string): Instrument {
  const catalog = INSTRUMENT_CATALOG.find(
    (item) => item.market === market && item.exchange === exchange && item.symbol === symbol,
  );
  if (catalog) return catalog;
  const india = market === "IN";
  return {
    id: `${market}:${exchange}:${symbol}`,
    market,
    exchange,
    symbol,
    providerSymbol: exchange === "XNSE" ? `${symbol}.NS` : exchange === "XBOM" ? `${symbol}.BO` : symbol,
    name: symbol,
    currency: india ? "INR" : "USD",
    timezone: india ? "Asia/Kolkata" : "America/New_York",
    assetType: "EQUITY",
  };
}

export function parseInstrument(raw: string): Instrument {
  if (typeof raw !== "string" || raw.length > 64 || /[\0\r\n\\/]/.test(raw)) {
    throw new InstrumentError("Instrument contains an invalid character or length.");
  }
  const value = raw.trim().toUpperCase();
  const canonical = CANONICAL_PATTERN.exec(value);
  if (canonical) {
    const market = canonical[1] as Market;
    const exchange = canonical[2] as Exchange;
    const symbol = canonical[3];
    if (!isValidMarketExchange(market, exchange)) {
      throw new InstrumentError("Market and exchange do not match.");
    }
    return buildExplicit(market, exchange, symbol);
  }

  const provider = PROVIDER_PATTERN.exec(value);
  if (provider) {
    return buildExplicit("IN", provider[2] === "NS" ? "XNSE" : "XBOM", provider[1]);
  }

  const catalog = INSTRUMENT_CATALOG.filter(
    (item) => item.symbol === value || item.providerSymbol === value,
  );
  if (catalog.length === 1) return catalog[0];
  if (catalog.length > 1) {
    throw new InstrumentError("Symbol is ambiguous; use a canonical instrument ID.");
  }
  throw new InstrumentError("Unknown bare symbol; use a canonical instrument ID with exchange.");
}

export function formatInstrumentId(instrument: Pick<Instrument, "market" | "exchange" | "symbol">): string {
  return `${instrument.market}:${instrument.exchange}:${instrument.symbol}`;
}

export function tryParseInstrument(raw: string): Instrument | null {
  try {
    return parseInstrument(raw);
  } catch {
    return null;
  }
}
