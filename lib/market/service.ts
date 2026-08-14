import { createHash } from "node:crypto";
import { computeSignals, computeTechnicals } from "@/lib/data/technicals";
import { getProvider } from "@/lib/providers";
import { getYahooCandles, getYahooQuote } from "@/lib/providers/yahoo";
import type {
  AnalystRating,
  CompanyProfile,
  EarningsRecord,
  Fundamentals,
  InsiderTransaction,
  NewsItem,
  PriceTarget,
} from "@/lib/providers/types";
import type { CandleResolution } from "@/lib/providers/types";
import type { Instrument, NormalizedCandles, NormalizedQuote, Provenance } from "./types";

const TEST_PRICES: Record<string, number> = {
  "US:XNAS:AAPL": 205.25,
  "IN:XNSE:RELIANCE": 2_985.5,
  "IN:XBOM:500325": 2_984.85,
};

export interface ResearchSnapshot {
  instrument: Instrument;
  quote: NormalizedQuote;
  candles: NormalizedCandles;
  profile: CompanyProfile;
  fundamentals: Fundamentals;
  analystRatings: AnalystRating[];
  priceTarget: PriceTarget;
  news: NewsItem[];
  earnings: EarningsRecord[];
  insider: InsiderTransaction[];
  technicals: ReturnType<typeof computeTechnicals>;
  signals: {
    bull: ReturnType<typeof computeSignals>["bullSignals"];
    bear: ReturnType<typeof computeSignals>["bearSignals"];
    overall: ReturnType<typeof computeSignals>["overallSignal"];
  };
  generatedAt: string;
  snapshotId: string;
}

function testProvenance(sourceId: string, eventAt = new Date()): Provenance {
  return {
    provider: "TEST_FIXTURE",
    sourceEventAt: eventAt.toISOString(),
    ingestedAt: new Date().toISOString(),
    // NOT "LIVE". These numbers were invented by `fixtureQuote`/`fixtureCandles`; calling them
    // live is how fabricated prices reached the market dashboard indistinguishable from real ones.
    quality: "FIXTURE",
    delayedBySeconds: 0,
    sourceId,
  };
}

function fixtureQuote(instrument: Instrument): NormalizedQuote {
  const price = TEST_PRICES[instrument.id] ?? (instrument.currency === "USD" ? 100 : 1_000);
  return {
    instrument,
    price,
    open: price * 0.99,
    high: price * 1.01,
    low: price * 0.98,
    previousClose: price * 0.995,
    change: price * 0.005,
    changePct: 0.5,
    volume: 1_500_000,
    currency: instrument.currency,
    provenance: testProvenance(`fixture:quote:${instrument.id}`),
  };
}

function fixtureCandles(instrument: Instrument, resolution: CandleResolution): NormalizedCandles {
  const price = TEST_PRICES[instrument.id] ?? (instrument.currency === "USD" ? 100 : 1_000);
  const start = 1_735_689_600;
  const candles = Array.from({ length: 260 }, (_, index) => {
    const drift = 0.85 + index / 1300;
    const close = price * drift;
    return {
      time: start + index * 86_400,
      open: close * 0.997,
      high: close * 1.006,
      low: close * 0.994,
      close,
      volume: 1_000_000 + index * 100,
    };
  });
  return {
    instrument,
    resolution,
    candles,
    provenance: testProvenance(`fixture:candles:${instrument.id}:${resolution}`, new Date(candles.at(-1)!.time * 1000)),
  };
}

function qualityFromAge(sourceEventAt: Date | undefined): Pick<Provenance, "quality" | "delayedBySeconds"> {
  if (!sourceEventAt) return { quality: "DELAYED", delayedBySeconds: null };
  const delayedBySeconds = Math.max(0, Math.floor((Date.now() - sourceEventAt.getTime()) / 1000));
  if (delayedBySeconds <= 120) return { quality: "LIVE", delayedBySeconds };
  if (delayedBySeconds <= 900) return { quality: "DELAYED", delayedBySeconds };
  return { quality: "STALE", delayedBySeconds };
}

export async function getNormalizedQuote(instrument: Instrument): Promise<NormalizedQuote> {
  if (process.env.MARKETPULSE_TEST_MODE === "1") return fixtureQuote(instrument);
  const quote = await getYahooQuote(instrument.providerSymbol);
  if (!Number.isFinite(quote.price) || quote.price <= 0) {
    throw new Error(`No valid quote is available for ${instrument.id}.`);
  }
  const age = qualityFromAge(quote.sourceEventAt);
  return {
    instrument,
    price: quote.price,
    open: quote.open || null,
    high: quote.high || null,
    low: quote.low || null,
    previousClose: quote.prevClose || null,
    change: Number.isFinite(quote.change) ? quote.change : null,
    changePct: Number.isFinite(quote.changePct) ? quote.changePct : null,
    volume: quote.volume || null,
    currency: instrument.currency,
    provenance: {
      provider: "YAHOO",
      sourceEventAt: quote.sourceEventAt?.toISOString() ?? null,
      ingestedAt: quote.fetchedAt.toISOString(),
      quality: age.quality,
      delayedBySeconds: age.delayedBySeconds,
      sourceId: `yahoo:chart:${instrument.providerSymbol}:${quote.sourceEventAt?.getTime() ?? quote.fetchedAt.getTime()}`,
    },
  };
}

