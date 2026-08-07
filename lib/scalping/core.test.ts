import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/providers/types";
import {
  DEFAULT_PARAMS,
  evaluateScalpingSetup,
  type ScalpingContext,
  type ScalpingDecision,
} from "./core";

const T0 = 1_700_000_000;
const INTERVAL = 300;

/**
 * A hand-built session that satisfies every entry condition: a measured uptrend (alternating
 * strong up / small down bars keep RSI inside the trend zone), a pullback bar that dips
 * through the fast EMA, and a high-volume reclaim bar to decide on.
 */
function goldenBars(): Candle[] {
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 58; i += 1) {
    const up = i % 2 === 0;
    const open = price;
    const close = up ? open + 0.3 : open - 0.15;
    bars.push({
      time: T0 + i * INTERVAL,
      open,
      high: Math.max(open, close) + 0.35,
      low: Math.min(open, close) - 0.35,
      close,
      volume: 10_000,
    });
    price = close;
  }
  const p = price;
  bars.push({ time: T0 + 58 * INTERVAL, open: p, high: p + 0.1, low: p - 1.4, close: p - 0.25, volume: 10_000 });
  const o = p - 0.25;
  bars.push({ time: T0 + 59 * INTERVAL, open: o, high: o + 0.95, low: o - 0.15, close: o + 0.85, volume: 22_000 });
  return bars;
}

/** `now` shortly after the last bar closes, so nothing is stale and nothing is forming. */
const GOLDEN_NOW = T0 + 60 * INTERVAL + 10;

function context(overrides: Partial<ScalpingContext> = {}): ScalpingContext {
  return {
    instrumentId: "US:XNAS:TEST",
    market: "US",
    bars: goldenBars(),
    barIntervalSeconds: INTERVAL,
    now: GOLDEN_NOW,
    session: "REGULAR",
    equity: 100_000,
    ...overrides,
  };
}

function failedConditions(decision: ScalpingDecision): string[] {
  if (decision.kind !== "no_setup") return [];
  return decision.conditions.filter((item) => !item.passed).map((item) => item.condition);
}

describe("refusals — the inputs cannot support a conclusion", () => {
  it("blocks evaluation outside the regular session", () => {
    for (const session of ["PRE_OPEN", "POST_CLOSE", "CLOSED"] as const) {
      const decision = evaluateScalpingSetup(context({ session }));
      expect(decision.kind).toBe("refusal");
      if (decision.kind === "refusal") expect(decision.code).toBe("SESSION_NOT_REGULAR");
    }
  });

  it("blocks stale data instead of deciding about the past", () => {
    const decision = evaluateScalpingSetup(context({ now: GOLDEN_NOW + 3600 }));
    expect(decision.kind).toBe("refusal");
    if (decision.kind === "refusal") expect(decision.code).toBe("STALE_DATA");
  });

  it("refuses too few bars rather than warming up quietly", () => {
    const decision = evaluateScalpingSetup(context({ bars: goldenBars().slice(-10) }));
    expect(decision.kind).toBe("refusal");
    if (decision.kind === "refusal") expect(decision.code).toBe("INSUFFICIENT_BARS");
  });

  it("refuses unordered bars rather than re-sorting over a data fault", () => {
    const bars = goldenBars();
    bars[30] = { ...bars[30], time: bars[29].time };
    const decision = evaluateScalpingSetup(context({ bars }));
    expect(decision.kind).toBe("refusal");
    if (decision.kind === "refusal") expect(decision.code).toBe("UNORDERED_BARS");
  });

  it("refuses to size against zero or invalid equity", () => {
    for (const equity of [0, -5, Number.NaN]) {
      const decision = evaluateScalpingSetup(context({ equity }));
      expect(decision.kind).toBe("refusal");
      if (decision.kind === "refusal") expect(decision.code).toBe("INVALID_EQUITY");
    }
  });
});

