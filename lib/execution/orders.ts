import type { Candle } from "@/lib/providers/types";

/**
 * Order lifecycle state machine.
 *
 * The paper engine evaluates an order once and returns FILLED, EXPIRED or REJECTED. That is
 * sufficient for a strategy that sends a market order and forgets it, and useless for anything
 * that rests. A limit order that has not yet been reached is not expired — it is working, and
 * the difference is the whole of passive execution.
 *
 * This module owns the part that has to be right before scalping means anything:
 *
 *   - orders rest across bars until filled, cancelled or expired by their time-in-force;
 *   - fills can be partial, bounded by how much of the bar's volume one participant could
 *     plausibly have taken;
 *   - a limit fills at the limit, not at the last trade — crossing the spread is a cost, and
 *     a simulator that hands you the touch for free will overstate every passive strategy;
 *   - linked orders cancel each other, so a bracket cannot leave an orphaned stop behind.
 *
 * It is deliberately free of persistence and of the database, so the transitions can be tested
 * exhaustively without a migration.
 */

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
export type TimeInForce = "DAY" | "GTC" | "IOC" | "FOK";

export type OrderStatus =
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "EXPIRED"
  | "REJECTED";

export interface OrderRequest {
  id: string;
  instrumentId: string;
  side: OrderSide;
  quantity: number;
  type: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: TimeInForce;
  /** Orders sharing a group cancel one another when any of them fills. */
  ocoGroupId?: string;
  /** A child only becomes eligible once its parent has filled (bracket exits). */
  parentId?: string;
}

export interface Order extends OrderRequest {
  status: OrderStatus;
  filledQuantity: number;
  averageFillPrice: number | null;
  /** True once a stop has been touched and the order became executable. */
  triggered: boolean;
  /** Bar time at which the stop was touched, used to price the resulting execution. */
  triggeredAt?: number;
  reason?: string;
}

export interface Fill {
  orderId: string;
  instrumentId: string;
  side: OrderSide;
  quantity: number;
  price: number;
  time: number;
}

export interface StepResult {
  fills: Fill[];
  /** Orders that reached a terminal state on this bar, with the reason. */
  closed: Array<{ orderId: string; status: OrderStatus; reason: string }>;
}

export interface BookOptions {
  /**
   * Share of a bar's volume a single participant may take. Filling an entire bar's volume
   * is the classic way a backtest claims liquidity that was never available to it.
   */
  participationRate?: number;
}

const DEFAULT_PARTICIPATION = 0.1;

export class OrderRejected extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OrderRejected";
  }
}

function validate(request: OrderRequest): void {
  if (!Number.isFinite(request.quantity) || request.quantity <= 0) {
    throw new OrderRejected("INVALID_QUANTITY", `Quantity must be positive, received ${request.quantity}.`);
  }
  if ((request.type === "LIMIT" || request.type === "STOP_LIMIT") && !isPositive(request.limitPrice)) {
    throw new OrderRejected("INVALID_LIMIT_PRICE", `${request.type} requires a positive limit price.`);
  }
  if ((request.type === "STOP" || request.type === "STOP_LIMIT") && !isPositive(request.stopPrice)) {
    throw new OrderRejected("INVALID_STOP_PRICE", `${request.type} requires a positive stop price.`);
  }
}

function isPositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export class OrderBook {
  private readonly orders = new Map<string, Order>();
  private readonly participationRate: number;

  constructor(options: BookOptions = {}) {
    this.participationRate = options.participationRate ?? DEFAULT_PARTICIPATION;
  }

  submit(request: OrderRequest): Order {
    validate(request);
    if (this.orders.has(request.id)) {
      throw new OrderRejected("DUPLICATE_ORDER_ID", `Order "${request.id}" already exists.`);
    }
    const order: Order = {
      ...request,
      timeInForce: request.timeInForce ?? "DAY",
      status: "OPEN",
      filledQuantity: 0,
      averageFillPrice: null,
      triggered: request.type === "MARKET" || request.type === "LIMIT",
    };
    this.orders.set(order.id, order);
    return order;
  }

  cancel(orderId: string, reason = "Cancelled by owner."): boolean {
    const order = this.orders.get(orderId);
    if (!order || isTerminal(order.status)) return false;
    order.status = "CANCELLED";
    order.reason = reason;
    return true;
  }

  get(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  working(): Order[] {
    return [...this.orders.values()].filter((order) => !isTerminal(order.status));
  }

  all(): Order[] {
    return [...this.orders.values()];
  }

  /**
   * Advances every working order against one bar.
   *
   * Order of resolution within the bar is fixed and conservative: stops trigger before limits
   * fill, because from OHLC alone the intrabar path is unknown and assuming the favourable
   * sequence flatters every strategy that carries both.
   */
  step(bar: Candle, instrumentId: string): StepResult {
    const fills: Fill[] = [];
    const closed: StepResult["closed"] = [];
    let remainingVolume = Math.max(0, bar.volume) * this.participationRate;

    const eligible = this.working()
      .filter((order) => order.instrumentId === instrumentId)
      .filter((order) => this.parentSatisfied(order));

    // 1. Stops become executable once touched.
    for (const order of eligible) {
      if (order.triggered) continue;
      const touched =
        order.side === "BUY" ? bar.high >= order.stopPrice! : bar.low <= order.stopPrice!;
      if (touched) {
        order.triggered = true;
        order.triggeredAt = bar.time;
      }
    }

    // 2. Executable orders take liquidity, in submission order.
    for (const order of eligible) {
      if (!order.triggered || isTerminal(order.status)) continue;
      if (remainingVolume <= 0) break;

      const price = fillPrice(order, bar);
      if (price === null) continue;

      const outstanding = order.quantity - order.filledQuantity;
      const takeable = Math.min(outstanding, remainingVolume);

      if (order.timeInForce === "FOK" && takeable < outstanding) {
        order.status = "CANCELLED";
        order.reason = "Fill-or-kill could not be satisfied in full.";
        closed.push({ orderId: order.id, status: order.status, reason: order.reason });
        continue;
      }

      if (takeable <= 0) continue;
      remainingVolume -= takeable;

      const previousNotional = (order.averageFillPrice ?? 0) * order.filledQuantity;
      order.filledQuantity += takeable;
      order.averageFillPrice = (previousNotional + price * takeable) / order.filledQuantity;
      fills.push({ orderId: order.id, instrumentId, side: order.side, quantity: takeable, price, time: bar.time });

      if (order.filledQuantity >= order.quantity - 1e-9) {
        order.status = "FILLED";
        closed.push({ orderId: order.id, status: "FILLED", reason: "Filled in full." });
        this.cancelSiblings(order, closed);
      } else {
        order.status = "PARTIALLY_FILLED";
      }
    }

    // 3. Immediate-or-cancel keeps only what it got on this bar.
    for (const order of eligible) {
      if (isTerminal(order.status) || order.timeInForce !== "IOC") continue;
      order.status = order.filledQuantity > 0 ? "FILLED" : "CANCELLED";
      order.reason = "Immediate-or-cancel: residual quantity released.";
      closed.push({ orderId: order.id, status: order.status, reason: order.reason });
    }

    return { fills, closed };
  }

  /** Expires DAY orders at the session boundary. GTC orders survive. */
  endOfSession(): StepResult["closed"] {
    const closed: StepResult["closed"] = [];
    for (const order of this.working()) {
      if (order.timeInForce !== "DAY") continue;
      order.status = "EXPIRED";
      order.reason = "Day order not filled before the session closed.";
      closed.push({ orderId: order.id, status: "EXPIRED", reason: order.reason });
    }
    return closed;
  }

  private parentSatisfied(order: Order): boolean {
    if (!order.parentId) return true;
    return this.orders.get(order.parentId)?.status === "FILLED";
  }

  private cancelSiblings(filled: Order, closed: StepResult["closed"]): void {
    if (!filled.ocoGroupId) return;
    for (const other of this.orders.values()) {
      if (other.id === filled.id || other.ocoGroupId !== filled.ocoGroupId) continue;
      if (isTerminal(other.status)) continue;
      other.status = "CANCELLED";
      other.reason = `Cancelled by linked order ${filled.id}.`;
      closed.push({ orderId: other.id, status: "CANCELLED", reason: other.reason });
    }
  }
}

export function isTerminal(status: OrderStatus): boolean {
  return status === "FILLED" || status === "CANCELLED" || status === "EXPIRED" || status === "REJECTED";
}

/**
 * The price this order would achieve on this bar, or null if it is not reachable.
 *
 * A limit never fills better than its own price *because the bar traded there* — but it does
 * fill at the open when the market gapped through it, which is the one case where the passive
 * order genuinely got a better price than it asked for.
 */
function fillPrice(order: Order, bar: Candle): number | null {
  if (order.type === "MARKET") return bar.open;

  if (order.type === "STOP" && order.triggered) {
    // On the bar that triggered it, a stop executes at its own price or worse. Pricing it at
    // that bar's open would hand back a level from *before* the stop was touched — for a sell
    // stop at 90 on a bar opening at 100, a ten-point gift that never existed.
    if (order.triggeredAt === bar.time && isPositive(order.stopPrice)) {
      return order.side === "BUY"
        ? Math.max(order.stopPrice, bar.open)
        : Math.min(order.stopPrice, bar.open);
    }
    // Triggered on an earlier bar and still working: it is now simply a market order.
    return bar.open;
  }

  const limit = order.limitPrice;
  if (!isPositive(limit)) return null;

  if (order.side === "BUY") {
    if (bar.low > limit) return null;
    return Math.min(limit, bar.open);
  }
  if (bar.high < limit) return null;
  return Math.max(limit, bar.open);
}
