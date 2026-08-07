import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, GATE_RULES, evaluateGate, type GateContext } from "./gate";

/** A context in which every rule passes, so each test can spoil exactly one thing. */
function cleanContext(overrides: Partial<GateContext> = {}): GateContext {
  return {
    sessionMinute: 10 * 60, // 10:00, inside 09:30-15:30
    requestedContracts: 1,
    tradesToday: 0,
    openPositions: 0,
    realisedRToday: 0,
    minutesToNearestNewsEvent: 120,
    combinedDrawdownUsd: -100,
    maxPairwiseCorrelation: 0.2,
    commonDays: 60,
    killSwitchEngaged: false,
    ...overrides,
  };
}

const AT = new Date("2026-08-06T10:00:00Z");

describe("baseline", () => {
  it("allows an order that satisfies every rule", () => {
    const verdict = evaluateGate(cleanContext(), DEFAULT_RULES, AT);
    expect(verdict.allowed).toBe(true);
    expect(verdict.blockedBy).toEqual([]);
  });

  it("evaluates every rule even when one has already blocked", () => {
    // A verdict naming one breach while four rules went unchecked is not an audit trail.
    const verdict = evaluateGate(cleanContext({ killSwitchEngaged: true }), DEFAULT_RULES, AT);
    expect(verdict.checks.map((check) => check.rule)).toEqual([...GATE_RULES]);
  });

  it("records the time it was issued so the decision can be replayed", () => {
    expect(evaluateGate(cleanContext(), DEFAULT_RULES, AT).evaluatedAt).toBe(AT);
  });
});

describe("fails closed", () => {
  // Each of these is a value the gate cannot establish. None may be read as permission.
  const unknowns: Array<[keyof GateContext, string]> = [
    ["requestedContracts", "max_contracts"],
    ["tradesToday", "max_trades_per_day"],
    ["openPositions", "max_simultaneous_positions"],
    ["realisedRToday", "daily_loss_limit_r"],
    ["sessionMinute", "trading_window"],
    ["minutesToNearestNewsEvent", "news_blackout"],
    ["combinedDrawdownUsd", "max_combined_drawdown_usd"],
    ["maxPairwiseCorrelation", "max_pairwise_correlation"],
    ["commonDays", "max_pairwise_correlation"],
  ];

  for (const [field, rule] of unknowns) {
    it(`blocks when ${String(field)} is unknown`, () => {
      const verdict = evaluateGate(cleanContext({ [field]: null } as Partial<GateContext>), DEFAULT_RULES, AT);
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toContain(rule);
    });
  }

  it("blocks on NaN as readily as on null", () => {
    const verdict = evaluateGate(cleanContext({ tradesToday: Number.NaN }), DEFAULT_RULES, AT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toContain("max_trades_per_day");
  });

  it("blocks when the configured window is not a valid range", () => {
    const verdict = evaluateGate(cleanContext(), { ...DEFAULT_RULES, tradingWindowStart: "15:30", tradingWindowEnd: "09:30" }, AT);
    expect(verdict.blockedBy).toContain("trading_window");
  });
});

describe("individual limits", () => {
  it("halts everything when the kill switch is engaged", () => {
    const verdict = evaluateGate(cleanContext({ killSwitchEngaged: true }), DEFAULT_RULES, AT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockedBy).toContain("kill_switch");
  });

  it("blocks the trade that would exceed the daily count", () => {
    expect(evaluateGate(cleanContext({ tradesToday: 1 }), DEFAULT_RULES, AT).blockedBy).toContain("max_trades_per_day");
  });

  it("blocks an oversized order", () => {
    expect(evaluateGate(cleanContext({ requestedContracts: 2 }), DEFAULT_RULES, AT).blockedBy).toContain("max_contracts");
  });

  it("blocks a zero or negative size", () => {
    expect(evaluateGate(cleanContext({ requestedContracts: 0 }), DEFAULT_RULES, AT).blockedBy).toContain("max_contracts");
  });

  it("blocks once the daily loss floor is reached", () => {
    expect(evaluateGate(cleanContext({ realisedRToday: -1 }), DEFAULT_RULES, AT).blockedBy).toContain("daily_loss_limit_r");
    expect(evaluateGate(cleanContext({ realisedRToday: -0.99 }), DEFAULT_RULES, AT).allowed).toBe(true);
  });

  it("blocks outside the trading window at both ends", () => {
    expect(evaluateGate(cleanContext({ sessionMinute: 9 * 60 }), DEFAULT_RULES, AT).blockedBy).toContain("trading_window");
    expect(evaluateGate(cleanContext({ sessionMinute: 16 * 60 }), DEFAULT_RULES, AT).blockedBy).toContain("trading_window");
  });

  it("blocks inside the news blackout on either side of the event", () => {
    expect(evaluateGate(cleanContext({ minutesToNearestNewsEvent: 10 }), DEFAULT_RULES, AT).blockedBy).toContain("news_blackout");
    expect(evaluateGate(cleanContext({ minutesToNearestNewsEvent: -10 }), DEFAULT_RULES, AT).blockedBy).toContain("news_blackout");
    expect(evaluateGate(cleanContext({ minutesToNearestNewsEvent: 16 }), DEFAULT_RULES, AT).allowed).toBe(true);
    expect(evaluateGate(cleanContext({ minutesToNearestNewsEvent: -16 }), DEFAULT_RULES, AT).allowed).toBe(true);
  });

  it("blocks when combined drawdown reaches the ceiling, whichever sign it carries", () => {
    expect(evaluateGate(cleanContext({ combinedDrawdownUsd: -2_000 }), DEFAULT_RULES, AT).blockedBy)
      .toContain("max_combined_drawdown_usd");
    expect(evaluateGate(cleanContext({ combinedDrawdownUsd: 2_000 }), DEFAULT_RULES, AT).blockedBy)
      .toContain("max_combined_drawdown_usd");
  });
});

describe("correlation", () => {
  it("blocks a book that is too correlated to add to", () => {
    expect(evaluateGate(cleanContext({ maxPairwiseCorrelation: 0.8 }), DEFAULT_RULES, AT).blockedBy)
      .toContain("max_pairwise_correlation");
  });

  it("treats strong negative correlation as equally concentrated", () => {
    expect(evaluateGate(cleanContext({ maxPairwiseCorrelation: -0.8 }), DEFAULT_RULES, AT).blockedBy)
      .toContain("max_pairwise_correlation");
  });

  it("refuses to trust a correlation computed from too little overlap", () => {
    // An unmeasurable correlation is not an uncorrelated one.
    const verdict = evaluateGate(cleanContext({ commonDays: 5, maxPairwiseCorrelation: 0.01 }), DEFAULT_RULES, AT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.checks.find((c) => c.rule === "max_pairwise_correlation")?.detail).toMatch(/common days/);
  });
});
