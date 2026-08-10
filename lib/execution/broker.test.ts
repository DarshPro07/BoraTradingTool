import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import { BrokerError, simulateTrade, type BrokerConfig, type OrderIntent } from "./broker";

/**
 * The execution semantics from §61–70 of the master prompt, as tests.
 *
 * Every rule here exists because its opposite flatters the strategy:
 *   - filling on an exact touch invents liquidity that was never yours
 *   - filling on the setup bar uses information that did not exist yet
 *   - resolving an ambiguous bar toward the target turns losers into winners
 *   - filling a gapped stop at the stop price pretends the gap did not happen
 */

const MIN = 60;
const T0 = 1_700_000_000;

function bar(index: number, o: number, h: number, l: number, c: number): Candle {
  return { time: T0 + index * MIN, open: o, high: h, low: l, close: c, volume: 1_000 };
}

/** BUY limit 100, stop 95, target 110, tick 0.05, setup known at bar 0. */
function intent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    instrumentKey: "NSE_FO|NIFTY24MARFUT",
    strategyId: "stg_demo",
    side: "BUY",
    quantity: 1,
    limitPrice: 100,
    stopPrice: 95,
    targetPrice: 110,
    tickSize: 0.05,
    setupKnownAt: T0,
    windowEndsAt: T0 + 60 * MIN,
    ...overrides,
  };
}

function config(overrides: Partial<BrokerConfig> = {}): BrokerConfig {
  return {
    mode: "PAPER_SIMULATOR",
    killSwitch: false,
    minimumTradeThroughTicks: 1,
    ambiguity: "WORST_CASE",
    liveEnabled: false,
    ...overrides,
  };
}

describe("the mode gate", () => {
  it("rejects an order when the broker is disabled", () => {
    const result = simulateTrade(intent(), [bar(1, 99, 99, 98, 99)], config({ mode: "DISABLED" }));
    expect(result.state).toBe("REJECTED");
    expect(result.rejection).toMatch(/DISABLED/);
  });

  it("rejects an order in a read-only mode", () => {
    const result = simulateTrade(intent(), [bar(1, 99, 99, 98, 99)], config({ mode: "READ_ONLY" }));
    expect(result.state).toBe("REJECTED");
  });

  it("refuses LIVE unless it has been explicitly enabled", () => {
    // The single most important refusal in this module. A mode string is not authorisation;
    // reaching LIVE requires a separate, deliberate switch that no research code sets.
    expect(() => simulateTrade(intent(), [bar(1, 99, 99, 98, 99)], config({ mode: "LIVE" }))).toThrow(
      BrokerError,
    );
    expect(() => simulateTrade(intent(), [bar(1, 99, 99, 98, 99)], config({ mode: "LIVE" }))).toThrow(
      /liveEnabled/,
    );
  });

  it("rejects everything while the kill switch is engaged", () => {
    const result = simulateTrade(intent(), [bar(1, 99, 99, 98, 99)], config({ killSwitch: true }));
    expect(result.state).toBe("REJECTED");
    expect(result.rejection).toMatch(/kill switch/i);
  });

  it("simulates in the paper mode", () => {
    const result = simulateTrade(intent(), [bar(1, 99, 99, 98, 99)], config());
    expect(result.state).not.toBe("REJECTED");
  });
});

describe("the trade-through fill rule", () => {
  it("does not fill on an exact touch", () => {
    // low == 100 exactly. Somebody traded there; it was not necessarily you.
    const result = simulateTrade(intent(), [bar(1, 101, 101, 100, 101)], config());
    expect(result.entry).toBeNull();
    expect(result.state).toBe("CANCELLED");
  });

  it("fills once price trades through by the configured tick", () => {
    const result = simulateTrade(intent(), [bar(1, 101, 101, 99.95, 100)], config());
    expect(result.entry?.price).toBe(100);
  });

  it("does not fill one tick short of the threshold", () => {
    const result = simulateTrade(intent(), [bar(1, 101, 101, 99.96, 100)], config());
    expect(result.entry).toBeNull();
  });

  it("mirrors the rule for a sell limit", () => {
    const sell = intent({ side: "SELL", limitPrice: 100, stopPrice: 105, targetPrice: 90 });
    expect(simulateTrade(sell, [bar(1, 99, 100, 99, 99)], config()).entry).toBeNull();
    expect(simulateTrade(sell, [bar(1, 99, 100.05, 99, 99)], config()).entry?.price).toBe(100);
  });
});

