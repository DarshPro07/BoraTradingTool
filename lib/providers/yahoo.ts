import type { Candle, CandleResolution, SectorPerformance, Quote, PriceTarget, MarketMover } from "./types";
import { assertProviderIdentity } from "@/lib/market/identity-guard";

// Fallback universe of liquid names, sorted only when Yahoo's dynamic, market-wide
// movers screener is unavailable (see getYahooTopMovers). NOT the primary source
// and NOT the agent's research universe — the agent discovers candidates externally
// (news/trends/TA) and feeds them to /api/research/refresh via { tickers: [...] }.
const MOVERS_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMZN", "TSLA", "AMD", "PLTR", "CRM",
  "NFLX", "AVGO", "INTC", "MU", "COIN", "UBER", "DIS", "BA", "JPM", "XOM",
];

const YAHOO_UA = "Mozilla/5.0";
/**
 * Four seconds, not ten.
 *
 * These calls block a server render, so the timeout is what the operator waits when the network
 * is unreachable — and a page that hangs for ten seconds per instrument before reporting
 * "unavailable" is the single largest source of the product feeling slow.
 *
 * Yahoo answers a healthy request in well under a second, so four leaves a wide margin while
 * turning an outage into a fast, honest refusal. The panel-state vocabulary already renders that
 * refusal correctly; it just had to arrive before the operator gave up.
 */
export const YAHOO_TIMEOUT_MS = 4_000;

/**
 * The exception the four-second rule needs, and why it is not a relaxation of it.
 *
 * Once the window-aware range fix landed, one request in this system stopped resembling all the
 * others: a 59-day 5-minute backfill returns ~3,000 bars and several hundred KB of JSON, against a
 * quote's handful. Nothing renders behind it — the intraday accumulator is a background job whose
 * only reader is the store — so the reasoning above (an operator waiting on a page) does not
 * apply, while its cost does: the largest payload in the system was being cancelled at the budget
 * chosen for the smallest.
 *
 * Measured 2026-08-16: `IN:XNSE:ASKAUTOLTD` 5m aborted at 4s while the same instrument's 15m and
 * 60m fetches — ~3× and ~10× smaller — completed in the same pass. Thirty seconds is chosen to
 * clear a slow-but-working transfer, not to wait out an outage.
 */
export const YAHOO_BULK_TIMEOUT_MS = 30_000;

/**
 * How long this specific request may take, decided by what it asks for.
 *
 * Only a *bulk intraday* window earns the longer budget: intraday resolutions are the ones that
 * return thousands of bars over a wide window. A daily request spanning a year is a few hundred
 * bars, and a session-sized intraday request is the live path a page waits on — both keep the
 * render budget, because for them a slow answer really is the worse failure.
 */
export function candleTimeoutMs(resolution: CandleResolution, from: number, to: number): number {
  const intraday = Number.isFinite(Number(resolution));
  const bulk = to - from > RANGE_SHORTCUT_MAX_SECONDS;
  return intraday && bulk ? YAHOO_BULK_TIMEOUT_MS : YAHOO_TIMEOUT_MS;
}

type NextFetchInit = RequestInit & { next?: { revalidate?: number } };

function yahooFetch(url: string, init: NextFetchInit = {}) {
  return fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(YAHOO_TIMEOUT_MS),
  });
}

// Yahoo's quoteSummary endpoint (which carries analyst price targets) requires a
// cookie + crumb. Fetch them once and cache — they're stable for a while.
let _crumb: { cookie: string; crumb: string; at: number } | null = null;
const CRUMB_TTL_MS = 30 * 60 * 1000;

async function getYahooCrumb(): Promise<{ cookie: string; crumb: string }> {
  if (_crumb && Date.now() - _crumb.at < CRUMB_TTL_MS) return _crumb;
  // 1. Hit Yahoo to receive a session cookie (status may be 404; we only want the cookie).
  const cookieRes = await yahooFetch("https://fc.yahoo.com/", { headers: { "User-Agent": YAHOO_UA } });
  const setCookies =
    typeof cookieRes.headers.getSetCookie === "function"
      ? cookieRes.headers.getSetCookie()
      : [cookieRes.headers.get("set-cookie") ?? ""];
  const cookie = setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) throw new Error("Yahoo: no session cookie");
  // 2. Exchange the cookie for a crumb.
  const crumbRes = await yahooFetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": YAHOO_UA, cookie },
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 30 || crumb.includes("<")) throw new Error("Yahoo: bad crumb");
  _crumb = { cookie, crumb, at: Date.now() };
  return _crumb;
}