describe("the golden setup", () => {
  it("produces a proposal when every condition holds", () => {
    const decision = evaluateScalpingSetup(context());
    expect(failedConditions(decision)).toEqual([]);
    expect(decision.kind).toBe("proposal");
  });

  it("is deterministic: identical input, identical decision", () => {
    const a = evaluateScalpingSetup(context());
    const b = evaluateScalpingSetup(context());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("the proposal can never execute", () => {
  const proposal = () => {
    const decision = evaluateScalpingSetup(context());
    if (decision.kind !== "proposal") throw new Error(`Expected proposal, got ${decision.kind}`);
    return decision;
  };

  it("is marked non-executable and confirmation-required", () => {
    const p = proposal();
    expect(p.executable).toBe(false);
    expect(p.confirmationRequired).toBe(true);
  });

  it("is frozen, so nothing downstream can flip the flag", () => {
    const p = proposal();
    expect(Object.isFrozen(p)).toBe(true);
    expect(() => {
      (p as unknown as { executable: boolean }).executable = true;
    }).toThrow();
    expect(p.executable).toBe(false);
  });

  it("expires rather than remaining confirmable forever", () => {
    const p = proposal();
    expect(p.expiresAt).toBe(p.issuedAt + DEFAULT_PARAMS.proposalTtlSeconds);
  });

  it("admits that the spread is unknown", () => {
    const p = proposal();
    expect(p.spreadKnown).toBe(false);
    expect(p.estimatedRoundTripCost).toBeGreaterThan(0);
  });
});

describe("risk caps", () => {
  it("never risks more than the risk budget", () => {
    const p = evaluateScalpingSetup(context());
    if (p.kind !== "proposal") throw new Error(p.kind);
    expect(p.riskAmount).toBeLessThanOrEqual(100_000 * DEFAULT_PARAMS.riskBudgetPct + 1e-9);
    expect(p.riskAmount).toBeCloseTo(p.quantity * p.riskPerShare, 10);
  });

  it("never exceeds the notional budget", () => {
    const p = evaluateScalpingSetup(context());
    if (p.kind !== "proposal") throw new Error(p.kind);
    expect(p.notional).toBeLessThanOrEqual(100_000 * DEFAULT_PARAMS.positionBudgetPct + p.referenceEntry);
  });

  it("declines the trade entirely when the budget cannot buy one share", () => {
    const decision = evaluateScalpingSetup(context({ equity: 100 }));
    expect(decision.kind).toBe("no_setup");
    expect(failedConditions(decision)).toContain("position_sizing");
  });

  it("scales the stop from structure and ATR, below the entry", () => {
    const p = evaluateScalpingSetup(context());
    if (p.kind !== "proposal") throw new Error(p.kind);
    expect(p.advisoryStop).toBeLessThan(p.referenceEntry);
    expect(p.advisoryTarget).toBeCloseTo(p.referenceEntry + DEFAULT_PARAMS.targetR * p.riskPerShare, 10);
  });
});

describe("closed-bar discipline", () => {
  it("ignores a forming bar entirely, however extreme its values", () => {
    const withFormingDisaster = [
      ...goldenBars(),
      // A forming bar whose values would fail every condition if it leaked in.
      { time: T0 + 60 * INTERVAL, open: 1, high: 1, low: 0.5, close: 0.6, volume: 1 },
    ];
    const clean = evaluateScalpingSetup(context());
    const withForming = evaluateScalpingSetup(context({ bars: withFormingDisaster }));
    expect(JSON.stringify(withForming)).toBe(JSON.stringify(clean));
  });

  it("does not decide on the trigger bar while it is still forming", () => {
    // Same bars, but `now` sits inside the final bar's interval: the reclaim bar has not
    // closed, so the decision must fall back to the prior closed bar and find no setup.
    const decision = evaluateScalpingSetup(context({ now: T0 + 59 * INTERVAL + 60 }));
    expect(decision.kind).not.toBe("proposal");
  });
});

describe("cost gate", () => {
  it("kills a setup whose expected move cannot clear costs", () => {
    const decision = evaluateScalpingSetup(context(), { ...DEFAULT_PARAMS, minCostCoverage: 1e9 });
    expect(decision.kind).toBe("no_setup");
    expect(failedConditions(decision)).toContain("cost_gate");
  });

  it("charges India more than the US for the same setup", () => {
    // Same bars; the IN policy carries STT, stamp duty and brokerage that the US does not.
    const us = evaluateScalpingSetup(context());
    const inr = evaluateScalpingSetup(context({ market: "IN", instrumentId: "IN:XNSE:TEST" }));
    if (us.kind !== "proposal" || inr.kind !== "proposal") {
      throw new Error(`Expected proposals, got ${us.kind}/${inr.kind}`);
    }
    expect(inr.estimatedRoundTripCost).toBeGreaterThan(us.estimatedRoundTripCost);
  });
});

describe("no-setup transparency", () => {
  it("reports every condition with its measured value, not just the verdict", () => {
    const bars = goldenBars();
    // Kill the volume on the trigger bar: exactly one condition should flip.
    bars[59] = { ...bars[59], volume: 5_000 };
    const decision = evaluateScalpingSetup(context({ bars }));
    expect(decision.kind).toBe("no_setup");
    if (decision.kind !== "no_setup") return;
    expect(decision.conditions.length).toBeGreaterThanOrEqual(10);
    expect(failedConditions(decision)).toContain("relative_volume");
    for (const condition of decision.conditions) {
      expect(condition.detail.length).toBeGreaterThan(0);
    }
  });
});
