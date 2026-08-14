import type { AssetType, Exchange, Instrument, Market } from "./types";
import { findNseInstrument, listCurrentNseInstruments, searchCurrentNseInstruments } from "./security-master";

type CatalogInput = {
  market: Market;
  exchange: Exchange;
  symbol: string;
  name: string;
  assetType?: AssetType;
};

function instrument(input: CatalogInput): Instrument {
  const india = input.market === "IN";
  return Object.freeze({
    id: `${input.market}:${input.exchange}:${input.symbol}`,
    market: input.market,
    exchange: input.exchange,
    symbol: input.symbol,
    providerSymbol:
      input.exchange === "XNSE"
        ? `${input.symbol}.NS`
        : input.exchange === "XBOM"
          ? `${input.symbol}.BO`
          : input.symbol,
    name: input.name,
    currency: india ? "INR" : "USD",
    timezone: india ? "Asia/Kolkata" : "America/New_York",
    assetType: input.assetType ?? "EQUITY",
  });
}

export const INSTRUMENT_CATALOG: readonly Instrument[] = Object.freeze([
  instrument({ market: "US", exchange: "XNAS", symbol: "AAPL", name: "Apple" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "MSFT", name: "Microsoft" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "NVDA", name: "NVIDIA" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "GOOGL", name: "Alphabet Class A" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "META", name: "Meta Platforms" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "AMZN", name: "Amazon" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "TSLA", name: "Tesla" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "AMD", name: "Advanced Micro Devices" }),
  // On the default watchlist but absent from the catalog, so `/analyze/PLTR` and `/analyze/CRM`
  // resolved to nothing. A watchlist row the catalog cannot resolve is a link that invites the
  // click and then fails — worse than no link. Palantir moved to NASDAQ in November 2024.
  instrument({ market: "US", exchange: "XNAS", symbol: "PLTR", name: "Palantir Technologies" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "AVGO", name: "Broadcom" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "NFLX", name: "Netflix" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "COST", name: "Costco Wholesale" }),
  instrument({ market: "US", exchange: "XNAS", symbol: "QQQ", name: "Invesco QQQ", assetType: "ETF" }),
  instrument({ market: "US", exchange: "XNYS", symbol: "JPM", name: "JPMorgan Chase" }),
  instrument({ market: "US", exchange: "XNYS", symbol: "XOM", name: "Exxon Mobil" }),
  instrument({ market: "US", exchange: "XNYS", symbol: "JNJ", name: "Johnson & Johnson" }),
  instrument({ market: "US", exchange: "XNYS", symbol: "V", name: "Visa" }),
  instrument({ market: "US", exchange: "XNYS", symbol: "CRM", name: "Salesforce" }),
  instrument({ market: "US", exchange: "XNYS", symbol: "DIS", name: "Walt Disney" }),
  instrument({ market: "US", exchange: "XNYS", symbol: "BA", name: "Boeing" }),
  instrument({ market: "US", exchange: "XNYS", symbol: "BRK-B", name: "Berkshire Hathaway Class B" }),
  instrument({ market: "US", exchange: "XNYS", symbol: "SPY", name: "SPDR S&P 500 ETF", assetType: "ETF" }),

  // NSE instruments — exchange = XNSE (not XBOM/BSE). Symbol = NSE ticker (not BSE script code).
  // Canonical identity uses instrument_key from NSE, not recyclable exchange tokens.
  instrument({ market: "IN", exchange: "XNSE", symbol: "RELIANCE", name: "Reliance Industries" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "TCS", name: "Tata Consultancy Services" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "HDFCBANK", name: "HDFC Bank" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "ICICIBANK", name: "ICICI Bank" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "INFY", name: "Infosys" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "ITC", name: "ITC" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "SBIN", name: "State Bank of India" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "LT", name: "Larsen & Toubro" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "HINDUNILVR", name: "Hindustan Unilever" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "ASIANPAINT", name: "Asian Paints" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "TATAMOTORS", name: "Tata Motors" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "SUNPHARMA", name: "Sun Pharmaceutical" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "TATASTEEL", name: "Tata Steel" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "WIPRO", name: "Wipro" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "MARUTI", name: "Maruti Suzuki" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "TITAN", name: "Titan Company" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "BAJFINANCE", name: "Bajaj Finance" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "HCLTECH", name: "HCL Technologies" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "POWERGRID", name: "Power Grid Corporation" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "BHARTIARTL", name: "Bharti Airtel" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "GAIL", name: "GAIL India" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "SIEMENS", name: "Siemens India" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "AMBUJACEM", name: "Ambuja Cements" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "DABUR", name: "Dabur India" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "COLPAL", name: "Colgate Palmolive" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "BERGEPAINT", name: "Berger Paints" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "CHAMBLFERT", name: "Chambal Fertilizers" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "BECTORFOOD", name: "MRS Bectors Food" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "JYOTHYLAB", name: "Jyothy Labs" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "MCDOWELL-N", name: "United Spirits" }),
  // NIFTYBEES is deliberately OUTSIDE the 30-security acceptance universe. It is the regime
  // benchmark used by the learning cycle and ticker tape, so it must stay resolvable even when
  // the security master is unavailable — but it is not an acceptance instrument.
  instrument({ market: "IN", exchange: "XNSE", symbol: "NIFTYBEES", name: "Nippon India Nifty BeES", assetType: "ETF" }),
]);

