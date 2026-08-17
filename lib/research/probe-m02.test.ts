import { describe, expect, it } from "vitest";
import { M02_CONTRACT, M02_CONTRACT_HASH, runM02Probe, type DailyBar } from "./probe-m02";

/**
 * The probe reported a NEGATIVE factor spread on real data. That number is worth nothing unless the
 * probe can detect momentum that is genuinely present — an instrument that cannot find an effect
 * reports "no effect" identically whether or not one exists.
 *
 * So the decisive test here is the positive control: build a universe with momentum engineered in
 * and require the probe to find it.
 */

/** Deterministic — a probe result that changes between runs is not a measurement. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };
}

/** ~4 years of weekday sessions — enough for formation + hold + many rebalances. */
const DATES: string[] = (() => {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(2015, 0, 1));
  while (out.length < 1_000) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
})();

/**
 * A universe where each instrument has a persistent drift.
 *
 * `momentum: true` gives each name a fixed drift, so the leaders over six months are the leaders
 * over the next month — the effect the probe must detect. `false` removes the persistent component
 * entirely, leaving pure noise.
 *
 * Two things here were wrong in a first version and are worth stating, because each would have
 * produced a confident wrong conclusion:
 *
 * 1. **Volume must not scale with drift.** It did, so the top-10% liquidity cohort contained only
 *    high-drift names with no dispersion left to rank, and the positive control read ~0 bps — as
 *    though the probe were blind when the fixture was the problem.
 * 2. **The null must have no persistent component at all.** The first version re-randomised drift
 *    every 21 days, which is the holding period, so recent formation genuinely predicted the hold
 *    and the "null" showed +44 bps at t=2.25. A negative control that is not null silently licenses
 *    trusting the instrument.
 */
function syntheticUniverse(momentum: boolean, count = 300): Map<string, DailyBar[]> {
  const random = rng(99);
  const universe = new Map<string, DailyBar[]>();

  for (let k = 0; k < count; k += 1) {
    const persistentDrift = momentum ? (k / count - 0.5) * 0.004 : 0;
    const bars: DailyBar[] = [];
    let price = 100;
    // Independent of drift, or liquidity conditioning would select on the effect being measured.
    const volume = 1_000_000 + Math.floor(random() * 500_000);

    for (const date of DATES) {
      price *= 1 + persistentDrift + (random() - 0.5) * 0.008;
      bars.push({ date, close: price, volume });
    }
    universe.set(`SYN:${k}`, bars);
  }
  return universe;
}

const always = () => true;

describe("M02 contract", () => {
  it("is frozen and hashed, so a changed parameter cannot pass as the same probe", () => {
    expect(M02_CONTRACT_HASH).toMatch(/^[0-9a-f]{16}$/);
    expect(M02_CONTRACT.formationSessions).toBe(126);
    expect(M02_CONTRACT.holdingSessions).toBe(21);
    expect(M02_CONTRACT.liquidityCohortPct).toBe(0.1);
    expect(Object.isFrozen(M02_CONTRACT)).toBe(true);
  });

  it("declares what it is not", () => {
    // The naming rule applied to a research result: this is not a replication and must not read
    // as one. The source conditions on turnover ratio; this substitutes rupee traded value.
    expect(M02_CONTRACT.replicationStatus).toBe("NOT_A_DIRECT_REPLICATION");
    expect(M02_CONTRACT.evidenceMarket).toBe("INDIA_BSE");
    expect(M02_CONTRACT.targetMarket).toBe("NSE");
    expect(M02_CONTRACT.transferAssumption).toBe("UNPROVEN");
    expect(M02_CONTRACT.promotionForbidden).toBe(true);
    expect(M02_CONTRACT.knownBias).toMatch(/survivorship/i);
  });
});