describe("order activation", () => {
  it("cannot fill on the bar that produced the setup", () => {
    // The setup became knowable at this bar's close. Filling inside it uses information that did
    // not exist when the order would have been placed.
    const onSetupBar = bar(0, 101, 101, 99, 100);
    const result = simulateTrade(intent(), [onSetupBar], config());
    expect(result.entry).toBeNull();
  });

  it("fills on the first eligible bar after the setup", () => {
    const result = simulateTrade(
      intent(),
      [bar(0, 101, 101, 99, 100), bar(1, 101, 101, 99.9, 100)],
      config(),
    );
    expect(result.entry?.at).toBe(T0 + MIN);
  });
});

describe("intrabar ambiguity", () => {
  const filled = [bar(1, 101, 101, 99.9, 100)];

  it("resolves a bar containing both stop and target as the stop", () => {
    // OHLC does not reveal path order. Choosing the target here is how a backtest manufactures
    // winners it never had.
    const ambiguous = [...filled, bar(2, 100, 111, 94, 100)];
    const result = simulateTrade(intent(), ambiguous, config());
    expect(result.exit?.reason).toBe("stop");
    expect(result.ambiguousBar).toBe(true);
  });

  it("can resolve optimistically only as an explicit sensitivity mode", () => {
    const ambiguous = [...filled, bar(2, 100, 111, 94, 100)];
    const result = simulateTrade(intent(), ambiguous, config({ ambiguity: "BEST_CASE" }));
    expect(result.exit?.reason).toBe("target");
  });

  it("can skip the trade entirely when the bar cannot be resolved", () => {
    const ambiguous = [...filled, bar(2, 100, 111, 94, 100)];
    const result = simulateTrade(intent(), ambiguous, config({ ambiguity: "SKIP_AMBIGUOUS" }));
    expect(result.state).toBe("SKIPPED_AMBIGUOUS");
  });

  it("is not flagged ambiguous when only one of the two is reachable", () => {
    const clean = [...filled, bar(2, 100, 111, 99, 110)];
    const result = simulateTrade(intent(), clean, config());
    expect(result.exit?.reason).toBe("target");
    expect(result.ambiguousBar).toBe(false);
  });
});

describe("gapping through the stop", () => {
  it("fills at the gapped price, not the requested stop", () => {
    // stop 95, next bar opens 92. Filling at 95 pretends a price that never traded.
    const gapped = [bar(1, 101, 101, 99.9, 100), bar(2, 92, 93, 91, 92)];
    const result = simulateTrade(intent(), gapped, config());
    expect(result.exit?.price).toBe(92);
    expect(result.gapSlippagePoints).toBeCloseTo(3, 6);
  });

  it("records no gap slippage when the stop is reached normally", () => {
    const normal = [bar(1, 101, 101, 99.9, 100), bar(2, 99, 99, 94, 95)];
    const result = simulateTrade(intent(), normal, config());
    expect(result.exit?.price).toBe(95);
    expect(result.gapSlippagePoints).toBe(0);
  });
});

describe("window expiry", () => {
  it("cancels an entry that never filled inside the window", () => {
    const never = [bar(1, 101, 102, 100.5, 101), bar(2, 101, 102, 100.5, 101)];
    const result = simulateTrade(intent(), never, config());
    expect(result.state).toBe("CANCELLED");
    expect(result.rejection).toMatch(/window/i);
  });

  it("ignores bars past the window when looking for a fill", () => {
    const late = [bar(100, 101, 101, 90, 95)]; // well past windowEndsAt
    const result = simulateTrade(intent(), late, config());
    expect(result.entry).toBeNull();
  });
});
