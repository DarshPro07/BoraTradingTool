import { createHash } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { executionContextFor } from "@/lib/broker/execution-profile";
import { CostModelError, FEE_MODEL_ID, roundTripCost } from "@/lib/paper/cost-model";
import { OWNER_CAPITAL } from "@/lib/paper/capital";
import { snapshotFromStore } from "@/lib/research-data/snapshot";
import { StrategyDslSchema, marketOf, type StrategyDsl } from "@/lib/strategy/dsl";
import { RESOLUTION_SECONDS, istMinute } from "./shadow";
import type { Candle } from "@/lib/providers/types";

/**
 * The forward PAPER stage for challengers (WS1b).
 *
 * Shadow asked "does the signal survive unseen data?". Paper asks the harder question: "does it
 * survive CAPITAL?" — sizing at the owner's real validation cash (default ₹1,000, never a
 * flattering crore), position limits, broker cutoffs, fees, and competing signals on one account.
 *
 * ## Three ledgers, never blended
 *
 * - `execution_intents` — what was decided, with account state at decision time. A REJECT row is
 *   first-class evidence: "the signal was valid; the order was not placed because capital was
 *   insufficient" is exactly the finding this stage exists to produce.
 * - `paper_forward_orders` — the order lifecycle. Identity frozen, terminal states final.
 * - `paper_position_outcomes` — what happened, append-only.
 *
 * Intent values are NEVER overwritten by fills; expected-vs-simulated (and one day vs-real-Kite)
 * needs both sides preserved.
 *
 * ## Determinism
 *
 * Bar-time only, driven by the same canonical store as shadow. Entries fill at the NEXT bar's
 * open after the decision (no same-bar lookahead) plus slippage; a store with no later bar means
 * the order simply waits — an outage cannot invent a fill.
 */

const SLIPPAGE_RATE: Record<string, number> = { US: 0.0005, IN: 0.0008 };

export type EnrollResult =
  | { ok: true; challengerId: string; startingCash: number }
  | { ok: false; code: "CHALLENGER_NOT_FOUND" | "NOT_ACTIVE" | "ALREADY_ENROLLED"; message: string };

/** Enroll an ACTIVE challenger with real validation capital. One account per challenger, ever. */
export function enrollChallengerInPaper(
  challengerId: string,
  actor: string,
  startingCash: number = OWNER_CAPITAL.amount,
  now = new Date(),
): EnrollResult {
  const db = getDb();
  const challenger = db
    .select()
    .from(schema.forwardChallengers)
    .where(eq(schema.forwardChallengers.id, challengerId))
    .get();
  if (!challenger) return { ok: false, code: "CHALLENGER_NOT_FOUND", message: `No challenger ${challengerId}.` };
  if (challenger.status !== "ACTIVE") {
    return { ok: false, code: "NOT_ACTIVE", message: `Challenger ${challengerId} is ${challenger.status}; only ACTIVE challengers enroll.` };
  }
  const existing = db
    .select()
    .from(schema.paperForwardAccounts)
    .where(eq(schema.paperForwardAccounts.challengerId, challengerId))
    .get();
  if (existing) {
    return {
      ok: false,
      code: "ALREADY_ENROLLED",
      message: `Challenger ${challengerId} already has a paper account (₹${existing.startingCash}). A new strategy version gets a new challenger and a fresh account — results are never inherited.`,
    };
  }
  db.insert(schema.paperForwardAccounts)
    .values({
      challengerId,
      currency: challenger.market === "US" ? "USD" : "INR",
      startingCash,
      cash: startingCash,
      enrolledAt: Math.floor(now.getTime() / 1000),
      enrolledBy: actor,
    })
    .run();
  return { ok: true, challengerId, startingCash };
}

export interface PaperPassReport {
  accountsEvaluated: number;
  intentsRecorded: number;
  ordersFilled: number;
  positionsClosed: number;
  rejects: Record<string, number>;
  skipped: string[];
  summary: string;
}

