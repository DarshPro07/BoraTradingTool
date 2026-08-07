export type Market = "US" | "IN";
export type Exchange = "XNAS" | "XNYS" | "XNSE" | "XBOM";
export type Currency = "USD" | "INR";
export type AssetType = "EQUITY" | "ETF";
export type DataQuality =
  | "LIVE"
  | "DELAYED"
  | "STALE"
  | "CONFLICTED"
  | "UNAVAILABLE"
  | "AUTH_REQUIRED";

export interface Instrument {
  id: string;
  market: Market;
  exchange: Exchange;
  symbol: string;
  providerSymbol: string;
  name: string;
  currency: Currency;
  timezone: "America/New_York" | "Asia/Kolkata";
  assetType: AssetType;
}

export interface Provenance {
  provider: "YAHOO" | "FINNHUB" | "INDIAN_API" | "TEST_FIXTURE";
  sourceEventAt: string | null;
  ingestedAt: string;
  quality: DataQuality;
  delayedBySeconds: number | null;
  sourceId: string;
}

export interface NormalizedQuote {
  instrument: Instrument;
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  currency: Currency;
  provenance: Provenance;
}

export interface NormalizedCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NormalizedCandles {
  instrument: Instrument;
  resolution: string;
  candles: NormalizedCandle[];
  provenance: Provenance;
}