describe("runM02Probe — the positive control", () => {
  it("DETECTS momentum that is genuinely present", () => {
    // Without this passing, the negative result on real data is uninterpretable.
    const result = runM02Probe(syntheticUniverse(true), always);

    expect(result.rebalances.length).toBeGreaterThan(20);
    expect(
      result.longShort.grossMeanBps,
      "engineered persistent drift must produce a positive winner-minus-loser spread",
    ).toBeGreaterThan(50);
    expect(result.longShort.hac.tStatistic).toBeGreaterThan(3);
  });

  it("finds no spread when past returns carry no information about future ones", () => {
    // The negative control. A probe that reports momentum in a universe without it would explain
    // any positive real-data result as an artifact.
    const result = runM02Probe(syntheticUniverse(false), always);

    expect(result.rebalances.length).toBeGreaterThan(20);
    expect(Math.abs(result.longShort.grossMeanBps)).toBeLessThan(30);
    expect(Math.abs(result.longShort.hac.tStatistic)).toBeLessThan(2);
  });
});

describe("runM02Probe — no lookahead", () => {
  it("ranks on formation data only, so altering the future cannot change the selection", () => {
    // The guarantee that makes the whole probe meaningful. Ranking is computed at t from bars up to
    // t; if changing bars AFTER t altered which names were picked, the result would be lookahead.
    const base = syntheticUniverse(true);
    const perturbed = new Map<string, DailyBar[]>();
    const random = rng(7);
    const cutoff = DATES[600]!;
    for (const [id, bars] of base) {
      perturbed.set(
        id,
        bars.map((bar) => (bar.date > cutoff ? { ...bar, close: bar.close * (1 + random()) } : bar)),
      );
    }

    const a = runM02Probe(base, always);
    const b = runM02Probe(perturbed, always);

    // Rebalances entirely before the cutoff must be identical — same cohorts, same returns.
    const beforeA = a.rebalances.filter((r) => r.date < DATES[560]!);
    const beforeB = b.rebalances.filter((r) => r.date < DATES[560]!);
    expect(beforeA.length).toBeGreaterThan(10);
    expect(JSON.stringify(beforeB)).toBe(JSON.stringify(beforeA));
  });

  it("is deterministic — the same universe produces the same numbers", () => {
    const universe = syntheticUniverse(true);
    const a = runM02Probe(universe, always);
    const b = runM02Probe(universe, always);
    expect(b.longShort.grossMeanBps).toBe(a.longShort.grossMeanBps);
    expect(b.contractHash).toBe(a.contractHash);
  });
});

describe("runM02Probe — point-in-time universe", () => {
  it("never ranks an instrument that was not yet listed", () => {
    // Survivorship's sibling: ranking a stock at a date it had not listed uses history it did not
    // have. The probe must consult eligibility, not merely the presence of bars.
    const universe = syntheticUniverse(true, 600);
    const embargoed = new Set([...universe.keys()].slice(0, 200));
    const listedLate = (id: string, date: string) => !embargoed.has(id) || date > DATES[700]!;

    const result = runM02Probe(universe, listedLate);
    const early = result.rebalances.filter((r) => r.date <= DATES[700]!);

    expect(early.length).toBeGreaterThan(5);
    // Half the universe is invisible early on, so the 10% cohort must be about half as large.
    const earlyCohort = early.at(-1)!.cohortSize;
    const lateCohort = result.rebalances.at(-1)!.cohortSize;
    expect(earlyCohort).toBeLessThan(lateCohort);
  });

  it("skips a rebalance rather than ranking too small a cohort", () => {
    // A 4-name "decile" is not a cross-sectional measurement. Refusing beats reporting.
    const tiny = new Map([...syntheticUniverse(true)].slice(0, 40));
    const result = runM02Probe(tiny, always);
    expect(result.rebalances).toHaveLength(0);
  });
});

describe("runM02Probe — the decomposition that matters", () => {
  it("reports the long-only leg against its own cohort, not only in absolute terms", () => {
    // On real data the long-only leg showed +122 bps gross while adding only +12.5 bps over its
    // cohort — almost all of it market exposure. Without this measure a long-only backtest reads
    // as a strategy when it is beta.
    const result = runM02Probe(syntheticUniverse(true), always);

    expect(result.longVsCohort.observations).toBe(result.longOnly.observations);
    for (const r of result.rebalances) {
      expect(Number.isFinite(r.cohortGross)).toBe(true);
    }
    // With genuine momentum the winners must beat the cohort, not merely be positive.
    expect(result.longVsCohort.grossMeanBps).toBeGreaterThan(0);
  });
});