/**
 * One paper pass: close what the market has decided, then decide newly-arrived signals.
 * Everything is read from and written to the database — a restart loses nothing.
 */
export function runPaperPass(asOf = new Date()): PaperPassReport {
  const db = getDb();
  const asOfSeconds = Math.floor(asOf.getTime() / 1000);
  const accounts = db.select().from(schema.paperForwardAccounts).all();

  const skipped: string[] = [];
  const rejects: Record<string, number> = {};
  let intentsRecorded = 0;
  let ordersFilled = 0;
  let positionsClosed = 0;

  const datasets = new Map<string, ReturnType<typeof snapshotFromStore>>();

  for (const account of accounts) {
    const challenger = db
      .select()
      .from(schema.forwardChallengers)
      .where(eq(schema.forwardChallengers.id, account.challengerId))
      .get();
    if (!challenger || challenger.status !== "ACTIVE") continue;
    const spec = db
      .select()
      .from(schema.strategySpecs)
      .where(eq(schema.strategySpecs.id, challenger.strategySpecId))
      .get();
    const parsed = spec ? StrategyDslSchema.safeParse(JSON.parse(spec.dsl)) : null;
    if (!parsed?.success) {
      skipped.push(`${challenger.id}: stored DSL no longer parses; paper account left untouched.`);
      continue;
    }
    const dsl = parsed.data;

    const key = `${challenger.market}|${challenger.resolution}`;
    if (!datasets.has(key)) datasets.set(key, snapshotFromStore(dsl.universe.market, challenger.resolution, "paper-forward"));
    const snapshot = datasets.get(key)!;
    if (!snapshot.ok) {
      skipped.push(`${challenger.id}: ${snapshot.message}`);
      continue;
    }

    const barSeconds = RESOLUTION_SECONDS[challenger.resolution] ?? 86_400;
    let cash = account.cash;

    // 1. Close what the market has decided (fills without an outcome yet).
    const closed = closeDecidedPositions(challenger.id, dsl, snapshot.dataset, barSeconds, asOfSeconds, cash);
    positionsClosed += closed.closed;
    cash = closed.cash;

    // 2. Fill accepted orders whose next bar has arrived.
    const filled = fillAcceptedOrders(challenger.id, dsl, snapshot.dataset, asOfSeconds, cash);
    ordersFilled += filled.filled;
    cash = filled.cash;

    // 3. Decide newly-arrived signals with the running cash.
    const decided = decideNewSignals(challenger.id, dsl, challenger, snapshot.dataset, barSeconds, asOfSeconds, cash);
    intentsRecorded += decided.intents;
    for (const [reason, count] of Object.entries(decided.rejects)) rejects[reason] = (rejects[reason] ?? 0) + count;
    cash = decided.cash;

    // 4. Fill what step 3 just accepted, when its bar already exists (deterministic replays).
    const lateFills = fillAcceptedOrders(challenger.id, dsl, snapshot.dataset, asOfSeconds, cash);
    ordersFilled += lateFills.filled;
    cash = lateFills.cash;

    // 5. And close what those fills have already decided — one pass over a settled history must
    // reach the same end state as many passes over a live one.
    const lateCloses = closeDecidedPositions(challenger.id, dsl, snapshot.dataset, barSeconds, asOfSeconds, cash);
    positionsClosed += lateCloses.closed;
    cash = lateCloses.cash;

    if (cash !== account.cash) {
      db.update(schema.paperForwardAccounts)
        .set({ cash })
        .where(eq(schema.paperForwardAccounts.challengerId, account.challengerId))
        .run();
    }
  }

  const rejectTotal = Object.values(rejects).reduce((total, count) => total + count, 0);
  return {
    accountsEvaluated: accounts.length,
    intentsRecorded,
    ordersFilled,
    positionsClosed,
    rejects,
    skipped,
    summary:
      accounts.length === 0
        ? "No challenger is enrolled in the paper stage."
        : `Paper pass: ${intentsRecorded} intent(s) decided (${rejectTotal} rejected — rejections are evidence), ` +
          `${ordersFilled} order(s) filled, ${positionsClosed} position(s) closed.`,
  };
}

