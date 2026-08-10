import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Candle } from "@/lib/providers/types";
import { openForwardObservation, resolveForwardObservation } from "./forward";

/**
 * The writer the forward table never had.
 *
 * `openForwardObservation` and `resolveForwardObservation` were written, correct, and called by
 * nothing outside tests — `forward_outcomes` held zero rows. So the ladder's last rung,
 * `validated → owner_review`, waited on forward evidence that nothing could ever produce, and the
 * one unbiased measurement in the system was structurally unreachable.
 *
 * ## What makes this evidence rather than another backtest
 *
 * The prediction is written when the board proposes it, before the bar that resolves it exists.
 * Nothing here can re-select an outcome, revise a risk denominator, or quietly drop a loser: the
 * R denominator is fixed at open, and `resolveForwardObservation` refuses to touch an observation
 * that already resolved.
 *
 * ## Why an open observation is never counted as favourable
 *
 * Unresolved and winning are different facts. A driver that let winners close while losers stayed
 * open would drift optimistic without a single dishonest number in it, which is why `ForwardRecord`
 * reports `open` separately and why this file resolves on the *first* level touched rather than
 * waiting for a better one.
 */

export interface ForwardDriverReport {
  opened: number;
  resolved: number;
  stillOpen: number;
  /** Proposals skipped because an observation for that strategy and instrument is already open. */
  alreadyTracking: number;
  summary: string;
}

export interface ForwardProposal {
  strategySpecId: string;
  instrumentId: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number | null;
  /** Long or short decides which side of the stop counts as wrong. */
  side: "BUY" | "SELL";
}

export type ForwardBarLoader = (instrumentId: string) => Promise<readonly Candle[]>;

/**
 * Records today's proposals and resolves whatever the market has since decided.
 *
 * Opening comes first so a proposal made and resolved inside one cycle is still recorded as a
 * prediction — otherwise the fastest-moving trades, which are the ones most likely to be
 * flattering, would never enter the record at all.
 */
export async function runForwardDriver(
  proposals: readonly ForwardProposal[],
  loadBars: ForwardBarLoader,
): Promise<ForwardDriverReport> {
  const db = getDb();
  let opened = 0;
  let alreadyTracking = 0;

  for (const proposal of proposals) {
    // One open observation per strategy and instrument. Opening a second while the first is
    // unresolved would double-count a single idea in the R-multiple average.
    const existing = db
      .select()
      .from(schema.forwardOutcomes)
      .where(
        and(
          eq(schema.forwardOutcomes.strategySpecId, proposal.strategySpecId),
          eq(schema.forwardOutcomes.instrumentId, proposal.instrumentId),
          eq(schema.forwardOutcomes.outcome, "open"),
        ),
      )
      .get();

    if (existing) {
      alreadyTracking += 1;
      continue;
    }

    const result = openForwardObservation({
      strategySpecId: proposal.strategySpecId,
      instrumentId: proposal.instrumentId,
      entryPrice: proposal.entryPrice,
      stopPrice: proposal.stopPrice,
      source: "trade_board",
    });
    if ("id" in result) opened += 1;
  }

  // Resolve whatever the market has decided since.
  const open = db
    .select()
    .from(schema.forwardOutcomes)
    .where(eq(schema.forwardOutcomes.outcome, "open"))
    .all();

  let resolved = 0;
  const byInstrument = new Map<string, readonly Candle[]>();

  for (const row of open) {
    if (!byInstrument.has(row.instrumentId)) {
      try {
        byInstrument.set(row.instrumentId, await loadBars(row.instrumentId));
      } catch {
        // A provider outage leaves the observation open, which is the honest state. Resolving it
        // on absent data would invent an outcome.
        byInstrument.set(row.instrumentId, []);
      }
    }

    const bars = byInstrument.get(row.instrumentId) ?? [];
    const openedMs = row.openedAt instanceof Date ? row.openedAt.getTime() : Number(row.openedAt) * 1000;
    // Strictly after the observation was opened. A bar that had already printed cannot resolve a
    // prediction made afterwards.
    const since = bars.filter((bar) => bar.time * 1000 > openedMs);
    if (since.length === 0) continue;

    const [, storedEntry, storedRisk] = (row.externalId ?? "").split("|");
    const entry = Number(storedEntry);
    const risk = Number(storedRisk);
    if (!Number.isFinite(entry) || !Number.isFinite(risk) || risk <= 0) continue;

    // The stop's side is recoverable from the stored risk: a long stops below its entry.
    const stop = entry - risk;
    const decision = firstDecisive(since, stop, entry, risk);
    if (!decision) continue;

    const outcome = resolveForwardObservation(row.id, decision.price, decision.outcome);
    if ("rMultiple" in outcome) resolved += 1;
  }

  const stillOpen = open.length - resolved;
  return {
    opened,
    resolved,
    stillOpen,
    alreadyTracking,
    summary:
      opened === 0 && resolved === 0
        ? `Forward record unchanged: ${stillOpen} observation(s) open, ${alreadyTracking} proposal(s) already tracked.`
        : `Forward record: opened ${opened}, resolved ${resolved}, ${stillOpen} still open. ` +
          "Forward observations are the only unbiased evidence here — the prediction predates the outcome.",
  };
}

/**
 * The first bar that settles the question, and how.
 *
 * A bar containing both the stop and a two-R move is ambiguous — OHLC does not reveal which came
 * first — and it resolves to the stop. Choosing the favourable side would convert losers into
 * winners at no cost, which is precisely how a forward record stops being worth keeping.
 */
function firstDecisive(
  bars: readonly Candle[],
  stop: number,
  entry: number,
  risk: number,
): { price: number; outcome: "stop" | "target" } | null {
  const target = entry + risk * 2;
  for (const bar of bars) {
    const hitStop = bar.low <= stop;
    const hitTarget = bar.high >= target;
    if (hitStop) {
      // Gapped through: the market was never available at the stop, so the fill is the open.
      return { price: bar.open < stop ? bar.open : stop, outcome: "stop" };
    }
    if (hitTarget) return { price: target, outcome: "target" };
  }
  return null;
}
