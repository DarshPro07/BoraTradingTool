import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { checkRediscovery, listGraveyard, strategyIdentity, type GraveEntry } from "./graveyard";
import { StrategyDslSchema, type StrategyDsl } from "./dsl";

useTemporaryDatabase();

/**
 * Percent units throughout — `stopLossPct: 5` is five percent, not 0.05. The DSL stores percent
 * (`z.number().min(0.1).max(50)`) and the engine divides by 100 at its own boundary.
 */
function dsl(overrides: Record<string, unknown> = {}): StrategyDsl {
  return StrategyDslSchema.parse({
    name: "sma_cross_demo",
    universe: { market: "US", maxPositions: 10 },
    entry: { crossover: ["sma20", "sma50"] },
    exit: { afterDays: 10, stopLossPct: 5 },
    sizing: { maxPositionPct: 5 },
    costs: { commissionBps: 5, slippageBps: 5 },
    ...overrides,
  });
}

function grave(identity: string, overrides: Partial<GraveEntry> = {}): GraveEntry {
  return {
    specId: "spc_1",
    name: "sma_cross_demo",
    version: 1,
    identity,
    buriedAt: new Date("2026-07-01T00:00:00.000Z"),
    reasons: ["Deflated Sharpe below the selection-adjusted bar"],
    trialsSpent: 3,
    ...overrides,
  };
}

describe("identity survives a compiler bump", () => {
  it("hashes the strategy, not the compiler that produced it", () => {
    // compileStrategy hashes { compiler: COMPILER_VERSION, dsl }, which is right for
    // reproducibility and wrong for identity: bumping the compiler would empty the graveyard
    // and every buried strategy would look new. This hash must not contain a version.
    const identity = strategyIdentity(dsl());
    expect(identity).toMatch(/^[0-9a-f]{32}$/);
    expect(identity).not.toContain("1.2.0");
  });

  it("gives the same identity to the same strategy twice", () => {
    expect(strategyIdentity(dsl())).toBe(strategyIdentity(dsl()));
  });

  it("gives the same identity regardless of key order in the source object", () => {
    const a = strategyIdentity(dsl());
    const b = strategyIdentity(
      StrategyDslSchema.parse({
        costs: { slippageBps: 5, commissionBps: 5 },
        sizing: { maxPositionPct: 5 },
        exit: { stopLossPct: 5, afterDays: 10 },
        entry: { crossover: ["sma20", "sma50"] },
        universe: { maxPositions: 10, market: "US" },
        name: "sma_cross_demo",
      }),
    );
    expect(a).toBe(b);
  });

  it("gives a different identity when the strategy actually differs", () => {
    expect(strategyIdentity(dsl())).not.toBe(strategyIdentity(dsl({ exit: { afterDays: 20, stopLossPct: 5 } })));
    expect(strategyIdentity(dsl())).not.toBe(
      strategyIdentity(dsl({ entry: { crossover: ["sma20", "sma200"] } })),
    );
  });

  it("treats a cost change as a different strategy", () => {
    // Costs change what the strategy *is*, not merely how it is graded — a version that only
    // survives at zero costs is a different candidate from one that survives at ten bps.
    expect(strategyIdentity(dsl())).not.toBe(
      strategyIdentity(dsl({ costs: { commissionBps: 0, slippageBps: 0 } })),
    );
  });
});

describe("rediscovery", () => {
  it("recognises a strategy already buried", () => {
    const check = checkRediscovery(dsl(), [grave(strategyIdentity(dsl()))]);
    expect(check.rediscovered).toBe(true);
  });

  it("says why it died and what re-testing would cost", () => {
    const check = checkRediscovery(dsl(), [grave(strategyIdentity(dsl()))]);
    if (!check.rediscovered) throw new Error("expected a rediscovery");
    expect(check.message).toMatch(/Deflated Sharpe/);
    expect(check.message).toMatch(/3 trial/);
    expect(check.message).toMatch(/spend another trial/);
  });

  it("does not flag a genuinely new strategy", () => {
    const check = checkRediscovery(dsl({ exit: { afterDays: 3 } }), [grave(strategyIdentity(dsl()))]);
    expect(check.rediscovered).toBe(false);
  });

  it("does not flag anything against an empty graveyard", () => {
    expect(checkRediscovery(dsl(), []).rediscovered).toBe(false);
  });

  it("never matches an entry whose DSL could not be parsed", () => {
    // An unparseable spec keeps a sentinel identity. It must not collide with a real hash.
    const check = checkRediscovery(dsl(), [grave("unparseable:abc123")]);
    expect(check.rediscovered).toBe(false);
  });

  it("reports a burial with no recorded reason without inventing one", () => {
    const check = checkRediscovery(dsl(), [grave(strategyIdentity(dsl()), { reasons: [], buriedAt: null })]);
    if (!check.rediscovered) throw new Error("expected a rediscovery");
    expect(check.message).not.toMatch(/Rejected for/);
    expect(check.message).not.toMatch(/undefined|null|NaN/);
  });
});

describe("reading the graveyard", () => {
  it("returns entries the database actually holds, without inventing any", () => {
    const entries = listGraveyard();
    expect(Array.isArray(entries)).toBe(true);
    for (const entry of entries) {
      expect(entry.specId).toBeTruthy();
      expect(entry.trialsSpent).toBeGreaterThanOrEqual(0);
    }
  });

  it("honours the limit", () => {
    expect(listGraveyard(0)).toHaveLength(0);
  });
});