function rawNum(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "raw" in v) {
    const r = (v as { raw: unknown }).raw;
    return typeof r === "number" ? r : null;
  }
  return null;
}

// Real analyst price targets from Yahoo (free), replacing Finnhub's premium-only
// /stock/price-target which 403s on the free tier and silently fell back to mock.
export async function getYahooPriceTarget(ticker: string): Promise<PriceTarget> {
  const { cookie, crumb } = await getYahooCrumb();
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
    `?modules=financialData&crumb=${encodeURIComponent(crumb)}`;
  const res = await yahooFetch(url, {
    headers: { "User-Agent": YAHOO_UA, cookie },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Yahoo price target ${ticker}: HTTP ${res.status}`);
  const data = await res.json();
  const fd = data?.quoteSummary?.result?.[0]?.financialData;
  if (!fd) throw new Error(`Yahoo price target ${ticker}: no data`);
  const mean = rawNum(fd.targetMeanPrice);
  if (mean == null) throw new Error(`Yahoo price target ${ticker}: no target`);
  return {
    mean,
    median: rawNum(fd.targetMedianPrice) ?? mean,
    high: rawNum(fd.targetHighPrice) ?? mean,
    low: rawNum(fd.targetLowPrice) ?? mean,
  };
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      /** Yahoo states which symbol it served; the identity guard compares it to the request. */
      meta?: { symbol?: string };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

// For short timeframes, use Yahoo's `range` param — it returns clean single/multi-session
// data without overnight gaps. For longer periods, use period1/period2.
const RANGE_CONFIG: Partial<Record<CandleResolution, { range: string; interval: string }>> = {
  "1":  { range: "1d",  interval: "1m"  },
  "5":  { range: "1d",  interval: "5m"  },
  "15": { range: "5d",  interval: "15m" },
  "30": { range: "1mo", interval: "30m" },
  "60": { range: "1mo", interval: "60m" },
};

const PERIOD_INTERVAL: Partial<Record<CandleResolution, string>> = {
  "D": "1d",
  "W": "1wk",
  "M": "1mo",
  // Intraday period-based fetches (historical backfill): Yahoo serves these within its own
  // trailing retention window (~60 days for 5m/15m, ~30 days for hourly) — proven 2026-08-16
  // with 4,125 5m bars / 55 sessions in one TCS.NS request.
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "60m",
};

/**
 * The range shortcut serves the LIVE intraday paths (the accumulator's session window) and must
 * keep its exact semantics; a request spanning more than this is a HISTORICAL BACKFILL and goes
 * period-based instead. 5 days covers every live caller (the widest range entry) with margin.
 */
const RANGE_SHORTCUT_MAX_SECONDS = 5 * 86_400;

export async function getYahooCandles(
  ticker: string,
  resolution: CandleResolution,
  from: number,
  to: number,
  /** Optional out-param: the provider knows whether it verified identity, so it reports it. */
  telemetry?: { identityVerdict?: "MATCHED" | "UNSTATED" }
): Promise<Candle[]> {
  let url: string;

  const rangeConf =
    to - from <= RANGE_SHORTCUT_MAX_SECONDS ? RANGE_CONFIG[resolution] : undefined;
  if (rangeConf) {
    // Short timeframe: use range param for clean session-aware data. Include
    // pre/post-market so the intraday chart (and its last-price line) extends
    // into extended hours instead of freezing at the regular-session close.
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${rangeConf.range}&interval=${rangeConf.interval}&includePrePost=true`;
  } else {
    const interval = PERIOD_INTERVAL[resolution] ?? "1d";
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${from}&period2=${to}&interval=${interval}`;
  }

  const res = await yahooFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    // Short cache for intraday, longer for daily+
    next: { revalidate: rangeConf ? 60 : 300 },
    signal: AbortSignal.timeout(candleTimeoutMs(resolution, from, to)),
  });

  if (!res.ok) throw new Error(`Yahoo Finance ${ticker}: HTTP ${res.status}`);

  const data: YahooChartResponse = await res.json();
  if (data.chart.error) throw new Error(`Yahoo Finance ${ticker}: ${data.chart.error.description}`);
  if (!data.chart.result?.[0]) throw new Error(`Yahoo Finance ${ticker}: no data`);

  const result = data.chart.result[0];
  // THE identity invariant, before a single bar is built: a successful fetch of the wrong
  // instrument is worse than a failed one, because it is undetectable once stored.
  const identityVerdict = assertProviderIdentity("yahoo", ticker, result.meta?.symbol);
  if (telemetry) telemetry.identityVerdict = identityVerdict === "MATCHED" ? "MATCHED" : "UNSTATED";
  const { timestamp } = result;
  const { open, high, low, close, volume } = result.indicators.quote[0];

  const candles: Candle[] = [];
  for (let i = 0; i < timestamp.length; i++) {
    if (open[i] == null || high[i] == null || low[i] == null || close[i] == null) continue;
    candles.push({
      time: timestamp[i],
      open: open[i]!,
      high: high[i]!,
      low: low[i]!,
      close: close[i]!,
      volume: volume[i] ?? 0,
    });
  }

  return candles;
}

interface YahooQuoteMeta {
  regularMarketPrice?: number;
  regularMarketTime?: number; // unix seconds of the last regular-session print
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
}

// Quote with extended-hours support. Yahoo's `includePrePost` chart returns
// pre/post-market prints that Finnhub's free /quote endpoint omits — so after
// the 4pm close the price keeps moving instead of freezing. During the regular
// session we use the real-time regularMarketPrice; outside it, the latest
// pre/post print. Change is measured against the prior regular close.
export async function getYahooQuote(ticker: string): Promise<Quote> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=1d&interval=5m&includePrePost=true`;
  const res = await yahooFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 30 },
  });
  if (!res.ok) throw new Error(`Yahoo quote ${ticker}: HTTP ${res.status}`);

  const data: YahooChartResponse & { chart: { result: Array<{ meta: YahooQuoteMeta }> | null } } =
    await res.json();
  if (data.chart.error) throw new Error(`Yahoo quote ${ticker}: ${data.chart.error.description}`);
  const result = data.chart.result?.[0];
  if (!result) throw new Error(`Yahoo quote ${ticker}: no data`);

  const meta = result.meta as YahooQuoteMeta;
  const ts = result.timestamp ?? [];
  const closes = result.indicators.quote[0]?.close ?? [];
  const opens = result.indicators.quote[0]?.open ?? [];

  // Latest non-null print (regular or extended hours) and its timestamp.
  let lastClose: number | null = null;
  let lastTs: number | null = null;
  for (let i = ts.length - 1; i >= 0; i--) {
    if (closes[i] != null) {
      lastClose = closes[i]!;
      lastTs = ts[i];
      break;
    }
  }
  const firstOpen = opens.find((o) => o != null) ?? null;

  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? lastClose ?? 0;

  // In the regular session, prefer the real-time regularMarketPrice. Once we're
  // past the last regular print (= extended hours), use the latest extended print.
  const inExtended =
    lastTs != null && meta.regularMarketTime != null && lastTs > meta.regularMarketTime;
  const price =
    (inExtended ? lastClose : meta.regularMarketPrice ?? lastClose) ?? prevClose;

  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;

  return {
    ticker,
    price,
    open: firstOpen ?? meta.regularMarketPrice ?? price,
    high: meta.regularMarketDayHigh ?? price,
    low: meta.regularMarketDayLow ?? price,
    prevClose,
    change,
    changePct,
    volume: meta.regularMarketVolume ?? 0,
    avgVolume: meta.regularMarketVolume ?? 0,
    fetchedAt: new Date(),
    sourceEventAt: lastTs ? new Date(lastTs * 1000) : undefined,
    provider: "YAHOO",
    mock: false,
  };
}

