import type { Candle } from "@/lib/providers/types";

/**
 * The broker abstraction — five modes, one of which is not reachable from here.
 *
 * ## Where this sits
 *
 * `CLAUDE.md` states the system places no orders, and `lib/governance/policy.ts:77` prohibits
 * `place_order` in every learning mode. Both remain true after this file. What this adds is the
 * *structure* the master prompt asks for in §1 and §122–125:
 *
 *   DISABLED → READ_ONLY → SANDBOX → PAPER_SIMULATOR → LIVE
 *
 * PAPER_SIMULATOR is implemented and works. LIVE exists in the type system so the seam is real
 * and testable, and refuses to run without `liveEnabled`, which nothing in research code sets.
 * That refusal is the point: reaching live capital must be a separate deliberate act, not a
 * consequence of a strategy looking good.
 *
 * ## The fill rules, and why each one costs the strategy money
 *
 * Every rule below is the conservative side of a coin-flip, because the optimistic side silently
 * manufactures performance:
 *
 *   - **Trade-through, not touch.** A bar low equal to the limit means somebody traded there. It
 *     does not mean you did — you were behind the queue. Filling on touch grants you every
 *     favourable tap, which is exactly the population of your winners.
 *   - **Activation on the next bar.** The setup became knowable at a bar's close; filling inside
 *     that same bar spends information that did not exist yet.
 *   - **Ambiguity resolves to the stop.** One-minute OHLC does not reveal whether the low or the
 *     high came first. Choosing the target converts losers into winners at no cost, which is why
 *     `BEST_CASE` exists only as a sensitivity mode and is never the headline.
 *   - **Gaps fill at the gap.** A stop at 95 with the next print at 92 fills at 92. Filling at 95
 *     pretends a price that never traded.
 */

export const BROKER_MODES = ["DISABLED", "READ_ONLY", "SANDBOX", "PAPER_SIMULATOR", "LIVE"] as const;
export type BrokerMode = (typeof BROKER_MODES)[number];

/** Modes that may produce a simulated fill. LIVE is deliberately absent — see `assertMode`. */
const SIMULATING: ReadonlySet<BrokerMode> = new Set<BrokerMode>(["SANDBOX", "PAPER_SIMULATOR"]);

export type AmbiguityPolicy = "WORST_CASE" | "BEST_CASE" | "SKIP_AMBIGUOUS";

export type OrderState =
  | "CREATED"
  | "PENDING_ACTIVATION"
  | "ACTIVE"
  | "FILLED"
  | "CLOSED"
  | "CANCELLED"
  | "EXPIRED"
  | "REJECTED"
  | "SKIPPED_AMBIGUOUS";

export type ExitReason = "stop" | "target" | "window_end" | "open";

export class BrokerError extends Error {
  constructor(
    readonly code: "LIVE_NOT_ENABLED",
    message: string,
  ) {
    super(message);
    this.name = "BrokerError";
  }
}

export interface OrderIntent {
  instrumentKey: string;
  strategyId: string;
  side: "BUY" | "SELL";
  quantity: number;
  limitPrice: number;
  stopPrice: number;
  targetPrice: number | null;
  /** Point-in-time tick size. The trade-through threshold is measured in these. */
  tickSize: number;
  /** Unix seconds. Nothing at or before this may fill. */
  setupKnownAt: number;
  /** Unix seconds. An unfilled entry is cancelled here rather than left resting. */
  windowEndsAt: number;
}

export interface BrokerConfig {
  mode: BrokerMode;
  killSwitch: boolean;
  minimumTradeThroughTicks: number;
  ambiguity: AmbiguityPolicy;
  /**
   * The separate switch LIVE requires. Not a mode — a second, independent assertion, so that
   * setting a mode string can never by itself reach real capital.
   */
  liveEnabled: boolean;
}

export interface TradeSimulation {
  state: OrderState;
  entry: { price: number; at: number } | null;
  exit: { price: number; at: number; reason: ExitReason } | null;
  /** True when a single bar contained both stop and target and the order could not be resolved. */
  ambiguousBar: boolean;
  /** How far beyond the stop the market had already moved when the fill happened. */
  gapSlippagePoints: number;
  rejection: string | null;
}

function refused(state: OrderState, rejection: string): TradeSimulation {
  return { state, entry: null, exit: null, ambiguousBar: false, gapSlippagePoints: 0, rejection };
}

/**
 * The gate. Returns a refusal for modes that simply do not trade, and *throws* for LIVE without
 * authorisation — because that is a misconfiguration to fix, not an outcome to record.
 */