export async function getNormalizedCandles(
  instrument: Instrument,
  resolution: CandleResolution = "D",
  from = Math.floor(Date.now() / 1000) - 365 * 86_400,
  to = Math.floor(Date.now() / 1000),
): Promise<NormalizedCandles> {
  if (process.env.MARKETPULSE_TEST_MODE === "1") return fixtureCandles(instrument, resolution);
  const candles = await getYahooCandles(instrument.providerSymbol, resolution, from, to);
  if (!candles.length) throw new Error(`No candle data is available for ${instrument.id}.`);
  const latest = new Date(candles.at(-1)!.time * 1000);
  const age = qualityFromAge(latest);
  return {
    instrument,
    resolution,
    candles,
    provenance: {
      provider: "YAHOO",
      sourceEventAt: latest.toISOString(),
      ingestedAt: new Date().toISOString(),
      quality: resolution === "D" && age.quality === "STALE" ? "DELAYED" : age.quality,
      delayedBySeconds: age.delayedBySeconds,
      sourceId: `yahoo:chart:${instrument.providerSymbol}:${resolution}:${candles[0].time}:${candles.at(-1)!.time}`,
    },
  };
}

function emptyFundamentals(): Fundamentals {
  return {
    pe: null,
    eps: null,
    revenue: null,
    revenueGrowth: null,
    grossMargin: null,
    netMargin: null,
    debtToEquity: null,
    freeCashFlow: null,
    bookValue: null,
    dividendYield: null,
    beta: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
  };
}

export async function buildResearchSnapshot(instrument: Instrument): Promise<ResearchSnapshot> {
  const [quote, candles] = await Promise.all([
    getNormalizedQuote(instrument),
    getNormalizedCandles(instrument),
  ]);
  const testMode = process.env.MARKETPULSE_TEST_MODE === "1";
  const enrichment = testMode
    ? await Promise.allSettled([
        Promise.resolve({ ticker: instrument.symbol, name: instrument.name, exchange: instrument.exchange, sector: "Technology", industry: "Fixture", marketCap: 1_000_000_000 }),
        Promise.resolve({ ...emptyFundamentals(), pe: 24, eps: 8.5, revenueGrowth: 0.12, debtToEquity: 0.3 }),
        Promise.resolve([{ buy: 8, hold: 3, sell: 1, strongBuy: 2, strongSell: 0, period: "2026-08" }]),
        Promise.resolve({ high: quote.price * 1.2, low: quote.price * 0.8, mean: quote.price * 1.08, median: quote.price * 1.05 }),
        Promise.resolve([] as NewsItem[]),
        Promise.resolve([] as EarningsRecord[]),
        Promise.resolve([] as InsiderTransaction[]),
      ])
    : await Promise.allSettled((() => {
        const provider = getProvider();
        return [
          provider.getCompanyProfile(instrument.providerSymbol),
          provider.getFundamentals(instrument.providerSymbol),
          provider.getAnalystRatings(instrument.providerSymbol),
          provider.getPriceTarget(instrument.providerSymbol),
          provider.getNews(instrument.providerSymbol, 12),
          provider.getEarnings(instrument.providerSymbol),
          provider.getInsiderTransactions(instrument.providerSymbol),
        ];
      })());
  const profile = enrichment[0].status === "fulfilled"
    ? { ...enrichment[0].value, ticker: instrument.symbol, name: instrument.name }
    : { ticker: instrument.symbol, name: instrument.name, exchange: instrument.exchange, sector: "", industry: "", marketCap: 0 };
  const fundamentals = enrichment[1].status === "fulfilled" ? enrichment[1].value : emptyFundamentals();
  const analystRatings = enrichment[2].status === "fulfilled" ? enrichment[2].value : [];
  const priceTarget = enrichment[3].status === "fulfilled" ? enrichment[3].value : { high: 0, low: 0, mean: 0, median: 0 };
  const news = enrichment[4].status === "fulfilled" ? enrichment[4].value : [];
  const earnings = enrichment[5].status === "fulfilled" ? enrichment[5].value : [];
  const insider = enrichment[6].status === "fulfilled" ? enrichment[6].value : [];
  const technicals = computeTechnicals(candles.candles);
  const latest = analystRatings[0] ?? { buy: 0, hold: 0, sell: 0, strongBuy: 0, strongSell: 0, period: "" };
  const computed = computeSignals(
    quote.price,
    technicals,
    fundamentals,
    latest.buy + latest.strongBuy,
    latest.sell + latest.strongSell,
  );
  const generatedAt = new Date().toISOString();
  const identity = JSON.stringify({
    instrument: instrument.id,
    quote: quote.provenance.sourceId,
    candles: candles.provenance.sourceId,
    generatedAt,
  });
  return {
    instrument,
    quote,
    candles,
    profile,
    fundamentals,
    analystRatings,
    priceTarget,
    news,
    earnings,
    insider,
    technicals,
    signals: {
      bull: computed.bullSignals,
      bear: computed.bearSignals,
      overall: computed.overallSignal,
    },
    generatedAt,
    snapshotId: createHash("sha256").update(identity).digest("hex"),
  };
}
