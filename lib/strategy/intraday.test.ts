import { describe, expect, it } from "vitest";
import { StrategyDslSchema, compileStrategy, roundTripCostBps, type StrategyDsl } from "./dsl";

/**
 * Intraday is admitted on one condition: the spread is declared.
 *
 * This deployment has no bid/ask or depth data — no quote table in the schema, and the free
 * feeds do not carry one. The engine decides on bar close and fills at the next open, modelling
 * no spread, no queue position, no partial fill. On daily bars those omissions are small next to
 * the move; on 1-minute bars the spread is frequently larger than the edge, so a backtest that
 * ignores it is not merely optimistic — it is measuring a different instrument.
 *
 * Declaring the number is the honest option available without paying for microstructure data:
 * the assumption becomes visible and arguable rather than absent.
 */

function dsl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "intraday_probe",
    universe: { market: "NSE", maxPositions: 10 },
    entry: { feature: "close", op: "gt", value: 100 },
    exit: { afterDays: 10, stopLossPct: 2 },
    sizing: { maxPositionPct: 5 },
    costs: { commissionBps: 3, slippageBps: 2 },
    ...overrides,
  };
}

describe("resolution defaults preserve every strategy written before intraday existed", () => {
  it("defaults to daily", () => {
    const parsed = StrategyDslSchema.parse(dsl());
    expect(parsed.universe.resolution).toBe("D");
  });

  it("charges no spread when none is declared, so stored results stay comparable", () => {
    const parsed = StrategyDslSchema.parse(dsl());
    expect(roundTripCostBps(parsed)).toBe((3 + 2) * 2);
  });
});

describe("intraday without a declared spread is refused, not defaulted", () => {
  it("rejects at parse time", () => {
    const result = StrategyDslSchema.safeParse(
      dsl({ universe: { market: "NSE", maxPositions: 10, resolution: "5m" } }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toMatch(/assumedSpreadBps/);
  });

  it("names the reason rather than reporting a shape error", () => {
    const result = StrategyDslSchema.safeParse(
      dsl({ universe: { market: "NSE", maxPositions: 10, resolution: "1m" } }),
    );
    if (result.success) throw new Error("expected refusal");
    expect(JSON.stringify(result.error.issues)).toMatch(/larger than the edge/);
  });

  it("accepts intraday once the spread is declared", () => {
    const parsed = StrategyDslSchema.parse(
      dsl({
        universe: { market: "NSE", maxPositions: 10, resolution: "5m" },
        costs: { commissionBps: 3, slippageBps: 2, assumedSpreadBps: 8 },
      }),
    );
    expect(parsed.universe.resolution).toBe("5m");
  });
});

describe("the declared spread is charged once per round trip, not twice", () => {
  it("adds one whole spread to the two-sided commission and slippage", () => {
    // Crossing the book to enter and again to exit is two halves — one whole spread per completed
    // trade. Doubling it would reject an intraday strategy for the wrong reason, and a rejection
    // has to be as honest as an acceptance.
    const parsed = StrategyDslSchema.parse(
      dsl({
        universe: { market: "NSE", maxPositions: 10, resolution: "5m" },
        costs: { commissionBps: 3, slippageBps: 2, assumedSpreadBps: 8 },
      }),
    );
    expect(roundTripCostBps(parsed)).toBe((3 + 2) * 2 + 8);
  });

  it("scales with the cost-stress multiple", () => {
    const parsed = StrategyDslSchema.parse(
      dsl({
        universe: { market: "NSE", maxPositions: 10, resolution: "5m" },
        costs: { commissionBps: 3, slippageBps: 2, assumedSpreadBps: 8 },
      }),
    );
    expect(roundTripCostBps(parsed, 2)).toBe(((3 + 2) * 2 + 8) * 2);
  });
});

describe("the compiler names what changes meaning at intraday resolution", () => {
  it("warns that afterDays counts bars, not calendar days", () => {
    // Harmless where the two coincide; at 1-minute it exits after ten *minutes* while reading as
    // ten days. Not renamed, because that would invalidate every stored spec — so it is named.
    const result = compileStrategy(
      StrategyDslSchema.parse(
        dsl({
          universe: { market: "NSE", maxPositions: 10, resolution: "1m" },
          costs: { commissionBps: 3, slippageBps: 2, assumedSpreadBps: 8 },
        }),
      ) as StrategyDsl,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toMatch(/counts bars, not calendar days/);
  });

  it("warns when the declared spread is zero", () => {
    const result = compileStrategy(
      StrategyDslSchema.parse(
        dsl({
          universe: { market: "NSE", maxPositions: 10, resolution: "5m" },
          costs: { commissionBps: 3, slippageBps: 2, assumedSpreadBps: 0 },
        }),
      ) as StrategyDsl,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).toMatch(/cross the book for free/);
  });

  it("says nothing about bars or spread for a daily strategy", () => {
    const result = compileStrategy(StrategyDslSchema.parse(dsl()) as StrategyDsl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(" ")).not.toMatch(/counts bars|cross the book/);
  });
});
