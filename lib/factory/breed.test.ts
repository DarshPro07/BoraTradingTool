import { describe, expect, it } from "vitest";
import { compileStrategy, StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { breedGeneration, logicIdentity } from "./breed";

/**
 * Breeding is the one part of this system that can manufacture false positives at scale, so the
 * tests are mostly about what it refuses to emit: nothing uncompilable, nothing already buried,
 * nothing duplicated, and nothing at zero cost.
 */

function parent(name: string, overrides: Record<string, unknown> = {}): { name: string; dsl: StrategyDsl } {
  return {
    name,
    dsl: StrategyDslSchema.parse({
      name,
      universe: { market: "US", maxPositions: 10 },
      entry: { feature: "rsi14", op: "lt", value: 30 },
      exit: { afterDays: 5, stopLossPct: 3 },
      sizing: { maxPositionPct: 10 },
      costs: { commissionBps: 3, slippageBps: 7 },
      ...overrides,
    }),
  };
}

const empty = { buriedIdentities: new Set<string>(), livingIdentities: new Set<string>() };

describe("a generation", () => {
  it("breeds the requested population from a cold start", () => {
    // No parents at all. The registry starts nearly empty, so a breeder that only mutates would
    // produce nothing on the first run and the factory would never start.
    const report = breedGeneration({ parents: [], ...empty, size: 100, generation: 1, seed: 7 });
    expect(report.candidates).toHaveLength(100);
  });

  it("is reproducible from its seed", () => {
    // A population that cannot be reconstructed destroys the trial count the whole statistical
    // argument rests on — "we cannot say which candidates were evaluated" means the denominator
    // is unknowable.
    const once = breedGeneration({ parents: [], ...empty, size: 20, generation: 1, seed: 42 });
    const twice = breedGeneration({ parents: [], ...empty, size: 20, generation: 1, seed: 42 });
    expect(once.candidates).toEqual(twice.candidates);
  });

  it("produces a different population from a different seed", () => {
    const a = breedGeneration({ parents: [], ...empty, size: 20, generation: 1, seed: 1 });
    const b = breedGeneration({ parents: [], ...empty, size: 20, generation: 1, seed: 2 });
    expect(a.candidates).not.toEqual(b.candidates);
  });
});

describe("what it refuses to emit", () => {
  it("emits nothing the compiler would reject", () => {
    const report = breedGeneration({ parents: [], ...empty, size: 100, generation: 1, seed: 3 });
    for (const candidate of report.candidates) {
      expect(compileStrategy(candidate.dsl).ok).toBe(true);
    }
  });

  it("never re-proposes a buried strategy", () => {
    // Re-testing the dead is how a search convinces itself it has explored. Every rediscovery
    // would also spend a trial to learn something already known.
    const first = breedGeneration({ parents: [], ...empty, size: 30, generation: 1, seed: 11 });
    const buried = new Set(first.candidates.map((candidate) => logicIdentity(candidate.dsl)));

    const second = breedGeneration({
      parents: [],
      buriedIdentities: buried,
      livingIdentities: new Set(),
      size: 30,
      generation: 2,
      seed: 11,
    });
    for (const candidate of second.candidates) {
      expect(buried.has(logicIdentity(candidate.dsl))).toBe(false);
    }
    expect(second.rediscovered).toBeGreaterThan(0);
  });

  it("never duplicates a strategy already in the registry", () => {
    const living = parent("existing");
    const report = breedGeneration({
      parents: [living],
      buriedIdentities: new Set(),
      livingIdentities: new Set([logicIdentity(living.dsl)]),
      size: 40,
      generation: 1,
      seed: 5,
    });
    const identities = report.candidates.map((candidate) => logicIdentity(candidate.dsl));
    expect(identities).not.toContain(logicIdentity(living.dsl));
    expect(new Set(identities).size).toBe(identities.length);
  });

  it("never breeds a zero-cost candidate", () => {
    // A candidate optimised against a market that does not charge for trading out-screens every
    // honest one in the population, and its edge is the spread it was never asked to pay.
    const report = breedGeneration({ parents: [], ...empty, size: 50, generation: 1, seed: 9 });
    for (const candidate of report.candidates) {
      expect(candidate.dsl.costs.commissionBps).toBeGreaterThan(0);
      expect(candidate.dsl.costs.slippageBps).toBeGreaterThan(0);
    }
  });

  it("never thresholds on a raw price level", () => {
    // `close > 100` means something different for every instrument in the universe — such a
    // candidate is an accident of whichever symbol it was bred against, not a strategy.
    const report = breedGeneration({ parents: [], ...empty, size: 60, generation: 1, seed: 13 });
    const serialised = JSON.stringify(report.candidates);
    for (const raw of ['"feature":"close"', '"feature":"open"', '"feature":"volume"']) {
      expect(serialised).not.toContain(raw);
    }
  });

  it("terminates within its attempt budget", () => {
    // The loop discards on three grounds, so without a bound an exhausted space spins forever —
    // and this runs on a fifteen-minute timer where a hung cycle holds the lease until it expires.
    // The discard accounting itself is pinned by "counts every discard" below.
    const report = breedGeneration({ parents: [], ...empty, size: 25, generation: 1, seed: 4 });
    expect(report.attempts).toBeLessThanOrEqual(25 * 10);
    expect(report.candidates.length).toBeLessThanOrEqual(25);
  });
});

describe("lineage", () => {
  it("mutates a parent into a recognisable descendant", () => {
    const report = breedGeneration({
      parents: [parent("rsi_reversion")],
      ...empty,
      size: 60,
      generation: 4,
      seed: 21,
    });
    const mutants = report.candidates.filter((candidate) => candidate.id.includes("_mut_"));
    expect(mutants.length).toBeGreaterThan(0);
    // Structure-preserving: a mutant keeps its parent's shape and moves a threshold, so it stays
    // in the family the multiple-testing correction groups it under.
    for (const mutant of mutants) {
      const entry = mutant.dsl.entry as { feature?: string };
      expect(entry.feature).toBe("rsi14");
    }
  });

  it("names candidates by generation, so a spec's origin is legible from its id", () => {
    const report = breedGeneration({ parents: [], ...empty, size: 5, generation: 8, seed: 2 });
    for (const candidate of report.candidates) {
      expect(candidate.id.startsWith("f8_")).toBe(true);
    }
  });

  it("counts every discard, so an exhausted search is visible rather than silent", () => {
    // 12 candidates from 400 attempts is a finding. A report showing only "12 candidates" hides it.
    const report = breedGeneration({ parents: [], ...empty, size: 100, generation: 1, seed: 6 });
    expect(report.attempts).toBeGreaterThanOrEqual(report.candidates.length);
    expect(report.attempts).toBe(
      report.candidates.length + report.duplicates + report.rediscovered + report.uncompilable,
    );
  });
});
