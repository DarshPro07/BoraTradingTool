import { INSTRUMENT_CATALOG } from "@/lib/market/catalog";
import { getNormalizedCandles } from "@/lib/market/service";
import { loadStoredCandles } from "@/lib/market/candle-store";
import type { StrategyDsl } from "@/lib/strategy/dsl";
import type { Instrument, Market } from "@/lib/market/types";
import type { Candle, CandleResolution } from "@/lib/providers/types";
import type { CandleLoader } from "./rehearsal";

/**
 * The production candle source for the rehearsal pass.
 *
 * Kept out of `rehearsal.ts` so that module stays pure and testable, and so the sampling policy
 * below is visible rather than buried inside the thing it constrains.
 */

/**
 * How many instruments of the market a rehearsal walks.
 *
 * This is a sample, not the universe, and the number is stated in the outcome so nobody reads
 * a rehearsal as full coverage. A cycle that pulled several hundred series per candidate on a
 * timer would hammer the provider for a result whose purpose is only to say "worth a real
 * trial?" — but a sample that is too small stops the position cap from ever binding, which is
 * the specific distortion the portfolio engine exists to prevent. Twelve is enough for
 * `maxPositions` defaults of ten to matter.
 */
export const REHEARSAL_SAMPLE_SIZE = 12;

/** The DSL speaks in markets and exchanges; the catalog is keyed by both. */
function instrumentsForMarket(name: string) {
  const market: Market = name === "US" ? "US" : "IN";
  const exchange = name === "NSE" ? "XNSE" : name === "BSE" ? "XBOM" : null;
  return INSTRUMENT_CATALOG.filter(
    (instrument) => instrument.market === market && (exchange === null || instrument.exchange === exchange),
  ).slice(0, REHEARSAL_SAMPLE_SIZE);
}

/**
 * Daily bars for a sample of the strategy's universe.
 *
 * `allSettled`, so one instrument's provider failure costs that series rather than the whole
 * candidate — and an instrument that returns nothing is simply absent from the dataset, never
 * present with an empty or invented series.
 */
/**
 * Three years, not the service's one-year default. SMA200 alone consumes 200 bars of warm-up,
 * so a single year leaves roughly fifty evaluable bars — below the thirty *trades* the
 * simulation battery requires, which would make every candidate inconclusive for a reason that
 * has nothing to do with the candidate.
 */
const LOOKBACK_SECONDS = 3 * 365 * 86_400;

/**
 * Circuit breaker across cycles.
 *
 * When the network is down every request costs a full connect timeout, so a cycle that fetches
 * twelve instruments spends two minutes failing and then does it again on the next tick. After
 * a market has failed wholesale, later cycles skip it until the cooldown expires — an outage
 * should cost one round of timeouts, not one round every fifteen minutes.
 */
/**
 * Below this, stored bars are treated as a fragment rather than a series and the live feed is
 * used instead. Chosen to exceed the longest warm-up any derivable feature needs (`sma200`), so
 * a partial import can never shorten a backtest into `INSUFFICIENT_BARS`.
 */
const MIN_STORED_BARS = 250;

const COOLDOWN_MS = 10 * 60_000;
const failedUntil = new Map<string, number>();

/** Exported for tests and for a screen that wants to say *why* a market was skipped. */
export function marketIsCoolingDown(market: string, now = Date.now()): boolean {
  const until = failedUntil.get(market);
  return until !== undefined && now < until;
}

export function marketCandleLoader(resolution: CandleResolution = "D"): CandleLoader {
  // Memoised per loader instance, which is one cycle. Candidates share markets — two NSE
  // strategies would otherwise pull the same twelve series twice, and ten would pull them ten
  // times. Keyed by market because that is what determines the sample.
  const byMarket = new Map<string, Promise<Readonly<Record<string, readonly Candle[]>>>>();

  return async (_specId: string, dsl: StrategyDsl) => {
    const cached = byMarket.get(dsl.universe.market);
    if (cached) return cached;
    // Returning empty rather than throwing: the rehearsal already reports "no stored candles"
    // as not_evaluable, which is the honest outcome of a provider outage.
    if (marketIsCoolingDown(dsl.universe.market)) return {};
    const pending = fetchMarket(dsl, resolution);
    // Stored before awaiting, so concurrent candidates on one market share the same flight.
    byMarket.set(dsl.universe.market, pending);
    return pending;
  };
}

