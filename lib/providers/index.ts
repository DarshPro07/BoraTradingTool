import type { DataProvider, CandleResolution, Candle, MarketMover } from "./types";
import { EmptyProvider } from "./empty";
import { FinnhubProvider } from "./finnhub";
import { cached, timeBucket } from "@/lib/data/cache";
import {
  getYahooCandles,
  getYahooSectorPerformance,
  getYahooQuote,
  getYahooPriceTarget,
  getYahooTopMovers,
} from "./yahoo";

export { FinnhubProvider };
export type { DataProvider };
export * from "./types";

/** True once optional Finnhub enrichment is configured. */
export function isConfigured(): boolean {
  return !!process.env.FINNHUB_API_KEY?.trim();
}

// Yahoo supplies the shared US/India quote and candle baseline. Finnhub adds
// optional US enrichment. Missing enrichment stays unavailable; it never blocks
// the rest of the product or turns into fabricated data.
export function getProvider(): DataProvider {
  const key = process.env.FINNHUB_API_KEY?.trim();
  const enrichment = key ? new FinnhubProvider(key) : new EmptyProvider();
  return new CachingProvider(
    new YahooCandleProvider(new FallbackProvider(enrichment, new EmptyProvider()))
  );
}

// Per-method cache TTLs (ms). Fast-moving data is short-lived; data that barely
// changes intraday (profile, fundamentals, ratings, earnings, insider) is held
// much longer so polling clients don't re-hammer Yahoo/Finnhub for it.
const TTL = {
  quote: 15_000,
  candles: 60_000,
  news: 120_000,
  sector: 60_000,
  movers: 30_000,
  priceTarget: 30 * 60_000,
  fundamentals: 30 * 60_000,
  ratings: 30 * 60_000,
  profile: 24 * 60 * 60_000,
  earnings: 6 * 60 * 60_000,
  insider: 6 * 60 * 60_000,
} as const;

// Wraps a provider so repeated reads of the same key are served from a process-wide
// TTL cache (with single-flight + stale-on-error). This caps upstream calls no
// matter how many tabs poll — clients can refresh freely without rate-limiting us.
class CachingProvider implements DataProvider {
  constructor(private inner: DataProvider) {}

  private up(t: string) { return t.toUpperCase(); }

  getQuote(ticker: string) {
    return cached(`q:${this.up(ticker)}`, TTL.quote, () => this.inner.getQuote(ticker));
  }
  getCandles(ticker: string, resolution: CandleResolution, from: number, to: number) {
    const key = `c:${this.up(ticker)}:${resolution}:${timeBucket(from, TTL.candles)}:${timeBucket(to, TTL.candles)}`;
    return cached(key, TTL.candles, () => this.inner.getCandles(ticker, resolution, from, to));
  }
  getNews(ticker?: string, limit?: number) {
    return cached(`n:${ticker ? this.up(ticker) : "general"}:${limit ?? "d"}`, TTL.news, () => this.inner.getNews(ticker, limit));
  }
  getCompanyProfile(ticker: string) {
    return cached(`p:${this.up(ticker)}`, TTL.profile, () => this.inner.getCompanyProfile(ticker));
  }
  getFundamentals(ticker: string) {
    return cached(`f:${this.up(ticker)}`, TTL.fundamentals, () => this.inner.getFundamentals(ticker));
  }
  getAnalystRatings(ticker: string) {
    return cached(`r:${this.up(ticker)}`, TTL.ratings, () => this.inner.getAnalystRatings(ticker));
  }
  getPriceTarget(ticker: string) {
    return cached(`pt:${this.up(ticker)}`, TTL.priceTarget, () => this.inner.getPriceTarget(ticker));
  }
  getEarnings(ticker: string) {
    return cached(`e:${this.up(ticker)}`, TTL.earnings, () => this.inner.getEarnings(ticker));
  }
  getInsiderTransactions(ticker: string) {
    return cached(`i:${this.up(ticker)}`, TTL.insider, () => this.inner.getInsiderTransactions(ticker));
  }
  getSectorPerformance() {
    return cached("sector", TTL.sector, () => this.inner.getSectorPerformance());
  }
  getTopMovers() {
    return cached("movers", TTL.movers, () => this.inner.getTopMovers());
  }
}