const SECTOR_ETFS: { etf: string; sector: string }[] = [
  { etf: "XLK",  sector: "Technology" },
  { etf: "XLV",  sector: "Healthcare" },
  { etf: "XLF",  sector: "Financials" },
  { etf: "XLE",  sector: "Energy" },
  { etf: "XLY",  sector: "Consumer Discretionary" },
  { etf: "XLI",  sector: "Industrials" },
  { etf: "XLB",  sector: "Materials" },
  { etf: "XLU",  sector: "Utilities" },
  { etf: "XLRE", sector: "Real Estate" },
  { etf: "XLC",  sector: "Communication Services" },
  { etf: "XLP",  sector: "Consumer Staples" },
];

interface YahooMeta {
  regularMarketPrice: number;
  chartPreviousClose: number;
}

// One of Yahoo's predefined screeners (day_gainers / day_losers / most_actives).
// Liquidity floor for movers — keeps the widget to real, tradeable names and
// filters out penny stocks / illiquid micro-caps (which dominate raw % movers).
const MOVERS_MIN_PRICE = 5; // USD
const MOVERS_MIN_DAY_VOLUME = 1_000_000; // shares
const MOVERS_MIN_MARKET_CAP = 2_000_000_000; // USD

// Run Yahoo's custom screener with the liquidity floor applied server-side,
// sorted as requested. Market-wide and recomputed every call — the basis for both
// the day's movers and the most-actives setup universe (no fixed lists).
async function runYahooScreener(
  sortField: string,
  sortType: "ASC" | "DESC",
  count: number
): Promise<Record<string, unknown>[]> {
  const { cookie, crumb } = await getYahooCrumb();
  const body = {
    size: count,
    offset: 0,
    sortField,
    sortType,
    quoteType: "EQUITY",
    query: {
      operator: "AND",
      operands: [
        { operator: "eq", operands: ["region", "us"] },
        { operator: "gt", operands: ["intradayprice", MOVERS_MIN_PRICE] },
        { operator: "gt", operands: ["dayvolume", MOVERS_MIN_DAY_VOLUME] },
        { operator: "gt", operands: ["intradaymarketcap", MOVERS_MIN_MARKET_CAP] },
      ],
    },
    userId: "",
    userIdType: "guid",
  };
  const res = await yahooFetch(
    `https://query1.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumb)}`,
    {
      method: "POST",
      headers: { "User-Agent": YAHOO_UA, cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`Yahoo screener ${sortField}: ${res.status}`);
  const json = await res.json();
  return (json?.finance?.result?.[0]?.quotes ?? []) as Record<string, unknown>[];
}

// The day's biggest movers in one direction (sorted by % change).
async function fetchYahooMovers(direction: "gainers" | "losers", count: number): Promise<MarketMover[]> {
  const quotes = await runYahooScreener("percentchange", direction === "gainers" ? "DESC" : "ASC", count);
  return quotes
    .map((q) => ({
      ticker: String(q.symbol ?? ""),
      name: String(q.displayName ?? q.shortName ?? q.symbol ?? ""),
      price: rawNum(q.regularMarketPrice) ?? 0,
      change: rawNum(q.regularMarketChange) ?? 0,
      changePct: rawNum(q.regularMarketChangePercent) ?? 0,
    }))
    .filter((m) => m.ticker && m.price > 0);
}

// A dynamic, market-wide pool of today's most actively traded liquid US stocks —
// a daily-changing universe for the setup scanner (replaces any hardcoded list).
export async function getYahooMostActives(count: number): Promise<string[]> {
  const quotes = await runYahooScreener("dayvolume", "DESC", count);
  return quotes.map((q) => String(q.symbol ?? "")).filter(Boolean);
}

// Real, dynamic Top Movers from Yahoo's market-wide screener with a liquidity
// floor. Falls back to sorting the fixed liquid universe only if the screener is
// unavailable (so the widget degrades instead of going blank).
export async function getYahooTopMovers(): Promise<{ gainers: MarketMover[]; losers: MarketMover[] }> {
  try {
    const [gainers, losers] = await Promise.all([
      fetchYahooMovers("gainers", 10),
      fetchYahooMovers("losers", 10),
    ]);
    if (gainers.length || losers.length) {
      return { gainers: gainers.slice(0, 5), losers: losers.slice(0, 5) };
    }
  } catch {
    // screener unavailable — fall back to the fixed-universe computation
  }
  return topMoversFromUniverse();
}

// Fallback only: compute movers by sorting live quotes over the fixed liquid
// universe. Used when Yahoo's dynamic screener can't be reached.
async function topMoversFromUniverse(): Promise<{ gainers: MarketMover[]; losers: MarketMover[] }> {
  const results = await Promise.allSettled(MOVERS_UNIVERSE.map((t) => getYahooQuote(t)));
  const movers: MarketMover[] = results
    .filter((r): r is PromiseFulfilledResult<Quote> => r.status === "fulfilled" && r.value.price > 0)
    .map((r) => ({
      ticker: r.value.ticker,
      name: r.value.ticker,
      price: r.value.price,
      change: r.value.change,
      changePct: r.value.changePct,
    }));
  const sorted = [...movers].sort((a, b) => b.changePct - a.changePct);
  return {
    gainers: sorted.slice(0, 5),
    losers: sorted.slice(-5).reverse(),
  };
}

export async function getYahooSectorPerformance(): Promise<SectorPerformance[]> {
  const results = await Promise.allSettled(
    SECTOR_ETFS.map(async ({ etf, sector }) => {
      const res = await yahooFetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${etf}?range=1d&interval=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 60 } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const meta: YahooMeta = data.chart.result[0].meta;
      const changePct = ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
      return { sector, changePct: +changePct.toFixed(2) };
    })
  );

  return results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { sector: SECTOR_ETFS[i].sector, changePct: 0 }
  );
}
