import type {
  DataProvider,
  Quote,
  Candle,
  NewsItem,
  CompanyProfile,
  Fundamentals,
  AnalystRating,
  PriceTarget,
  EarningsRecord,
  InsiderTransaction,
  SectorPerformance,
  MarketMover,
  CandleResolution,
} from "./types";
import { scoreSentiment } from "@/lib/data/sentiment";

const BASE_URL = "https://finnhub.io/api/v1";

export class FinnhubProvider implements DataProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // No `next: { revalidate }` here, and not merely because it fails a strict typecheck —
    // `RequestInit` has no such field, so `tsc` was right to reject it.
    //
    // Every production construction of this provider goes through `getProvider()`, which wraps it
    // in `CachingProvider` with per-method TTLs and single-flight. A 60-second Next fetch cache
    // underneath that made the app's own 15-second quote TTL untrue: the cache would expire, ask
    // again, and be handed back data up to a minute old with no indication it was stale. One
    // cache that states its age beats two that disagree about it.
    const res = await fetch(url.toString(), {
      headers: { "X-Finnhub-Token": this.apiKey },
    });
    if (!res.ok) throw new Error(`Finnhub ${path} → ${res.status}`);
    return res.json();
  }

  async getQuote(ticker: string): Promise<Quote> {
    const data = await this.fetch<{
      c: number; o: number; h: number; l: number; pc: number; d: number; dp: number; v: number;
    }>("/quote", { symbol: ticker });
    return {
      ticker,
      price: data.c,
      open: data.o,
      high: data.h,
      low: data.l,
      prevClose: data.pc,
      change: data.d,
      changePct: data.dp,
      volume: data.v,
      avgVolume: data.v, // Finnhub free tier doesn't separate avg volume
      fetchedAt: new Date(),
      mock: false,
    };
  }

  async getCandles(ticker: string, resolution: CandleResolution, from: number, to: number): Promise<Candle[]> {
    const data = await this.fetch<{
      c: number[]; h: number[]; l: number[]; o: number[]; t: number[]; v: number[]; s: string;
    }>("/stock/candle", { symbol: ticker, resolution, from: String(from), to: String(to) });
    if (data.s !== "ok" || !data.t) throw new Error(`Finnhub candles: no_data for ${ticker}`);
    return data.t.map((time, i) => ({
      time,
      open: data.o[i],
      high: data.h[i],
      low: data.l[i],
      close: data.c[i],
      volume: data.v[i],
    }));
  }

  async getNews(ticker?: string, limit = 20): Promise<NewsItem[]> {
    const to = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 7 * 86400 * 1000).toISOString().split("T")[0];

    const items = ticker
      ? await this.fetch<Array<{ id: number; headline: string; summary: string; source: string; url: string; sentiment?: number; datetime: number }>>(
          "/company-news",
          { symbol: ticker, from, to }
        )
      : await this.fetch<Array<{ id: number; headline: string; summary: string; source: string; url: string; sentiment?: number; datetime: number }>>(
          "/news",
          { category: "general" }
        );

    return items.slice(0, limit).map((item) => ({
      id: String(item.id),
      ticker,
      headline: item.headline,
      summary: item.summary ?? "",
      source: item.source,
      url: item.url,
      // Finnhub's news API returns no sentiment field, so derive one from the
      // text instead of defaulting every article to neutral.
      sentiment: item.sentiment ?? scoreSentiment(item.headline, item.summary),
      publishedAt: new Date(item.datetime * 1000),
    }));
  }

  async getCompanyProfile(ticker: string): Promise<CompanyProfile> {
    const data = await this.fetch<{
      name: string; exchange: string; finnhubIndustry: string; logo: string; weburl: string; marketCapitalization: number;
    }>("/stock/profile2", { symbol: ticker });
    return {
      ticker,
      name: data.name,
      exchange: data.exchange,
      sector: data.finnhubIndustry ?? "",
      industry: data.finnhubIndustry ?? "",
      marketCap: (data.marketCapitalization ?? 0) * 1e6,
      logo: data.logo,
      webUrl: data.weburl,
    };
  }

  async getFundamentals(ticker: string): Promise<Fundamentals> {
    const data = await this.fetch<{ metric: Record<string, number> }>("/stock/metric", { symbol: ticker, metric: "all" });
    const m = data.metric ?? {};
    return {
      pe: m["peNormalizedAnnual"] ?? null,
      eps: m["epsNormalizedAnnual"] ?? null,
      revenue: m["revenuePerShareAnnual"] ?? null,
      revenueGrowth: m["revenueGrowthAnnual"] ?? null,
      grossMargin: m["grossMarginAnnual"] ?? null,
      netMargin: m["netProfitMarginAnnual"] ?? null,
      debtToEquity: m["totalDebt/totalEquityAnnual"] ?? null,
      freeCashFlow: m["freeCashFlowAnnual"] ?? null,
      bookValue: m["bookValuePerShareAnnual"] ?? null,
      dividendYield: m["dividendYieldIndicatedAnnual"] ?? null,
      beta: m["beta"] ?? null,
      fiftyTwoWeekHigh: m["52WeekHigh"] ?? null,
      fiftyTwoWeekLow: m["52WeekLow"] ?? null,
    };
  }

  async getAnalystRatings(ticker: string): Promise<AnalystRating[]> {
    const data = await this.fetch<Array<{ buy: number; hold: number; sell: number; strongBuy: number; strongSell: number; period: string }>>(
      "/stock/recommendation",
      { symbol: ticker }
    );
    return data.map((r) => ({
      buy: r.buy,
      hold: r.hold,
      sell: r.sell,
      strongBuy: r.strongBuy,
      strongSell: r.strongSell,
      period: r.period,
    }));
  }

  async getPriceTarget(ticker: string): Promise<PriceTarget> {
    const data = await this.fetch<{ targetHigh: number; targetLow: number; targetMean: number; targetMedian: number }>(
      "/stock/price-target",
      { symbol: ticker }
    );
    return {
      high: data.targetHigh,
      low: data.targetLow,
      mean: data.targetMean,
      median: data.targetMedian,
    };
  }

  async getEarnings(ticker: string): Promise<EarningsRecord[]> {
    const data = await this.fetch<Array<{ period: string; actual: number | null; estimate: number | null; surprise: number | null; surprisePercent: number | null }>>(
      "/stock/earnings",
      { symbol: ticker }
    );
    return data.map((e) => ({
      period: e.period,
      actual: e.actual,
      estimate: e.estimate,
      surprise: e.surprise,
      surprisePct: e.surprisePercent,
    }));
  }

  async getInsiderTransactions(ticker: string): Promise<InsiderTransaction[]> {
    const data = await this.fetch<{ data: Array<{ name: string; share: number; change: number; filingDate: string; transactionDate: string; transactionCode: string; transactionPrice: number | null }> }>(
      "/stock/insider-transactions",
      { symbol: ticker }
    );
    return (data.data ?? []).slice(0, 20).map((t) => ({
      name: t.name,
      share: t.share,
      change: t.change,
      filingDate: t.filingDate,
      transactionDate: t.transactionDate,
      transactionCode: t.transactionCode,
      transactionPrice: t.transactionPrice,
    }));
  }

  async getSectorPerformance(): Promise<SectorPerformance[]> {
    // Finnhub doesn't have a direct sector performance endpoint on free tier
    // Use market news sentiment as a proxy — return static fallback
    return [
      { sector: "Technology", changePct: 0 },
      { sector: "Healthcare", changePct: 0 },
      { sector: "Financials", changePct: 0 },
      { sector: "Energy", changePct: 0 },
      { sector: "Consumer Discretionary", changePct: 0 },
      { sector: "Industrials", changePct: 0 },
      { sector: "Materials", changePct: 0 },
      { sector: "Utilities", changePct: 0 },
      { sector: "Real Estate", changePct: 0 },
      { sector: "Communication Services", changePct: 0 },
      { sector: "Consumer Staples", changePct: 0 },
    ];
  }

  async getTopMovers(): Promise<{ gainers: MarketMover[]; losers: MarketMover[] }> {
    // Finnhub free tier doesn't have top movers — return empty to fall back to mock
    return { gainers: [], losers: [] };
  }
}
