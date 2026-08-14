import { subscribe } from "@/lib/brain/event-bus";
import { loadStoredCandles } from "@/lib/market/candle-store";
import { quantCoreRoot } from "@/lib/quantcore/filesystem";
import { scoreDueForecasts, type BarLoader, type LiveScoreReport } from "./live";

/**
 * The Forecast Resolver — predictions mature when bars arrive, not when a poll notices.
 *
 * ## The wake pattern
 *
 * Forecast grading ran only inside the learning cycle: once a minute, in learning mode or above,
 * with a PROVIDER-backed loader. A prediction matured by freshly-ingested history therefore
 * waited for the next cycle to happen to look — and the look reached the network for bars the
 * canonical store already held. This module is the event-driven half the feedback specified:
 *
 *   BAR_COMMITTED (DATA_INGESTED)
 *     → which predictions have now matured?
 *     → resolve them
 *     → the pooled verdict wakes on its own threshold
 *
 * The cycle's scheduled pass stays — it covers bars that arrive through paths that do not emit
 * (and forecasts whose bars were never ingested locally). The two are idempotent against each
 * other: grading is ledger-deduped in `scoreDueForecasts`, so a forecast graded here is skipped
 * there and vice versa.
 *
 * ## Store-only, by construction
 *
 * The event fires inside the ingestion call path, so the resolver must never reach the network:
 * it reads the canonical store and nothing else. A pending forecast whose bars are not stored
 * simply stays pending for the cycle's provider-backed pass. Missing is not zero — and not a
 * fetch either.
 */

/** Bars from the canonical store only. `_timeframe` is honoured as daily, matching the cycle's loader. */
export const storeBarLoader: BarLoader = async (instrumentId, _timeframe) => {
  return loadStoredCandles(instrumentId, "D").map((bar) => ({ time: bar.time, close: bar.close }));
};

/** Grade every archived forecast the canonical store can now resolve. */
export function resolveMaturedForecasts(root = quantCoreRoot()): Promise<LiveScoreReport> {
  return scoreDueForecasts(storeBarLoader, root);
}

const REGISTERED = Symbol.for("marketpulse.forecast.resolver");

interface ResolverRegistration {
  dispose: () => void;
  /** The most recent grading pass, awaitable so tests never race the fire-and-forget. */
  lastRun: Promise<LiveScoreReport> | null;
}

function registrationStore(): Record<symbol, ResolverRegistration | undefined> {
  return globalThis as unknown as Record<symbol, ResolverRegistration | undefined>;
}

/**
 * Subscribe the resolver to bar arrivals. Idempotent per process — a module reload or a second
 * caller reuses the live registration rather than stacking subscribers (the same `globalThis`
 * discipline the supervisor's ticker uses, for the same Next.js reload reason).
 */
export function registerForecastResolver(root = quantCoreRoot()): () => void {
  const store = registrationStore();
  const existing = store[REGISTERED];
  if (existing) return existing.dispose;

  const registration: ResolverRegistration = { dispose: () => {}, lastRun: null };
  const unsubscribe = subscribe("DATA_INGESTED", (event) => {
    if (event.kind !== "DATA_INGESTED") return;
    // Knowledge-source ingestion reuses this event kind with a placeholder id; only canonical
    // market instruments (market:exchange:symbol) can mature a price forecast.
    if (!event.instrumentId.includes(":")) return;
    registration.lastRun = resolveMaturedForecasts(root).catch((caught) => {
      // A grading failure must never propagate into the publisher (the ingestion call path).
      // The archive is intact and the cycle's scheduled pass retries; report emptiness honestly.
      return {
        scored: 0,
        pending: 0,
        scoredBars: 0,
        droppedAsLookahead: 0,
        verdict: null,
        reason: `Forecast resolution failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      } satisfies LiveScoreReport;
    });
  });

  registration.dispose = () => {
    unsubscribe();
    delete store[REGISTERED];
  };
  store[REGISTERED] = registration;
  return registration.dispose;
}

/** The in-flight (or last) event-driven grading pass — for tests and diagnostics. */
export function lastResolverRun(): Promise<LiveScoreReport> | null {
  return registrationStore()[REGISTERED]?.lastRun ?? null;
}
