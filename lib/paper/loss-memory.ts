import { asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Loss memory — what the system lost, why, and what it does about it.
 *
 * The owner's requirement, stated plainly: *"whenever the model loses, like it lost 20 rupees
 * today, it should adjust itself and add in memory that I lost this and I should do this."*
 *
 * Two design decisions carry most of the weight.
 *
 * **Reconstructed, not recorded separately.** Closed trades are derived by replaying filled
 * orders through the same average-cost rule the paper repository uses. A parallel loss table
 * would be a second source of truth about the same money, and the two would eventually
 * disagree — at which point neither is trustworthy. `reconciles()` asserts the agreement.
 *
 * **Adaptation only ever tightens.** A system that can widen its own ceilings after a bad run
 * is a system that can trade its way out of a drawdown, which is how small losses become large
 * ones. The owner's ceilings are the maximum; loss memory can only move inside them.
 */

export interface ClosedTrade {
  instrumentId: string;
  currency: string;
  quantity: number;
  /** Average cost of the units sold, at the moment they were sold. */
  entryCost: number;
  exitPrice: number;
  fees: number;
  /** Negative is a loss. Net of fees, because a "small loss" that is entirely fees is a
   *  different problem from one caused by the market moving. */
  realised: number;
  closedAt: Date;
  /** Whatever the order recorded as its reason. Null when nothing attributed it. */
  cause: string | null;
}

export interface LossCause {
  cause: string;
  count: number;
  /** Total realised across this cause. Negative. */
  total: number;
  lastAt: Date;
  /** Three occurrences is a pattern, not bad luck — the same threshold introspection uses. */
  isPattern: boolean;
}

export interface LossLedger {
  trades: ClosedTrade[];
  losses: ClosedTrade[];
  byCause: LossCause[];
  /** Net realised across every closed trade. Positive means the record is profitable. */
  netRealised: number;
  /** Sum of the losing trades only. Negative or zero. */
  grossLoss: number;
  worst: ClosedTrade | null;
  /** Realised today, in the account's own currency terms. */
  realisedToday: number;
  currency: string | null;
}

export const PATTERN_THRESHOLD = 3;
const UNATTRIBUTED = "unattributed";

/**
 * Replays filled orders into closed trades.
 *
 * Deliberately mirrors `lib/paper/repository.ts`: buys move the average cost, sells realise
 * `(fill - averageCost) * quantity - fees`. Selling more than is held is clamped rather than
 * producing a phantom short, because the paper engine does not open shorts.
 */
export function closedTrades(): ClosedTrade[] {
  const orders = getDb()
    .select()
    .from(schema.paperOrders)
    .orderBy(asc(schema.paperOrders.id))
    .all()
    .filter((order) => order.status === "filled" && order.fillPrice !== null && order.filledAt !== null);

  const book = new Map<string, { quantity: number; averageCost: number }>();
  const closed: ClosedTrade[] = [];

  for (const order of orders) {
    const fill = order.fillPrice as number;
    const held = book.get(order.instrumentId) ?? { quantity: 0, averageCost: 0 };

    if (order.side === "BUY") {
      const total = held.quantity * held.averageCost + fill * order.quantity + order.fees;
      const quantity = held.quantity + order.quantity;
      book.set(order.instrumentId, { quantity, averageCost: quantity > 0 ? total / quantity : 0 });
      continue;
    }

    // A sell with nothing held cannot realise anything. Recording one would invent a trade.
    const sold = Math.min(order.quantity, held.quantity);
    if (sold <= 0) continue;

    closed.push({
      instrumentId: order.instrumentId,
      currency: order.currency,
      quantity: sold,
      entryCost: held.averageCost,
      exitPrice: fill,
      fees: order.fees,
      realised: (fill - held.averageCost) * sold - order.fees,
      closedAt: order.filledAt as Date,
      cause: order.reason,
    });

    const remaining = held.quantity - sold;
    book.set(order.instrumentId, { quantity: remaining, averageCost: remaining > 1e-9 ? held.averageCost : 0 });
  }

  return closed;
}

export function lossLedger(now = new Date()): LossLedger {
  const trades = closedTrades();
  const losses = trades.filter((trade) => trade.realised < 0);

  const grouped = new Map<string, { count: number; total: number; lastAt: Date }>();
  for (const loss of losses) {
    const key = loss.cause?.trim() || UNATTRIBUTED;
    const existing = grouped.get(key);
    grouped.set(key, {
      count: (existing?.count ?? 0) + 1,
      total: (existing?.total ?? 0) + loss.realised,
      lastAt: existing && existing.lastAt > loss.closedAt ? existing.lastAt : loss.closedAt,
    });
  }

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  return {
    trades,
    losses,
    byCause: [...grouped.entries()]
      .map(([cause, value]) => ({ cause, ...value, isPattern: value.count >= PATTERN_THRESHOLD }))
      // Largest loss first: the biggest hole is the one worth explaining, not the most frequent.
      .sort((a, b) => a.total - b.total),
    netRealised: trades.reduce((sum, trade) => sum + trade.realised, 0),
    grossLoss: losses.reduce((sum, trade) => sum + trade.realised, 0),
    worst: losses.reduce<ClosedTrade | null>(
      (worst, trade) => (worst === null || trade.realised < worst.realised ? trade : worst),
      null,
    ),
    realisedToday: trades
      .filter((trade) => trade.closedAt >= midnight)
      .reduce((sum, trade) => sum + trade.realised, 0),
    currency: trades[0]?.currency ?? null,
  };
}

/**
 * Confirms the reconstruction agrees with the position rows the paper engine wrote.
 *
 * Exported because a silent disagreement between two views of the same money is worse than
 * either being wrong on its own — you would not know which to believe.
 */
export function reconciles(tolerance = 0.01): { ok: boolean; drift: Record<string, number> } {
  const reconstructed = new Map<string, number>();
  for (const trade of closedTrades()) {
    reconstructed.set(trade.instrumentId, (reconstructed.get(trade.instrumentId) ?? 0) + trade.realised);
  }

  const drift: Record<string, number> = {};
  for (const position of getDb().select().from(schema.paperPositions).all()) {
    const difference = (reconstructed.get(position.instrumentId) ?? 0) - position.realizedPnl;
    if (Math.abs(difference) > tolerance) drift[position.instrumentId] = difference;
  }
  return { ok: Object.keys(drift).length === 0, drift };
}

// ── Adaptation ──────────────────────────────────────────────────────────────────────────

export interface RiskPosture {
  /** The owner's ceiling. Adaptation never exceeds this. */
  basePositionPct: number;
  baseDailyStopPct: number;
  positionPct: number;
  dailyStopPct: number;
  tightened: boolean;
  /** Drawdown against starting cash that drove the adjustment, as a fraction. */
  drawdown: number;
  reasons: string[];
}

/**
 * Bands, not a formula. A continuous function of drawdown would move the ceiling on every
 * trade, making it impossible to say which rule was in force when a decision was taken.
 */
const BANDS: readonly { drawdownAbove: number; factor: number; why: string }[] = Object.freeze([
  { drawdownAbove: 0.10, factor: 0.4, why: "Drawdown over 10% of starting capital." },
  { drawdownAbove: 0.05, factor: 0.6, why: "Drawdown over 5% of starting capital." },
  { drawdownAbove: 0.02, factor: 0.8, why: "Drawdown over 2% of starting capital." },
]);

export function riskPosture(
  ledger: LossLedger,
  startingCash: number,
  basePositionPct: number,
  baseDailyStopPct: number,
): RiskPosture {
  const reasons: string[] = [];
  // Only realised loss tightens. Unrealised drawdown moves with every tick, and a ceiling that
  // moves with the market is not a ceiling.
  const drawdown = startingCash > 0 && ledger.netRealised < 0 ? -ledger.netRealised / startingCash : 0;

  const band = BANDS.find((entry) => drawdown > entry.drawdownAbove);
  let factor = band ? band.factor : 1;
  if (band) reasons.push(band.why);

  // A repeated cause tightens further, independently of size: losing the same way four times is
  // a defect in the strategy, not variance, and size alone would not catch it.
  const patterns = ledger.byCause.filter((cause) => cause.isPattern);
  if (patterns.length > 0) {
    factor *= 0.8;
    reasons.push(
      `${patterns.length} loss cause(s) repeated ${PATTERN_THRESHOLD}+ times: ${patterns.map((p) => p.cause).join(", ")}.`,
    );
  }

  const positionPct = Math.min(basePositionPct, basePositionPct * factor);
  const dailyStopPct = Math.min(baseDailyStopPct, baseDailyStopPct * factor);

  return {
    basePositionPct,
    baseDailyStopPct,
    positionPct: Math.round(positionPct * 1000) / 1000,
    dailyStopPct: Math.round(dailyStopPct * 1000) / 1000,
    tightened: factor < 1,
    drawdown,
    reasons,
  };
}