async function fetchMarket(
  dsl: StrategyDsl,
  resolution: CandleResolution,
): Promise<Readonly<Record<string, readonly Candle[]>>> {
  return fetchMarketSample(dsl.universe.market, resolution);
}

/**
 * The same sample, addressable without a strategy.
 *
 * The quant-core generation pass needs bars to scan for live signals and to read the volatility
 * regime, and it has a market rather than a DSL. Extracted rather than duplicated so both callers
 * share one circuit breaker and one sampling policy — two independent fetch paths would mean an
 * outage trips the breaker for one and not the other, and the cooldown stops meaning anything.
 */
/**
 * Bars for one named instrument, outside the sample.
 *
 * The regime proxy needs this. `fetchMarketSample` takes the first twelve catalog entries and QQQ
 * is the thirteenth, so it was silently absent from every dataset and the regime read never had a
 * series to work with — it reported "not enough history" forever while the real answer was "no
 * bars at all".
 *
 * Widening the sample to include it was the tempting fix and the wrong one: twelve is chosen so a
 * `maxPositions` of ten actually binds during rehearsal, and changing it to solve a regime problem
 * would quietly alter what every candidate is judged on.
 */
export async function fetchInstrumentBars(
  instrument: Instrument,
  resolution: CandleResolution = "D",
): Promise<readonly Candle[]> {
  const to = Math.floor(Date.now() / 1000);

  // Imported history wins when it exists.
  //
  // Yahoo serves roughly sixty days at 1-minute resolution, which is not enough bars to validate
  // an intraday strategy — and no amount of waiting fixes it, because the window slides. A
  // declared dataset supplies the depth, so a backtest reads it in preference to the live feed.
  //
  // Only when there is *more* stored than the live feed would return. A handful of imported bars
  // shadowing a full live series would silently shorten every backtest, and a shorter series
  // fails `INSUFFICIENT_BARS` rather than looking wrong — the sort of regression that gets
  // blamed on the strategy.
  try {
    const stored = loadStoredCandles(instrument.id, resolution, to - LOOKBACK_SECONDS, to);
    if (stored.length >= MIN_STORED_BARS) {
      return stored.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume ?? 0,
      }));
    }
  } catch {
    // A store read that fails must not take down the live path it was meant to improve.
  }

  try {
    const result = await getNormalizedCandles(instrument, resolution, to - LOOKBACK_SECONDS, to);
    return result.candles.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
  } catch {
    return [];
  }
}

export async function fetchMarketSample(
  market: string,
  resolution: CandleResolution = "D",
): Promise<Readonly<Record<string, readonly Candle[]>>> {
  // Checked here too, not only in the loader: the generation pass calls straight through, and a
  // breaker one caller can walk past is not a breaker.
  if (marketIsCoolingDown(market)) return {};

  const instruments = instrumentsForMarket(market);
  const to = Math.floor(Date.now() / 1000);
  const settled = await Promise.allSettled(
    instruments.map((instrument) => getNormalizedCandles(instrument, resolution, to - LOOKBACK_SECONDS, to)),
  );

  const dataset: Record<string, readonly Candle[]> = {};
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const bars = result.value.candles;
    if (bars.length === 0) return;
    dataset[instruments[index].id] = bars.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }));
  });

  // Every instrument failing is an outage, not a data gap. One instrument failing is a data
  // gap and must not trip the breaker for the rest.
  if (instruments.length > 0 && Object.keys(dataset).length === 0) {
    failedUntil.set(market, Date.now() + COOLDOWN_MS);
  } else {
    failedUntil.delete(market);
  }
  return dataset;
}