/**
 * The pinned 30-security NSE acceptance universe (P0 FINAL PROOF).
 *
 * Exactly 30 unique canonical XNSE securities, stratified by market cap and sector, matching the
 * acceptance matrix in `e2e/nse-30-stock-matrix.spec.ts`. This is a SOURCE-CONTROLLED snapshot:
 * it never depends on the live NSE master being reachable, and the acceptance threshold is never
 * lowered to match what happens to be available.
 */
export const NSE_ACCEPTANCE_UNIVERSE: readonly string[] = Object.freeze([
  // Large cap (high liquidity)
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "INFY",
  "ICICIBANK",
  "HINDUNILVR",
  "SBIN",
  "BHARTIARTL",
  "ITC",
  "LT",
  // Mid cap (medium liquidity)
  "TATAMOTORS",
  "SUNPHARMA",
  "TATASTEEL",
  "WIPRO",
  "ASIANPAINT",
  "MARUTI",
  "TITAN",
  "BAJFINANCE",
  "HCLTECH",
  "POWERGRID",
  // Smaller / less followed (but valid NSE equities)
  "BECTORFOOD",
  "JYOTHYLAB",
  "CHAMBLFERT",
  "GAIL",
  "SIEMENS",
  "AMBUJACEM",
  "BERGEPAINT",
  "DABUR",
  "COLPAL",
  "MCDOWELL-N",
]);

export function searchInstruments(query: string, exchange?: Exchange): Instrument[] {
  const normalized = query.trim().toUpperCase();
  const staticMatches = INSTRUMENT_CATALOG.filter((item) => {
    if (exchange && item.exchange !== exchange) return false;
    return (
      !normalized ||
      item.id.includes(normalized) ||
      item.symbol.includes(normalized) ||
      item.providerSymbol.includes(normalized) ||
      item.name.toUpperCase().includes(normalized)
    );
  });
  const nseMatches = !exchange || exchange === "XNSE"
    ? searchCurrentNseInstruments(normalized, { limit: 25 }).items
    : [];
  // Master rows and static catalog rows can carry the same security (e.g. RELIANCE). The master
  // carries ISIN/series provenance, so it wins; the first occurrence per id is kept.
  const merged = normalized ? [...nseMatches, ...staticMatches] : [...staticMatches, ...nseMatches];
  const seen = new Set<string>();
  const unique = merged.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  // A bare query is a SEARCH and must stay bounded for the search UI. An empty query is a
  // LISTING: truncating it made the catalog look smaller than it is (the "25 instruments"
  // symptom) — the API pagination.total reports the true listing size instead.
  return normalized ? unique.slice(0, 25) : unique;
}

export function listCurrentInstruments(filters: { market?: Market; exchange?: Exchange } = {}): Instrument[] {
  const includeNse =
    (!filters.market || filters.market === "IN") && (!filters.exchange || filters.exchange === "XNSE");
  const current = [
    ...INSTRUMENT_CATALOG,
    ...(includeNse ? listCurrentNseInstruments() : []),
  ];
  return current.filter(
    (instrument) =>
      (!filters.market || instrument.market === filters.market) &&
      (!filters.exchange || instrument.exchange === filters.exchange),
  );
}

export function findCurrentInstrument(identity: string): Instrument | null {
  const normalized = identity.trim().toUpperCase();
  return (
    findNseInstrument(normalized) ??
    INSTRUMENT_CATALOG.find(
      (instrument) =>
        instrument.id === normalized ||
        instrument.symbol === normalized ||
        instrument.providerSymbol === normalized,
    ) ??
    null
  );
}
