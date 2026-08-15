export type Market = "US" | "IN";
export type Exchange = "XNAS" | "XNYS" | "XNSE" | "XBOM";
export type Currency = "USD" | "INR";
export type AssetType = "EQUITY" | "ETF" | "REIT" | "INVIT";
export type NseAssetType = AssetType;
export type ListingStatus = "LISTED" | "SUSPENDED" | "DELISTED" | "INACTIVE";
export type DataAvailability = "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
export type DataQuality =
  | "LIVE"
  | "DELAYED"
  | "STALE"
  | "CONFLICTED"
  | "UNAVAILABLE"
  | "AUTH_REQUIRED"
  /**
   * Deterministic test data. NOT a market observation of any kind.
   *
   * This exists because `fixtureQuote` used to stamp itself `quality: "LIVE"`. In
   * `MARKETPULSE_TEST_MODE=1` every NSE instrument outside a three-entry price table was served at
   * ₹1,000 with `changePct: 0.5` and `volume: 1_500_000` — and the dashboard rendered those
   * fabricated numbers with no indication they were fabricated, because "LIVE" is exactly what
   * real data says. That is the owner-reported defect: many stocks near ₹1,000 with identical
   * changes, and sector tiles all showing the same figure because they were averaged from them.
   *
   * A value that was invented must never be able to describe itself as live. Anything rendering a
   * quote can now ask one question — is this FIXTURE — and say so.
   */
  | "FIXTURE";

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
  /** Durable exchange-issued security identity. Present for security-master records. */
  securityId?: string;
  isin?: string;
  series?: string;
  listingStatus?: ListingStatus;
  dataAvailability?: DataAvailability;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

export interface Provenance {
  provider: "YAHOO" | "FINNHUB" | "INDIAN_API" | "TEST_FIXTURE";
  sourceEventAt: string | null;
  ingestedAt: string;
  quality: DataQuality;
  delayedBySeconds: number | null;
  sourceId: string;
  /**
   * Whether the PROVIDER stated which instrument it served, and whether that matched the request
   * (`lib/market/identity-guard.ts`). A stated mismatch never reaches here — it throws before any
   * bar is built — so this distinguishes "verified" from "the source claimed no identity".
   * Undefined for sources that predate the check.
   */
  identityVerdict?: "MATCHED" | "UNSTATED";
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