function intentId(signalId: string): string {
  return `int_${createHash("sha256").update(signalId).digest("hex").slice(0, 16)}`;
}

function decideNewSignals(
  challengerId: string,
  dsl: StrategyDsl,
  challenger: typeof schema.forwardChallengers.$inferSelect,
  dataset: Readonly<Record<string, readonly Candle[]>>,
  barSeconds: number,
  asOfSeconds: number,
  startingCash: number,
): { intents: number; rejects: Record<string, number>; cash: number } {
  const db = getDb();
  let cash = startingCash;
  const rejects: Record<string, number> = {};
  let intents = 0;

  const undecided = db
    .select({ signal: schema.forwardSignals })
    .from(schema.forwardSignals)
    .leftJoin(schema.executionIntents, eq(schema.executionIntents.signalId, schema.forwardSignals.id))
    .where(eq(schema.forwardSignals.challengerId, challengerId))
    .all()
    .filter((row) => row.signal.eventTime <= asOfSeconds)
    .map((row) => row.signal)
    .filter((signal, _, all) => {
      void all;
      return !db.select().from(schema.executionIntents).where(eq(schema.executionIntents.signalId, signal.id)).get();
    })
    .sort((a, b) => a.eventTime - b.eventTime);

  const intraday = challenger.resolution !== "D";
  const execution = intraday ? executionContextFor(dsl.universe.market, challenger.resolution, new Date(asOfSeconds * 1000)) : null;
  const squareOffMinute = execution?.available ? execution.profile.mandatoryExitMinute ?? null : null;

  for (const signal of undecided) {
    const record = (decision: "EXECUTE" | "REJECT", rejectReason: string | null, quantity: number, riskBudget: number) => {
      const id = intentId(signal.id);
      const fingerprint = createHash("sha256")
        .update(`${id}|${signal.id}|${decision}|${rejectReason ?? ""}|${quantity}|${cash}`)
        .digest("hex")
        .slice(0, 24);
      try {
        db.insert(schema.executionIntents)
          .values({
            id,
            signalId: signal.id,
            challengerId,
            instrumentId: signal.instrumentId,
            decisionTime: signal.eventTime + barSeconds,
            side: "BUY",
            desiredQuantity: quantity,
            orderType: "MARKET",
            expectedPrice: signal.entryPrice,
            stopPrice: signal.stopPrice,
            targetPrice: signal.targetPrice,
            capitalBefore: cash,
            riskBudget,
            brokerProfileId: challenger.executionProfileId,
            feeModelId: challenger.feeModelId,
            decision,
            rejectReason,
            fingerprint,
          })
          .run();
        intents += 1;
        if (decision === "REJECT" && rejectReason) rejects[rejectReason] = (rejects[rejectReason] ?? 0) + 1;
        if (decision === "EXECUTE") {
          db.insert(schema.paperForwardOrders)
            .values({
              intentId: id,
              challengerId,
              instrumentId: signal.instrumentId,
              acceptedAt: signal.eventTime + barSeconds,
              status: "ACCEPTED",
              filledQuantity: 0,
              updatedAt: asOfSeconds,
            })
            .run();
        }
      } catch (caught) {
        // UNIQUE(signal_id): another pass (or a restart replay) already decided this signal.
        if (!/UNIQUE constraint failed/i.test(caught instanceof Error ? caught.message : "")) throw caught;
      }
    };

    const bars = dataset[signal.instrumentId];
    if (!bars || bars.length === 0) {
      record("REJECT", "INSTRUMENT_UNTRADABLE", 0, 0);
      continue;
    }
    // Data freshness: the fill bar (next after the signal) must exist within two bars, or the
    // signal is stale by the time paper could act — refuse rather than fill on old prices.
    const fillBar = bars.find((bar) => bar.time > signal.eventTime);
    if (!fillBar || fillBar.time - signal.eventTime > 2 * barSeconds) {
      record("REJECT", "DATA_STALE", 0, 0);
      continue;
    }
    if (intraday && squareOffMinute === null) {
      record("REJECT", "EXECUTION_PROFILE_UNAVAILABLE", 0, 0);
      continue;
    }
    if (intraday && squareOffMinute !== null && istMinute(signal.eventTime, barSeconds) >= squareOffMinute - 1) {
      record("REJECT", "AFTER_BROKER_CUTOFF", 0, 0);
      continue;
    }
    try {
      roundTripCost({
        market: marketOf(dsl.universe.market),
        notional: Math.max(1_000, signal.entryPrice),
        product: intraday ? "INTRADAY" : "DELIVERY",
        at: new Date(signal.eventTime * 1000),
      });
    } catch (caught) {
      if (caught instanceof CostModelError) {
        record("REJECT", "FEES_UNPRICEABLE", 0, 0);
        continue;
      }
      throw caught;
    }
    const openPositions = db
      .select()
      .from(schema.paperForwardOrders)
      .where(eq(schema.paperForwardOrders.challengerId, challengerId))
      .all()
      .filter((order) => order.status === "FILLED" || order.status === "ACCEPTED")
      .filter((order) => !db.select().from(schema.paperPositionOutcomes).where(eq(schema.paperPositionOutcomes.intentId, order.intentId)).get());
    if (openPositions.some((order) => order.instrumentId === signal.instrumentId)) {
      record("REJECT", "ALREADY_IN_POSITION", 0, 0);
      continue;
    }
    if (openPositions.length >= dsl.universe.maxPositions) {
      record("REJECT", "POSITION_LIMIT", 0, 0);
      continue;
    }
    const riskBudget = (cash * dsl.sizing.maxPositionPct) / 100;
    const quantity = Math.floor(riskBudget / signal.entryPrice);
    if (quantity < 1) {
      // The finding this stage exists to produce: the signal was valid; capital was not.
      record("REJECT", "INSUFFICIENT_CAPITAL", 0, riskBudget);
      continue;
    }
    record("EXECUTE", null, quantity, riskBudget);
  }

  return { intents, rejects, cash };
}