// Delegates everything to `inner`, but overrides getCandles with Yahoo Finance.
// Falls back to inner.getCandles if Yahoo fails (e.g., offline, unknown symbol).
class YahooCandleProvider implements DataProvider {
  constructor(private inner: DataProvider) {}

  async getSectorPerformance() {
    try {
      return await getYahooSectorPerformance();
    } catch {
      return this.inner.getSectorPerformance();
    }
  }

  async getCandles(ticker: string, resolution: CandleResolution, from: number, to: number): Promise<Candle[]> {
    try {
      const candles = await getYahooCandles(ticker, resolution, from, to);
      if (candles.length > 0) return candles;
      // Yahoo returned empty (e.g. no trading data for range) — fall through
    } catch {
      // Yahoo failed — fall through to inner provider
    }
    return this.inner.getCandles(ticker, resolution, from, to);
  }

  // Yahoo gives extended-hours (pre/post-market) prices; Finnhub's free /quote
  // freezes at the regular close. Prefer Yahoo, fall back to inner on failure.
  async getQuote(ticker: string) {
    try {
      return await getYahooQuote(ticker);
    } catch {
      return this.inner.getQuote(ticker);
    }
  }
  getNews(ticker?: string, limit?: number) { return this.inner.getNews(ticker, limit); }
  getCompanyProfile(ticker: string) { return this.inner.getCompanyProfile(ticker); }
  getFundamentals(ticker: string) { return this.inner.getFundamentals(ticker); }
  getAnalystRatings(ticker: string) { return this.inner.getAnalystRatings(ticker); }
  // Finnhub's /stock/price-target is premium (403 on free tier) and falls back to
  // mock; Yahoo provides real targets for free. Prefer Yahoo, fall back to inner.
  async getPriceTarget(ticker: string) {
    try {
      return await getYahooPriceTarget(ticker);
    } catch {
      return this.inner.getPriceTarget(ticker);
    }
  }
  getEarnings(ticker: string) { return this.inner.getEarnings(ticker); }
  getInsiderTransactions(ticker: string) { return this.inner.getInsiderTransactions(ticker); }
  // Finnhub's free tier has no movers endpoint; compute real ones from Yahoo.
  async getTopMovers(): Promise<{ gainers: MarketMover[]; losers: MarketMover[] }> {
    try {
      return await getYahooTopMovers();
    } catch {
      return this.inner.getTopMovers();
    }
  }
}

// Tries primary; on any error falls back to secondary silently.
class FallbackProvider implements DataProvider {
  constructor(private primary: DataProvider, private fallback: DataProvider) {}

  private async try<T>(fn: (p: DataProvider) => Promise<T>): Promise<T> {
    try {
      return await fn(this.primary);
    } catch {
      return fn(this.fallback);
    }
  }

  getQuote(ticker: string) { return this.try((p) => p.getQuote(ticker)); }
  getCandles(...args: Parameters<DataProvider["getCandles"]>) { return this.try((p) => p.getCandles(...args)); }
  getNews(ticker?: string, limit?: number) { return this.try((p) => p.getNews(ticker, limit)); }
  getCompanyProfile(ticker: string) { return this.try((p) => p.getCompanyProfile(ticker)); }
  getFundamentals(ticker: string) { return this.try((p) => p.getFundamentals(ticker)); }
  getAnalystRatings(ticker: string) { return this.try((p) => p.getAnalystRatings(ticker)); }
  getPriceTarget(ticker: string) { return this.try((p) => p.getPriceTarget(ticker)); }
  getEarnings(ticker: string) { return this.try((p) => p.getEarnings(ticker)); }
  getInsiderTransactions(ticker: string) { return this.try((p) => p.getInsiderTransactions(ticker)); }
  getSectorPerformance() { return this.try((p) => p.getSectorPerformance()); }
  getTopMovers() { return this.try((p) => p.getTopMovers()); }
}
