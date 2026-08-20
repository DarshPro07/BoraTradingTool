import { describe, expect, it } from "vitest";
import { M01_CONTRACT, M01_CONTRACT_HASH, runM01Probe, type DailyBar } from "./probe-m01";
import { M02_CONTRACT } from "./probe-m02";

/**
 * Controls before data, per Foundry policy. On the four probes it has been applied to, it has
 * caught five fixture defects that would each have produced a confident wrong reading.
 */

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

const DATES: string[] = (() => {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(2015, 0, 1));
  while (out.length < 1_200) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
})();

/**
 * A universe where each instrument has a persistent drift, so past winners keep winning.
 *
 * Traded value is held constant across names so liquidity conditioning cannot select on the planted
 * effect — the confound that blinded M02's first positive control and, in a different disguise,
 * S01's.
 */
function syntheticUniverse(momentum: boolean, count = 300): Map<string, DailyBar[]> {
  const random = rng(99);
  const universe = new Map<string, DailyBar[]>();

  for (let k = 0; k < count; k += 1) {
    const persistentDrift = momentum ? (k / count - 0.5) * 0.004 : 0;
    const bars: DailyBar[] = [];
    let price = 100;
    const tradedValue = 100_000_000 + Math.floor(random() * 40_000_000);

    for (const date of DATES) {
      price *= 1 + persistentDrift + (random() - 0.5) * 0.008;
      bars.push({ date, close: price, volume: Math.round(tradedValue / price) });
    }
    universe.set(`SYN:${k}`, bars);
  }
  return universe;
}

const always = () => true;

describe("M01 contract", () => {
  it("differs from M02 in EXACTLY one field", () => {
    // The whole legitimacy of running M01 after M02 failed rests on this. If anything else had
    // moved, it would be a retune wearing a new id.
    expect(M01_CONTRACT.formationSessions).toBe(63);
    expect(M02_CONTRACT.formationSessions).toBe(126);

    for (const field of [
      "holdingSessions",
      "skipSessions",
      "liquidityCohortPct",
      "liquidityLookbackSessions",
      "portfolioFraction",
      "costBpsPerLeg",
      "minCohortSize",
    ] as const) {
      expect(M01_CONTRACT[field], `${field} must match M02`).toBe(M02_CONTRACT[field]);
    }
  });

  it("declares it is not independent of M02", () => {
    // Same mechanism, different diffusion window. A matching result would be one finding about
    // momentum in this cohort, not two.
    expect(M01_CONTRACT.relatedHypotheses).toContain("M02");
    expect(M01_CONTRACT.independentOfRelated).toBe(false);
    expect(M01_CONTRACT.promotionForbidden).toBe(true);
    expect(Object.isFrozen(M01_CONTRACT)).toBe(true);
    expect(M01_CONTRACT_HASH).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("runM01Probe — controls", () => {
  it("DETECTS momentum that is genuinely present", () => {
    const result = runM01Probe(syntheticUniverse(true), always);
    expect(result.rebalances.length).toBeGreaterThan(30);
    expect(result.longShort.grossMeanBps).toBeGreaterThan(50);
    expect(result.longShort.hac.tStatistic).toBeGreaterThan(3);
  });

  it("finds nothing when past returns carry no information", () => {
    const result = runM01Probe(syntheticUniverse(false), always);
    expect(result.rebalances.length).toBeGreaterThan(30);
    expect(Math.abs(result.longShort.grossMeanBps)).toBeLessThan(30);
    expect(Math.abs(result.longShort.hac.tStatistic)).toBeLessThan(2);
  });
});

describe("runM01Probe — construction", () => {
  it("ranks on formation data only", () => {
    const base = syntheticUniverse(true);
    const perturbed = new Map<string, DailyBar[]>();
    const random = rng(7);
    const cutoff = DATES[800]!;
    for (const [id, bars] of base) {
      perturbed.set(id, bars.map((b) => (b.date > cutoff ? { ...b, close: b.close * (1 + random()) } : b)));
    }
    const a = runM01Probe(base, always);
    const b = runM01Probe(perturbed, always);
    const earlyA = a.rebalances.filter((r) => r.date < DATES[740]!);
    const earlyB = b.rebalances.filter((r) => r.date < DATES[740]!);
    expect(earlyA.length).toBeGreaterThan(15);
    expect(JSON.stringify(earlyB)).toBe(JSON.stringify(earlyA));
  });

  it("reports BOTH legs against the cohort", () => {
    // M02's trap was a long leg that looked tradeable while adding almost nothing over its cohort.
    // Reporting the short leg too means a spread cannot hide which side produced it.
    const result = runM01Probe(syntheticUniverse(true), always);
    expect(result.longVsCohort.observations).toBe(result.longShort.observations);
    expect(result.shortVsCohort.observations).toBe(result.longShort.observations);
    expect(result.longVsCohort.grossMeanBps).toBeGreaterThan(0);
    expect(result.shortVsCohort.grossMeanBps).toBeLessThan(0);
  });

  it("is deterministic", () => {
    const universe = syntheticUniverse(true);
    expect(runM01Probe(universe, always).longShort.grossMeanBps).toBe(
      runM01Probe(universe, always).longShort.grossMeanBps,
    );
  });
});