function fillAcceptedOrders(
  challengerId: string,
  dsl: StrategyDsl,
  dataset: Readonly<Record<string, readonly Candle[]>>,
  asOfSeconds: number,
  startingCash: number,
): { filled: number; cash: number } {
  const db = getDb();
  let cash = startingCash;
  let filled = 0;
  const slippageRate = SLIPPAGE_RATE[marketOf(dsl.universe.market)] ?? 0.0008;

  const accepted = db
    .select()
    .from(schema.paperForwardOrders)
    .where(eq(schema.paperForwardOrders.challengerId, challengerId))
    .all()
    .filter((order) => order.status === "ACCEPTED");

  for (const order of accepted) {
    const intent = db.select().from(schema.executionIntents).where(eq(schema.executionIntents.id, order.intentId)).get();
    if (!intent) continue;
    const bars = dataset[order.instrumentId] ?? [];
    const fillBar = bars.find((bar) => bar.time >= intent.decisionTime && bar.time <= asOfSeconds);
    if (!fillBar) continue; // no bar yet — an outage or a quiet store never invents a fill

    const fillPrice = round4(fillBar.open * (1 + slippageRate));
    const notional = fillPrice * intent.desiredQuantity;
    let entryFees = 0;
    try {
      const trip = roundTripCost({
        market: marketOf(dsl.universe.market),
        notional,
        product: dsl.universe.resolution === "D" ? "DELIVERY" : "INTRADAY",
        at: new Date(fillBar.time * 1000),
      });
      entryFees = round4(trip.total / 2);
    } catch {
      entryFees = 0; // priceability was checked at intent time; a gap here still cannot block the ledger
    }
    const required = notional + entryFees;
    if (required > cash + 1e-6) {
      // Cash moved between decision and fill (a competing fill won the race): reject terminally.
      db.update(schema.paperForwardOrders)
        .set({ status: "REJECTED", reason: "INSUFFICIENT_CASH_AT_FILL", updatedAt: asOfSeconds })
        .where(eq(schema.paperForwardOrders.intentId, order.intentId))
        .run();
      continue;
    }
    cash = round4(cash - required);
    db.update(schema.paperForwardOrders)
      .set({
        status: "FILLED",
        fillTime: fillBar.time,
        fillPrice,
        filledQuantity: intent.desiredQuantity,
        fees: entryFees,
        slippage: round4(fillPrice - fillBar.open),
        updatedAt: asOfSeconds,
      })
      .where(eq(schema.paperForwardOrders.intentId, order.intentId))
      .run();
    filled += 1;
  }
  return { filled, cash };
}

