import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Forward observations — the only unbiased evidence this system can produce.
 *
 * Every other number here is computed from history the strategy was selected on. A backtest,
 * however careful, grades a hypothesis against data that was already visible when the hypothesis
 * was formed; the gauntlet's deflated Sharpe and PBO exist precisely because that bias is real
 * and large. A forward observation has none of it: the prediction is written down **before** the
 * outcome exists, and the outcome cannot be re-selected.
 *
 * That is why the forward table is empty, and why filling it honestly matters more than any
 * further backtest. It is also why this module is deliberately awkward:
 *
 * - **The risk denominator is fixed at open.** An R-multiple computed with risk measured at exit
 *   lets any loss be rationalised into a smaller one. Recording it up front means the arithmetic
 *   cannot be revised once the answer is known.
 * - **An open observation is not a favourable one.** Unresolved and winning are different facts,
 *   and a record that counts open positions as neither loss nor win drifts optimistic as losers
 *   are left open and winners closed.
 * - **A resolved observation is immutable.** Re-resolving is how a forward record gets laundered.
 * - **Small samples say so.** Forward evidence accumulates slowly — a handful of observations is
 *   the normal state, and the normal state must not read as proof.
 */

/** Below this, the sample cannot distinguish an edge from chance at any useful confidence. */
export const MIN_FORWARD_OBSERVATIONS = 20;

export type ForwardOutcome = "open" | "target" | "stop" | "closed" | "invalidated";

export interface OpenObservation {
  strategySpecId: string;
  instrumentId: string;
  entryPrice: number;
  /** The price at which the idea is wrong. Fixes the R denominator, permanently. */
  stopPrice: number;
  openedAt?: Date;
  source?: string;
}

export interface ForwardRecord {
  observations: number;
  resolved: number;
  open: number;
  wins: number;
  losses: number;
  /** Mean R across *resolved* observations only. Null when nothing has resolved. */
  meanR: number | null;
  /** Standard error of the mean R. Null below two resolved observations. */
  standardError: number | null;
  /**
   * Null until the sample is large enough to mean anything. Deliberately not a number that
   * merely carries wide error bars — a figure on screen gets read as a finding regardless of
   * the caveat beside it.
   */
  winRate: number | null;
  isEvidence: boolean;
  summary: string;
}

function observationId(specId: string, instrumentId: string, openedAt: Date): string {
  return `fwd_${createHash("sha256")
    .update(`${specId}|${instrumentId}|${openedAt.getTime()}`)
    .digest("hex")
    .slice(0, 16)}`;
}

/**
 * Record a prediction before its outcome exists.
 *
 * Refuses a zero-distance stop: with no risk there is no denominator, and an R-multiple divided
 * by zero would arrive as `Infinity` and dominate every average it touched.
 */
export function openForwardObservation(observation: OpenObservation): { id: string } | { error: string } {
  const { strategySpecId, instrumentId, entryPrice, stopPrice } = observation;
  const openedAt = observation.openedAt ?? new Date();

  if (!Number.isFinite(entryPrice) || !Number.isFinite(stopPrice) || entryPrice <= 0 || stopPrice <= 0) {
    return { error: "Entry and stop must both be positive, finite prices." };
  }
  const risk = Math.abs(entryPrice - stopPrice);
  if (risk === 0) {
    return { error: "Entry and stop are identical, so the observation has no risk denominator and no R-multiple can ever be computed for it." };
  }

  const id = observationId(strategySpecId, instrumentId, openedAt);
  getDb()
    .insert(schema.forwardOutcomes)
    .values({
      id,
      strategySpecId,
      instrumentId,
      openedAt,
      outcome: "open",
      // The denominator, stored at open. `rMultiple` stays null until resolution; `externalId`
      // carries the risk so the arithmetic cannot be revised once the answer is known.
      rMultiple: null,
      source: observation.source ?? "manual",
      // Entry and risk, because R = (exit − entry) / risk needs both and the table has a column
      // for neither. Written at open so the arithmetic is fully determined before the outcome is
      // known — the entire guarantee this module makes.
      //
      // The row id leads, because `forward_outcomes` carries a UNIQUE (source, external_id) —
      // two observations sharing an entry and stop would otherwise collide and the second would
      // be silently rejected. Keying on the id makes the value unique by construction.
      externalId: `${id}|${entryPrice}|${risk}`,
      createdAt: new Date(),
    })
    .run();

  return { id };
}

