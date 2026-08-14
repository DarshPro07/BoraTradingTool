export interface Quote {
  ticker: string;
  price: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  change: number;
  changePct: number;
  volume: number;
  avgVolume: number;
  fetchedAt: Date;
  sourceEventAt?: Date;
  provider?: "YAHOO" | "FINNHUB" | "TEST_FIXTURE";
  mock?: boolean; // true when this quote is simulated demo data, not a live price
  /** Full provenance chain — source, quality, freshness. */
  provenance?: {
    provider: string;
    // "FIXTURE" mirrors DataQuality in lib/market/types.ts: invented numbers must never be able to
    // describe themselves as LIVE, in either type.
    quality: "LIVE" | "DELAYED" | "STALE" | "CONFLICTED" | "UNAVAILABLE" | "AUTH_REQUIRED" | "FIXTURE";
    delayedBySeconds: number | null;
    sourceEventAt: string | null;
    ingestedAt: string;
    sourceId: string;
  };
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsItem {
  id: string;
  ticker?: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  sentiment: number; // -1 to 1
  publishedAt: Date;
}

export interface CompanyProfile {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  marketCap: number;
  logo?: string;
  webUrl?: string;
  description?: string;
}

export interface Fundamentals {
  pe: number | null;
  eps: number | null;
  revenue: number | null;
  revenueGrowth: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  debtToEquity: number | null;
  freeCashFlow: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export interface AnalystRating {
  buy: number;
  hold: number;
  sell: number;
  strongBuy: number;
  strongSell: number;
  period: string;
}

export interface PriceTarget {
  high: number;
  low: number;
  mean: number;
  median: number;
}

export interface EarningsRecord {
  period: string;
  actual: number | null;
  estimate: number | null;
  surprise: number | null;
  surprisePct: number | null;
}

export interface InsiderTransaction {
  name: string;
  share: number;
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionCode: string; // P = purchase, S = sale
  transactionPrice: number | null;
}

export interface SectorPerformance {
  sector: string;
  changePct: number;
}

export interface MarketMover {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
}

// Resolution: 1=1min, 5=5min, 15=15min, 30=30min, 60=60min, D=daily, W=weekly, M=monthly
export type CandleResolution = "1" | "5" | "15" | "30" | "60" | "D" | "W" | "M";

export interface DataProvider {
  getQuote(ticker: string): Promise<Quote>;
  getCandles(ticker: string, resolution: CandleResolution, from: number, to: number): Promise<Candle[]>;
  getNews(ticker?: string, limit?: number): Promise<NewsItem[]>;
  getCompanyProfile(ticker: string): Promise<CompanyProfile>;
  getFundamentals(ticker: string): Promise<Fundamentals>;
  getAnalystRatings(ticker: string): Promise<AnalystRating[]>;
  getPriceTarget(ticker: string): Promise<PriceTarget>;
  getEarnings(ticker: string): Promise<EarningsRecord[]>;
  getInsiderTransactions(ticker: string): Promise<InsiderTransaction[]>;
  getSectorPerformance(): Promise<SectorPerformance[]>;
  getTopMovers(): Promise<{ gainers: MarketMover[]; losers: MarketMover[] }>;
}