function closeDecidedPositions(
  challengerId: string,
  dsl: StrategyDsl,
  dataset: Readonly<Record<string, readonly Candle[]>>,
  barSeconds: number,
  asOfSeconds: number,
  startingCash: number,
): { closed: number; cash: number } {
  const db = getDb();
  let cash = startingCash;
  let closed = 0;
  const intraday = dsl.universe.resolution !== "D";
  const execution = intraday ? executionContextFor(dsl.universe.market, dsl.universe.resolution, new Date(asOfSeconds * 1000)) : null;
  const squareOffMinute = execution?.available ? execution.profile.mandatoryExitMinute ?? null : null;
  const horizonBars = dsl.exit.afterDays ?? (intraday ? 75 : 20);

  const openFills = db
    .select()
    .from(schema.paperForwardOrders)
    .where(eq(schema.paperForwardOrders.challengerId, challengerId))
    .all()
    .filter((order) => order.status === "FILLED")
    .filter((order) => !db.select().from(schema.paperPositionOutcomes).where(eq(schema.paperPositionOutcomes.intentId, order.intentId)).get());

  for (const order of openFills) {
    const intent = db.select().from(schema.executionIntents).where(eq(schema.executionIntents.id, order.intentId)).get();
    if (!intent || order.fillTime === null || order.fillPrice === null) continue;
    const bars = (dataset[order.instrumentId] ?? []).filter((bar) => bar.time > order.fillTime! && bar.time <= asOfSeconds);
    if (bars.length === 0) continue;

    let exit: { price: number; time: number; reason: string } | null = null;
    let mfe = 0;
    let mae = 0;
    for (let held = 0; held < bars.length; held += 1) {
      const bar = bars[held];
      mfe = Math.max(mfe, (bar.high - order.fillPrice) / order.fillPrice);
      mae = Math.min(mae, (bar.low - order.fillPrice) / order.fillPrice);
      if (intent.stopPrice !== null && bar.low <= intent.stopPrice) {
        exit = { price: Math.min(bar.open, intent.stopPrice), time: bar.time, reason: "stop" };
        break;
      }
      if (intent.targetPrice !== null && bar.high >= intent.targetPrice) {
        exit = { price: intent.targetPrice, time: bar.time, reason: "target" };
        break;
      }
      if (intraday && squareOffMinute !== null && istMinute(bar.time, barSeconds) >= squareOffMinute) {
        exit = { price: bar.close, time: bar.time, reason: "square_off" };
        break;
      }
      if (held + 1 >= horizonBars) {
        exit = { price: bar.close, time: bar.time, reason: "horizon" };
        break;
      }
    }
    if (!exit) continue;

    const quantity = order.filledQuantity;
    const proceeds = exit.price * quantity;
    let exitFees = 0;
    try {
      const trip = roundTripCost({
        market: marketOf(dsl.universe.market),
        notional: proceeds,
        product: intraday ? "INTRADAY" : "DELIVERY",
        at: new Date(exit.time * 1000),
      });
      exitFees = round4(trip.total / 2);
    } catch {
      exitFees = 0;
    }
    const grossPnl = round4((exit.price - order.fillPrice) * quantity);
    const totalFees = round4((order.fees ?? 0) + exitFees);
    const netPnl = round4(grossPnl - totalFees);
    const capitalAfter = round4(cash + proceeds - exitFees);
    const fingerprint = createHash("sha256")
      .update(`${order.intentId}|${exit.price}|${exit.time}|${exit.reason}|${netPnl}`)
      .digest("hex")
      .slice(0, 24);

    try {
      db.insert(schema.paperPositionOutcomes)
        .values({
          intentId: order.intentId,
          challengerId,
          instrumentId: order.instrumentId,
          entryTime: order.fillTime,
          entryPrice: order.fillPrice,
          quantity,
          exitTime: exit.time,
          exitPrice: exit.price,
          exitReason: exit.reason,
          mfe,
          mae,
          grossPnl,
          fees: totalFees,
          netPnl,
          capitalAfter,
          fingerprint,
        })
        .run();
      cash = capitalAfter; // funds change exactly once per close — the PK above is the guard
      closed += 1;
    } catch (caught) {
      if (!/UNIQUE constraint failed|PRIMARY KEY/i.test(caught instanceof Error ? caught.message : "")) throw caught;
    }
  }
  return { closed, cash };
}

