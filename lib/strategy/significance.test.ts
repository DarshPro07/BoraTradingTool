import { describe, expect, it } from "vitest";
import { pairedBootstrapEdge, probabilityOfBacktestOverfitting } from "./statistics";

describe("pairedBootstrapEdge", () => {
  const zeros = (count: number) => Array.from({ length: count }, () => 0);

  it("is deterministic for a given seed", () => {
    const strategy = Array.from({ length: 60 }, (_, index) => (index % 5 === 0 ? -0.01 : 0.014));
    const a = pairedBootstrapEdge(strategy, zeros(60), 2_000, 42);
    const b = pairedBootstrapEdge(strategy, zeros(60), 2_000, 42);
    expect(a).toEqual(b);
  });

  it("finds a clear edge distinguishable from luck", () => {
    const strategy = Array.from({ length: 60 }, (_, index) => (index % 5 === 0 ? -0.01 : 0.014));
    const result = pairedBootstrapEdge(strategy, zeros(60));
    expect(result.edge).toBeGreaterThan(0.005);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("calls symmetric noise indistinguishable", () => {
    const noise = Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? 0.01 : -0.01));
    const result = pairedBootstrapEdge(noise, zeros(60));
    expect(Math.abs(result.edge)).toBeLessThan(1e-12);
    expect(result.pValue).toBeGreaterThan(0.2);
  });

  it("returns pValue 1 for a uniformly negative edge", () => {
    const strategy = zeros(60);
    const benchmark = Array.from({ length: 60 }, () => 0.001);
    const result = pairedBootstrapEdge(strategy, benchmark);
    expect(result.edge).toBeCloseTo(-0.001, 10);
    expect(result.pValue).toBe(1);
  });

  it("refuses unpaired series rather than truncating one", () => {
    expect(() => pairedBootstrapEdge(zeros(60), zeros(10))).toThrow(RangeError);
  });

  it("treats an empty comparison as no evidence, not proof", () => {
    const result = pairedBootstrapEdge([], []);
    expect(result.edge).toBe(0);
    expect(result.pValue).toBe(1);
  });
});

describe("probabilityOfBacktestOverfitting slice guard", () => {
  it("caps the slice count so a large request cannot explode combinatorially", () => {
    // Uncapped, slices=200 over 200 observations means C(200,100) partitions — the process
    // would never return. Completing at all within the test timeout is the assertion.
    const performance = Array.from({ length: 3 }, (_, config) =>
      Array.from({ length: 200 }, (_, index) => Math.sin(index * 0.7 + config)),
    );
    const pbo = probabilityOfBacktestOverfitting(performance, 200);
    expect(pbo).toBeGreaterThanOrEqual(0);
    expect(pbo).toBeLessThanOrEqual(1);
  });

  it("still refuses fewer than two slices", () => {
    expect(probabilityOfBacktestOverfitting([[1, 2], [2, 1]], 1)).toBe(0);
  });
});
