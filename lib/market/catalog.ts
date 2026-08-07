import type { AssetType, Exchange, Instrument, Market } from "./types";

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

  instrument({ market: "IN", exchange: "XNSE", symbol: "RELIANCE", name: "Reliance Industries" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "TCS", name: "Tata Consultancy Services" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "HDFCBANK", name: "HDFC Bank" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "ICICIBANK", name: "ICICI Bank" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "INFY", name: "Infosys" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "BHARTIARTL", name: "Bharti Airtel" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "SBIN", name: "State Bank of India" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "ITC", name: "ITC" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "LT", name: "Larsen & Toubro" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "HINDUNILVR", name: "Hindustan Unilever" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "BAJFINANCE", name: "Bajaj Finance" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "KOTAKBANK", name: "Kotak Mahindra Bank" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "MARUTI", name: "Maruti Suzuki India" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "SUNPHARMA", name: "Sun Pharmaceutical" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "AXISBANK", name: "Axis Bank" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "TATAMOTORS", name: "Tata Motors" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "TITAN", name: "Titan Company" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "ULTRACEMCO", name: "UltraTech Cement" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "NTPC", name: "NTPC" }),
  instrument({ market: "IN", exchange: "XNSE", symbol: "NIFTYBEES", name: "Nippon India ETF Nifty 50", assetType: "ETF" }),

  instrument({ market: "IN", exchange: "XBOM", symbol: "500325", name: "Reliance Industries" }),
  instrument({ market: "IN", exchange: "XBOM", symbol: "532540", name: "Tata Consultancy Services" }),
  instrument({ market: "IN", exchange: "XBOM", symbol: "500180", name: "HDFC Bank" }),
  instrument({ market: "IN", exchange: "XBOM", symbol: "532174", name: "ICICI Bank" }),
  instrument({ market: "IN", exchange: "XBOM", symbol: "500209", name: "Infosys" }),
  instrument({ market: "IN", exchange: "XBOM", symbol: "500875", name: "ITC" }),
  instrument({ market: "IN", exchange: "XBOM", symbol: "500112", name: "State Bank of India" }),
  instrument({ market: "IN", exchange: "XBOM", symbol: "500510", name: "Larsen & Toubro" }),
  instrument({ market: "IN", exchange: "XBOM", symbol: "500696", name: "Hindustan Unilever" }),
  instrument({ market: "IN", exchange: "XBOM", symbol: "500820", name: "Asian Paints" }),
]);

export function searchInstruments(query: string, exchange?: Exchange): Instrument[] {
  const normalized = query.trim().toUpperCase();
  return INSTRUMENT_CATALOG.filter((item) => {
    if (exchange && item.exchange !== exchange) return false;
    return (
      !normalized ||
      item.id.includes(normalized) ||
      item.symbol.includes(normalized) ||
      item.providerSymbol.includes(normalized) ||
      item.name.toUpperCase().includes(normalized)
    );
  }).slice(0, 25);
}
