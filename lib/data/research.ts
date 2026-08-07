import { getProvider } from "@/lib/providers";
import { computeTechnicals, computeSignals } from "@/lib/data/technicals";
import { writeStockContext } from "@/lib/data/context-writer";
import type {
  AnalystRating,
  Candle,
  CompanyProfile,
  EarningsRecord,
  Fundamentals,
  InsiderTransaction,
  NewsItem,
  PriceTarget,
  Quote,
} from "@/lib/providers/types";

export interface ResearchSummary {
  ticker: string;
  price: number;
  overallSignal: "buy" | "hold" | "sell";
  bullCount: number;
  bearCount: number;
  /** Optional sources that failed. The refresh still succeeded, with less evidence behind it. */
  degradedSources: string[];
}

/** Enrichments the analysis cannot proceed without. */
type RequiredSource = "quote" | "candles";

function unwrap<T>(
  result: PromiseSettledResult<T>,
  label: string,
  degraded: string[],
): T | null {
  if (result.status === "fulfilled") return result.value;
  degraded.push(label);
  return null;
}

/**
 * Fetch the full data set for a ticker, compute technicals/signals, and write its Context
 * File. Shared by the Stock Analyzer page and the Scheduled Research System's refresh
 * endpoint so the agent always reads consistent context.
 *
 * Only the quote and candles are required. Every other source is allowed to fail
 * independently — one flaky provider should cost you that provider's evidence, not the
 * whole refresh. What failed is recorded rather than silently substituted, because a
 * fabricated profile or an invented price target is worse than a missing one.
 *
 * Returns null when a required source is unavailable.
 */
export async function refreshStockContext(rawTicker: string): Promise<ResearchSummary | null> {
  const ticker = rawTicker.toUpperCase();
  const provider = getProvider();
  const to = Math.floor(Date.now() / 1000);
  const from = to - 365 * 86400;

  const degraded: string[] = [];
  const [
    quoteResult,
    candlesResult,
    profileResult,
    fundamentalsResult,
    analystResult,
    priceTargetResult,
    earningsResult,
    insiderResult,
    newsResult,
  ] = await Promise.allSettled([
    provider.getQuote(ticker),
    provider.getCandles(ticker, "D", from, to),
    provider.getCompanyProfile(ticker),
    provider.getFundamentals(ticker),
    provider.getAnalystRatings(ticker),
    provider.getPriceTarget(ticker),
    provider.getEarnings(ticker),
    provider.getInsiderTransactions(ticker),
    provider.getNews(ticker, 10),
  ]);

  const required: RequiredSource[] = [];
  if (quoteResult.status === "rejected") required.push("quote");
  if (candlesResult.status === "rejected") required.push("candles");
  if (required.length > 0) return null;

  const quote = (quoteResult as PromiseFulfilledResult<Quote>).value;
  const candles = (candlesResult as PromiseFulfilledResult<Candle[]>).value;
  if (!quote.price || quote.price === 0) return null;
  quote.change = quote.change ?? 0;
  quote.changePct = quote.changePct ?? 0;

  const profile = unwrap<CompanyProfile>(profileResult, "profile", degraded);
  const fundamentals = unwrap<Fundamentals>(fundamentalsResult, "fundamentals", degraded);
  const analystRatings = unwrap<AnalystRating[]>(analystResult, "analystRatings", degraded) ?? [];
  const priceTarget = unwrap<PriceTarget>(priceTargetResult, "priceTarget", degraded);
  const earnings = unwrap<EarningsRecord[]>(earningsResult, "earnings", degraded) ?? [];
  const insider = unwrap<InsiderTransaction[]>(insiderResult, "insider", degraded) ?? [];
  const news = unwrap<NewsItem[]>(newsResult, "news", degraded) ?? [];

  const tech = computeTechnicals(candles);
  const latestRating =
    analystRatings[0] ?? { buy: 0, hold: 0, sell: 0, strongBuy: 0, strongSell: 0, period: "" };
  const { bullSignals, bearSignals, overallSignal } = computeSignals(
    quote.price,
    tech,
    {
      pe: fundamentals?.pe ?? null,
      revenueGrowth: fundamentals?.revenueGrowth ?? null,
      netMargin: fundamentals?.netMargin ?? null,
    },
    latestRating.buy + latestRating.strongBuy,
    latestRating.sell + latestRating.strongSell,
  );

  await writeStockContext(ticker, {
    quote,
    candles,
    profile,
    fundamentals,
    analystRatings,
    priceTarget,
    earnings,
    insider,
    news,
    tech,
    bullSignals,
    bearSignals,
    overallSignal,
    degradedSources: degraded,
  });

  return {
    ticker,
    price: quote.price,
    overallSignal,
    bullCount: bullSignals.length,
    bearCount: bearSignals.length,
    degradedSources: degraded,
  };
}