export interface PaperScorecard {
  challengerId: string;
  currency: string;
  startingCash: number;
  cash: number;
  intents: number;
  executed: number;
  rejected: number;
  rejectReasons: Record<string, number>;
  openOrders: number;
  openPositions: number;
  closedPositions: number;
  netPnl: number;
  totalFees: number;
}

/** The paper record for one challenger — a strictly separate ledger from the shadow scorecard. */
export function paperScorecard(challengerId: string): PaperScorecard | null {
  const db = getDb();
  const account = db
    .select()
    .from(schema.paperForwardAccounts)
    .where(eq(schema.paperForwardAccounts.challengerId, challengerId))
    .get();
  if (!account) return null;

  const intents = db.select().from(schema.executionIntents).where(eq(schema.executionIntents.challengerId, challengerId)).all();
  const orders = db.select().from(schema.paperForwardOrders).where(eq(schema.paperForwardOrders.challengerId, challengerId)).all();
  const outcomes = db
    .select()
    .from(schema.paperPositionOutcomes)
    .where(eq(schema.paperPositionOutcomes.challengerId, challengerId))
    .all();

  const rejectReasons: Record<string, number> = {};
  for (const intent of intents) {
    if (intent.decision === "REJECT" && intent.rejectReason) {
      rejectReasons[intent.rejectReason] = (rejectReasons[intent.rejectReason] ?? 0) + 1;
    }
  }
  const outcomeIds = new Set(outcomes.map((outcome) => outcome.intentId));

  return {
    challengerId,
    currency: account.currency,
    startingCash: account.startingCash,
    cash: account.cash,
    intents: intents.length,
    executed: intents.filter((intent) => intent.decision === "EXECUTE").length,
    rejected: intents.filter((intent) => intent.decision === "REJECT").length,
    rejectReasons,
    openOrders: orders.filter((order) => order.status === "ACCEPTED").length,
    openPositions: orders.filter((order) => order.status === "FILLED" && !outcomeIds.has(order.intentId)).length,
    closedPositions: outcomes.length,
    netPnl: round4(outcomes.reduce((total, outcome) => total + outcome.netPnl, 0)),
    totalFees: round4(outcomes.reduce((total, outcome) => total + outcome.fees, 0)),
  };
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}
