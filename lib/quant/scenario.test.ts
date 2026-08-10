import { describe, expect, it } from "vitest";
import { runScenario } from "./scenario";

const RETURNS = Array.from({ length: 250 }, (_, index) => (index % 5 === 0 ? -0.012 : 0.006));

describe("scenario engine — labelled models, seeded reproducibility, honest refusals", () => {
  it("refuses a thin conditioning sample with the floor stated", () => {
    const result = runScenario({ model: "gbm", returns: [0.01, -0.01], horizonPeriods: 20, paths: 100, seed: 7 });
    expect("ok" in result && result.ok === false).toBe(true);
    if ("ok" in result) expect(result.message).toMatch(/stated floor/);
  });

  it("same seed → identical result; different seed → different result", () => {
    const a = runScenario({ model: "gbm", returns: RETURNS, horizonPeriods: 60, paths: 200, seed: 42 });
    const b = runScenario({ model: "gbm", returns: RETURNS, horizonPeriods: 60, paths: 200, seed: 42 });
    const c = runScenario({ model: "gbm", returns: RETURNS, horizonPeriods: 60, paths: 200, seed: 43 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("GBM results pin the gbm assumption record and label the simplification", () => {
    const result = runScenario({ model: "gbm", returns: RETURNS, horizonPeriods: 60, paths: 200, seed: 42 });
    if ("ok" in result) throw new Error("unexpected refusal");
    expect(result.assumption.id).toBe("gbm");
    expect(result.assumption.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.note).toMatch(/Model #1, a stated simplification/);
  });

  it("percentiles are ordered and drawdown quantiles sane, for every model", () => {
    for (const model of ["gbm", "historical_bootstrap", "block_bootstrap"] as const) {
      const result = runScenario({ model, returns: RETURNS, horizonPeriods: 60, paths: 300, seed: 11 });
      if ("ok" in result) throw new Error(`unexpected refusal for ${model}`);
      expect(result.terminal.p05).toBeLessThanOrEqual(result.terminal.p50);
      expect(result.terminal.p50).toBeLessThanOrEqual(result.terminal.p95);
      expect(result.maxDrawdown.p50).toBeLessThanOrEqual(result.maxDrawdown.p95);
      expect(result.probabilityOfLoss).toBeGreaterThanOrEqual(0);
      expect(result.probabilityOfLoss).toBeLessThanOrEqual(1);
    }
  });

  it("bootstrap notes carry the battery cross-reference — two implementations, one visible check", () => {
    const result = runScenario({ model: "historical_bootstrap", returns: RETURNS, horizonPeriods: 60, paths: 200, seed: 42 });
    if ("ok" in result) throw new Error("unexpected refusal");
    expect(result.note).toMatch(/Battery cross-ref:/);
  });
});
