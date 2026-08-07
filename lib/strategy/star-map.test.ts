import { describe, expect, it } from "vitest";
import { buildStarMap, familyOf, type StarInput } from "./star-map";

function star(id: string, family: string, pnl: number | null = 100, status = "draft"): StarInput {
  return { id, name: id, family, status, pnl, trades: 50 };
}

describe("families group a parameter sweep into one search", () => {
  it("strips trailing parameters from a name", () => {
    // The multiple-testing correction only means anything if a sweep counts as one search.
    expect(familyOf("sma_cross_20_50")).toBe("sma_cross");
    expect(familyOf("sma_cross_10_30")).toBe("sma_cross");
    expect(familyOf("rsi_reversion_30")).toBe("rsi_reversion");
  });

  it("keeps a name that is all parameters rather than returning nothing", () => {
    expect(familyOf("20_50")).toBe("20_50");
    expect(familyOf("momentum")).toBe("momentum");
  });
});

describe("layout is stable and bounded", () => {
  const inputs = Array.from({ length: 40 }, (_, index) =>
    star(`stg_${index}`, index % 4 === 0 ? "sma_cross" : index % 4 === 1 ? "rsi" : index % 4 === 2 ? "gap" : "orb"),
  );

  it("gives the same star the same position across builds", () => {
    // A map that reshuffled every render would make "the bright one on the left" meaningless.
    const a = buildStarMap(inputs);
    const b = buildStarMap(inputs);
    expect(a).toEqual(b);
  });

  it("keeps every star inside the canvas", () => {
    const map = buildStarMap(inputs, 900, 420);
    for (const constellation of map.constellations) {
      for (const point of constellation.stars) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(900);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(420);
      }
    }
  });

  it("places every input exactly once", () => {
    const map = buildStarMap(inputs);
    const placed = map.constellations.flatMap((constellation) => constellation.stars.map((s) => s.id));
    expect(placed).toHaveLength(inputs.length);
    expect(new Set(placed).size).toBe(inputs.length);
    expect(map.total).toBe(inputs.length);
  });

  it("reports the widest search, which is the multiple-testing exposure", () => {
    const wide = [...Array.from({ length: 60 }, (_, i) => star(`w${i}`, "orb")), star("x", "gap")];
    expect(buildStarMap(wide).largestFamily).toBe(60);
  });

  it("joins each family into one shape", () => {
    const map = buildStarMap([star("a", "f"), star("b", "f"), star("c", "f")]);
    expect(map.constellations[0].links).toHaveLength(2);
  });

  it("handles an empty board without producing a zero-sized canvas", () => {
    const map = buildStarMap([]);
    expect(map.constellations).toHaveLength(0);
    expect(map.width).toBeGreaterThan(0);
    expect(map.brightnessUnavailable).toBe(true);
  });
});

describe("brightness never implies knowledge it does not have", () => {
  it("scales against the best result on the board, not per family", () => {
    // Per-family scaling would make a family of losers look as bright as a family of winners.
    const map = buildStarMap([star("big", "a", 1000), star("small", "b", 10)]);
    const big = map.constellations.flatMap((c) => c.stars).find((s) => s.id === "big")!;
    const small = map.constellations.flatMap((c) => c.stars).find((s) => s.id === "small")!;
    expect(big.brightness).toBeGreaterThan(small.brightness);
  });

  it("draws an unknown P&L dim rather than dark", () => {
    // Dark would read as "lost everything"; dim reads as "not measured", which is the truth.
    const map = buildStarMap([star("known", "a", 500), star("unknown", "a", null)]);
    const unknown = map.constellations[0].stars.find((s) => s.id === "unknown")!;
    expect(unknown.brightness).toBeGreaterThan(0);
    expect(unknown.brightness).toBeLessThan(0.5);
  });

  it("says so when no strategy has a P&L at all", () => {
    const map = buildStarMap([star("a", "f", null), star("b", "f", null)]);
    expect(map.brightnessUnavailable).toBe(true);
  });

  it("does not divide by zero when every P&L is exactly zero", () => {
    const map = buildStarMap([star("a", "f", 0), star("b", "f", 0)]);
    for (const point of map.constellations.flatMap((c) => c.stars)) {
      expect(Number.isFinite(point.brightness)).toBe(true);
    }
  });

  it("treats a large loss as bright, because magnitude is what the eye should catch", () => {
    const map = buildStarMap([star("loser", "a", -1000), star("flat", "b", 5)]);
    const loser = map.constellations.flatMap((c) => c.stars).find((s) => s.id === "loser")!;
    expect(loser.brightness).toBeGreaterThan(0.9);
  });
});

describe("burial", () => {
  it("marks rejected and retired strategies", () => {
    const map = buildStarMap([star("a", "f", 1, "rejected"), star("b", "f", 1, "retired"), star("c", "f", 1, "draft")]);
    const stars = map.constellations.flatMap((c) => c.stars);
    expect(stars.find((s) => s.id === "a")?.buried).toBe(true);
    expect(stars.find((s) => s.id === "b")?.buried).toBe(true);
    expect(stars.find((s) => s.id === "c")?.buried).toBe(false);
  });
});
