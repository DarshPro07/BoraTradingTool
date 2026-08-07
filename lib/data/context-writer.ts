import fs from "fs/promises";
import path from "path";
import { createHash } from "node:crypto";
import { parseInstrument } from "@/lib/market/instruments";
import type { Quote, CompanyProfile, Fundamentals, AnalystRating, PriceTarget, EarningsRecord, InsiderTransaction, NewsItem, Candle } from "@/lib/providers/types";
import type { TechnicalIndicators, Signal } from "@/lib/data/technicals";

const CONTEXT_DIR = path.join(process.cwd(), "context");

export function resolveStockContextPath(
  instrumentId: string,
  contextDirectory = CONTEXT_DIR,
): string {
  const instrument = parseInstrument(instrumentId);
  const root = path.resolve(contextDirectory);
  const hash = createHash("sha256").update(instrument.id).digest("hex").slice(0, 32);
  const target = path.resolve(root, `stock-${hash}.json`);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Context path escaped the context directory.");
  }
  return target;
}

async function writeAtomic(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, target);
}

async function ensureContextDir() {
  await fs.mkdir(CONTEXT_DIR, { recursive: true });
}

export async function writeStockContext(
  ticker: string,
  data: {
    quote: Quote;
    candles: Candle[];
    // Optional enrichments are nullable rather than defaulted. An absent profile is written
    // as null; substituting an empty one would make "we could not fetch this" indistinguishable
    // from "this company has no sector".
    profile: CompanyProfile | null;
    fundamentals: Fundamentals | null;
    analystRatings: AnalystRating[];
    priceTarget: PriceTarget | null;
    earnings: EarningsRecord[];
    insider: InsiderTransaction[];
    news: NewsItem[];
    tech: TechnicalIndicators;
    bullSignals: Signal[];
    bearSignals: Signal[];
    overallSignal: "buy" | "hold" | "sell";
    /** Optional sources that failed during this refresh. */
    degradedSources?: string[];
  }
) {
  await ensureContextDir();
  const instrument = parseInstrument(ticker);
  const degradedSources = data.degradedSources ?? [];
  const snapshot = {
    schemaVersion: 2,
    instrument,
    generatedAt: new Date().toISOString(),
    sources: {
      degraded: degradedSources,
      complete: degradedSources.length === 0,
    },
    quote: data.quote,
    profile: data.profile,
    fundamentals: data.fundamentals,
    technicals: data.tech,
    analystConsensus: {
      latest: data.analystRatings[0] ?? null,
      history: data.analystRatings.slice(0, 4),
    },
    priceTarget: data.priceTarget,
    earnings: data.earnings.slice(0, 8),
    insiderActivity: {
      transactions: data.insider.slice(0, 10),
      // Open-market buys and sells are discretionary decisions. Grants, option exercises,
      // gifts and tax withholding are not. Summing them into one "net" produces a number
      // that reads as conviction when it may only be a vesting schedule.
      openMarketNetChange: data.insider
        .filter((t) => t.transactionCode === "P" || t.transactionCode === "S")
        .reduce((sum, t) => sum + t.change, 0),
      nonDiscretionaryNetChange: data.insider
        .filter((t) => t.transactionCode !== "P" && t.transactionCode !== "S")
        .reduce((sum, t) => sum + t.change, 0),
    },
    recentNews: data.news.slice(0, 5).map((n) => ({
      headline: n.headline,
      source: n.source,
      sentiment: n.sentiment,
      publishedAt: n.publishedAt,
    })),
    signals: {
      bull: data.bullSignals,
      bear: data.bearSignals,
      overall: data.overallSignal,
    },
  };
  await writeAtomic(resolveStockContextPath(instrument.id), snapshot);
}

export async function writeMarketSnapshot(data: {
  indices: Record<string, { price: number; change: number; changePct: number }>;
  topGainers: Array<{ ticker: string; changePct: number }>;
  topLosers: Array<{ ticker: string; changePct: number }>;
  sectorPerformance: Array<{ sector: string; changePct: number }>;
  marketStatus: string;
}) {
  await ensureContextDir();
  const snapshot = {
    generatedAt: new Date().toISOString(),
    marketStatus: data.marketStatus,
    indices: data.indices,
    sectorPerformance: data.sectorPerformance,
    topGainers: data.topGainers,
    topLosers: data.topLosers,
  };
  await writeAtomic(path.join(CONTEXT_DIR, "market-snapshot.json"), snapshot);
}