function assertMode(config: BrokerConfig): TradeSimulation | null {
  if (config.killSwitch) {
    return refused("REJECTED", "The kill switch is engaged; no order may be created in any mode.");
  }
  if (config.mode === "LIVE" && !config.liveEnabled) {
    throw new BrokerError(
      "LIVE_NOT_ENABLED",
      "Broker mode is LIVE but liveEnabled is false. Reaching live capital requires a second, " +
        "deliberate switch that no research code sets — a mode string alone is not authorisation.",
    );
  }
  if (!SIMULATING.has(config.mode)) {
    return refused("REJECTED", `Broker mode is ${config.mode}; it does not place or simulate orders.`);
  }
  return null;
}

/** True once price has traded through the limit by the required number of ticks. */
function tradedThrough(intent: OrderIntent, bar: Candle, ticks: number): boolean {
  const threshold = ticks * intent.tickSize;
  return intent.side === "BUY"
    ? bar.low <= intent.limitPrice - threshold
    : bar.high >= intent.limitPrice + threshold;
}

function stopReached(intent: OrderIntent, bar: Candle): boolean {
  return intent.side === "BUY" ? bar.low <= intent.stopPrice : bar.high >= intent.stopPrice;
}

function targetReached(intent: OrderIntent, bar: Candle): boolean {
  if (intent.targetPrice === null) return false;
  return intent.side === "BUY" ? bar.high >= intent.targetPrice : bar.low <= intent.targetPrice;
}

/**
 * The stop fill price, accounting for a gap.
 *
 * If the bar opened already beyond the stop, the market was never available at the stop — the
 * fill is the open. Returns the price and how many points of that were pure gap.
 */
function stopFill(intent: OrderIntent, bar: Candle): { price: number; gap: number } {
  const gappedThrough = intent.side === "BUY" ? bar.open < intent.stopPrice : bar.open > intent.stopPrice;
  if (!gappedThrough) return { price: intent.stopPrice, gap: 0 };
  return { price: bar.open, gap: Math.abs(intent.stopPrice - bar.open) };
}

export function simulateTrade(
  intent: OrderIntent,
  bars: readonly Candle[],
  config: BrokerConfig,
): TradeSimulation {
  const gate = assertMode(config);
  if (gate) return gate;

  // Activation: strictly after the setup bar, and never past the window.
  const eligible = bars.filter((bar) => bar.time > intent.setupKnownAt && bar.time <= intent.windowEndsAt);

  const entryIndex = eligible.findIndex((bar) => tradedThrough(intent, bar, config.minimumTradeThroughTicks));
  if (entryIndex === -1) {
    return refused(
      "CANCELLED",
      "The entry never traded through inside the research window, so the order was cancelled " +
        "rather than left resting into a market it was not evaluated against.",
    );
  }

  const entryBar = eligible[entryIndex];
  const entry = { price: intent.limitPrice, at: entryBar.time };

  // Exits are searched from the bar AFTER the fill. Resolving the entry bar's own high and low
  // against the stop would need the intrabar path, which is precisely what OHLC does not carry.
  for (const bar of eligible.slice(entryIndex + 1)) {
    const hitStop = stopReached(intent, bar);
    const hitTarget = targetReached(intent, bar);

    if (hitStop && hitTarget) {
      if (config.ambiguity === "SKIP_AMBIGUOUS") {
        return {
          state: "SKIPPED_AMBIGUOUS",
          entry,
          exit: null,
          ambiguousBar: true,
          gapSlippagePoints: 0,
          rejection: "Stop and target both reachable in one bar; the trade was skipped rather than guessed.",
        };
      }
      if (config.ambiguity === "BEST_CASE") {
        return {
          state: "CLOSED",
          entry,
          exit: { price: intent.targetPrice as number, at: bar.time, reason: "target" },
          ambiguousBar: true,
          gapSlippagePoints: 0,
          rejection: null,
        };
      }
      const fill = stopFill(intent, bar);
      return {
        state: "CLOSED",
        entry,
        exit: { price: fill.price, at: bar.time, reason: "stop" },
        ambiguousBar: true,
        gapSlippagePoints: fill.gap,
        rejection: null,
      };
    }

    if (hitStop) {
      const fill = stopFill(intent, bar);
      return {
        state: "CLOSED",
        entry,
        exit: { price: fill.price, at: bar.time, reason: "stop" },
        ambiguousBar: false,
        gapSlippagePoints: fill.gap,
        rejection: null,
      };
    }

    if (hitTarget) {
      return {
        state: "CLOSED",
        entry,
        exit: { price: intent.targetPrice as number, at: bar.time, reason: "target" },
        ambiguousBar: false,
        gapSlippagePoints: 0,
        rejection: null,
      };
    }
  }

  // Filled and still open at the window's end. Closed at the last observed price rather than
  // carried, because the window is the boundary the strategy was defined on.
  const last = eligible[eligible.length - 1];
  return {
    state: "CLOSED",
    entry,
    exit: { price: last.close, at: last.time, reason: "window_end" },
    ambiguousBar: false,
    gapSlippagePoints: 0,
    rejection: null,
  };
}
