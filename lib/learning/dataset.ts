import { INSTRUMENT_CATALOG } from "@/lib/market/catalog";
import { getNormalizedCandles } from "@/lib/market/service";
import type { StrategyDsl } from "@/lib/strategy/dsl";
import type { Market } from "@/lib/market/types";
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
function instrumentsFor(dsl: StrategyDsl) {
  const market: Market = dsl.universe.market === "US" ? "US" : "IN";
  const exchange = dsl.universe.market === "NSE" ? "XNSE" : dsl.universe.market === "BSE" ? "XBOM" : null;
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
  const instruments = instrumentsFor(dsl);
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
    failedUntil.set(dsl.universe.market, Date.now() + COOLDOWN_MS);
  } else {
    failedUntil.delete(dsl.universe.market);
  }
  return dataset;
}