/**
 * Resolve an observation against what actually happened.
 *
 * Refuses to touch one that is already resolved. Re-resolving is not an edge case — it is the
 * single mechanism by which a forward record stops being trustworthy, because the person doing
 * it always has a reason.
 */
export function resolveForwardObservation(
  id: string,
  exitPrice: number,
  outcome: Exclude<ForwardOutcome, "open">,
  resolvedAt = new Date(),
): { rMultiple: number } | { error: string } {
  const db = getDb();
  const row = db.select().from(schema.forwardOutcomes).where(eq(schema.forwardOutcomes.id, id)).all()[0];
  if (!row) return { error: `No forward observation ${id}.` };
  if (row.outcome !== "open") {
    return { error: `Observation ${id} was already resolved as "${row.outcome}". A resolved observation cannot be revised.` };
  }
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return { error: "Exit price must be a positive, finite number." };

  const [, storedEntry, storedRisk] = (row.externalId ?? "").split("|");
  const entry = Number(storedEntry);
  const risk = Number(storedRisk);
  if (!Number.isFinite(entry) || !Number.isFinite(risk) || risk <= 0) {
    return { error: `Observation ${id} has no usable entry and risk, so no R-multiple can be computed. It is recorded but cannot be graded.` };
  }

  // `invalidated` means the setup stopped applying — a halt, a corporate action, a data gap.
  // Grading it as a loss would punish the strategy for something it did not do; grading it as a
  // win is obviously worse. It resolves with a null R and is excluded from the mean entirely.
  //
  // Long-only, because the paper engine opens no short positions. A short book would need the
  // sign flipped here, and guessing direction from the stop's side would silently mis-grade any
  // long whose stop sat above entry.
  const rMultiple = outcome === "invalidated" ? 0 : (exitPrice - entry) / risk;

  db.update(schema.forwardOutcomes)
    .set({ outcome, resolvedAt, rMultiple: outcome === "invalidated" ? null : rMultiple })
    .where(eq(schema.forwardOutcomes.id, id))
    .run();

  return { rMultiple };
}

/**
 * What the forward sample actually supports.
 *
 * `isEvidence` is false below `MIN_FORWARD_OBSERVATIONS` regardless of how good the numbers
 * look, and `winRate` is withheld entirely rather than shown with a caveat — a percentage on a
 * screen is read as a finding no matter what sits next to it.
 */
export function forwardRecord(strategySpecId?: string): ForwardRecord {
  const rows = getDb()
    .select()
    .from(schema.forwardOutcomes)
    .all()
    .filter((row) => (strategySpecId ? row.strategySpecId === strategySpecId : true));

  const open = rows.filter((row) => row.outcome === "open").length;
  const graded = rows.filter((row) => row.outcome !== "open" && row.rMultiple !== null);
  const values = graded.map((row) => row.rMultiple as number);
  const wins = values.filter((value) => value > 0).length;
  const losses = values.filter((value) => value <= 0).length;

  const meanR = values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
  let standardError: number | null = null;
  if (values.length > 1 && meanR !== null) {
    const variance = values.reduce((total, value) => total + (value - meanR) ** 2, 0) / (values.length - 1);
    standardError = Math.sqrt(variance / values.length);
  }

  const isEvidence = graded.length >= MIN_FORWARD_OBSERVATIONS;

  return {
    observations: rows.length,
    resolved: rows.filter((row) => row.outcome !== "open").length,
    open,
    wins,
    losses,
    meanR,
    standardError,
    winRate: isEvidence && values.length > 0 ? wins / values.length : null,
    isEvidence,
    summary:
      rows.length === 0
        ? "No forward observation has been recorded. Every number this system holds is computed from data the strategy was selected on, which is the biased kind. Until something is predicted before its outcome exists, nothing here is unbiased evidence."
        : isEvidence
          ? `${graded.length} resolved observation(s), mean ${meanR?.toFixed(2)}R ± ${standardError?.toFixed(2)}. This is the only unbiased evidence available.`
          : `${graded.length} resolved of ${rows.length} recorded, ${open} still open. Below ${MIN_FORWARD_OBSERVATIONS} resolved observations a sample cannot separate an edge from chance, so no win rate is reported — a percentage on a screen is read as a finding whatever is written beside it.`,
  };
}
