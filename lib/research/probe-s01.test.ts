import { describe, expect, it } from "vitest";
import { S01_CONTRACT, S01_CONTRACT_HASH, runS01Probe, type DailyBar } from "./probe-s01";

/**
 * Foundry policy: no real-data result is trusted until the probe detects a planted effect in both
 * directions and stays silent in a genuine null. That policy has now caught a fixture defect on
 * every probe it has been applied to.
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

/** ~7 years — S01 needs 252 sessions of formation before its first rebalance. */
const DATES: string[] = (() => {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(2015, 0, 1));
  while (out.length < 1_800) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
})();

/**
 * A universe where each instrument has a persistent return skewness, and `effect` links that
 * skewness to next-month return.
 *
 * **The jumps are mean-compensated**, which is the whole difficulty. A first version gave
 * right-skewed names occasional +6% jumps and left-skewed names -6% jumps with no offset, so the
 * high-skew group carried a built-in +24 bps/session drift that swamped the planted link entirely:
 * the NEGATIVE control returned +30.9 bps, the wrong sign, because the fixture's own drift decided
 * the answer. Real skewness is many small losses against rare large gains at roughly zero mean, and
 * only a fixture built that way isolates skew from return.
 *
 * **Volume is set so traded value is constant across names**, which is the second trap. Liquidity is
 * `close x volume`, and a planted drift makes the high-skew group's prices diverge upward — so the
 * top-30% liquidity cohort silently fills with winners and both quintiles end up drawn from the
 * same planted group, leaving no contrast to measure. That is M02's confound wearing `close`
 * instead of `volume`: tripling the planted effect moved the measured spread from 38 to 43 bps,
 * a response so far from proportional that it could only be a fixture fault.
 */
function syntheticUniverse(effect: number, count = 200, seed = 8_191): Map<string, DailyBar[]> {
  const random = rng(seed);
  const universe = new Map<string, DailyBar[]>();
  const daysOf = new Map<string, string[]>();
  for (const d of DATES) daysOf.set(d.slice(0, 7), [...(daysOf.get(d.slice(0, 7)) ?? []), d]);

  const JUMP_PROBABILITY = 0.04;
  const JUMP_SIZE = 0.06;
  // Offsets the jump so the group's mean return is unchanged; only the third moment moves.
  const COMPENSATION = (JUMP_PROBABILITY * JUMP_SIZE) / (1 - JUMP_PROBABILITY);

  for (let k = 0; k < count; k += 1) {
    // -1 = left-skewed, +1 = right-skewed. Fixed per instrument, so skew is persistent.
    const skewSign = k / count < 0.5 ? -1 : 1;
    const bars: DailyBar[] = [];
    let price = 100;
    const tradedValue = 100_000_000 + Math.floor(random() * 40_000_000);

    for (const date of DATES) {
      const jumped = random() < JUMP_PROBABILITY;
      const shock = jumped ? skewSign * JUMP_SIZE : -skewSign * COMPENSATION;
      // The link under test, and the ONLY thing that should differ in mean between the groups.
      const drift = (effect * skewSign) / daysOf.get(date.slice(0, 7))!.length;
      price *= 1 + drift + shock + (random() - 0.5) * 0.006;
      // Traded value held constant, so liquidity conditioning cannot select on the planted effect.
      bars.push({ date, close: price, volume: Math.round(tradedValue / price) });
    }
    universe.set(`SYN:${k}`, bars);
  }
  return universe;
}

const always = () => true;

describe("S01 contract", () => {
  it("declares that it is NOT independent of X01", () => {
    // The single most important field here. A matching S01 result is one finding about lottery
    // demand, not a second vote — and a future agent counting evidence must be able to see that.
    expect(S01_CONTRACT.mechanismFamily).toBe("LOTTERY_PREFERENCE_AND_HIGHER_MOMENTS");
    expect(S01_CONTRACT.relatedHypotheses).toContain("X01");
    expect(S01_CONTRACT.independentOfRelated).toBe(false);
  });

  it("registers no direction and is frozen", () => {
    expect(S01_CONTRACT.priorDirection).toBe("UNKNOWN");
    expect(S01_CONTRACT.spreadDefinition).toBe("HIGH_SKEW_MINUS_LOW_SKEW");
    expect(S01_CONTRACT.promotionForbidden).toBe(true);
    expect(Object.isFrozen(S01_CONTRACT)).toBe(true);
    expect(S01_CONTRACT_HASH).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("runS01Probe — three controls", () => {
  it("recovers a POSITIVE skew/return relation when planted", () => {
    const result = runS01Probe(syntheticUniverse(0.06), always);
    expect(result.rebalances.length).toBeGreaterThan(30);
    expect(result.spread.grossMeanBps).toBeGreaterThan(50);
    expect(result.spread.hac.tStatistic).toBeGreaterThan(2);
  });

  it("recovers a NEGATIVE relation when planted", () => {
    const result = runS01Probe(syntheticUniverse(-0.06), always);
    expect(result.rebalances.length).toBeGreaterThan(30);
    expect(result.spread.grossMeanBps).toBeLessThan(-50);
    expect(result.spread.hac.tStatistic).toBeLessThan(-2);
  });

  it("finds nothing when skew carries no information about future returns", () => {
    // The null still has strongly skewed instruments — they simply predict nothing. A probe that
    // reported an effect here would be reading skew itself rather than its relation to returns.
    const result = runS01Probe(syntheticUniverse(0), always);
    expect(result.rebalances.length).toBeGreaterThan(30);
    expect(Math.abs(result.spread.hac.tStatistic)).toBeLessThan(2);
    expect(result.spread.hac.ci95[0]).toBeLessThan(0);
    expect(result.spread.hac.ci95[1]).toBeGreaterThan(0);
  });
});

describe("runS01Probe — construction", () => {
  it("reports the high-skew leg with MAX-extreme names removed", () => {
    // The decisive falsification: if S01 is X01 in disguise, stripping the lottery-day names should
    // leave nothing behind. The statistic has to exist for that question to be answerable at all.
    const result = runS01Probe(syntheticUniverse(0.06), always);
    expect(result.highExMaxVsCohort.observations).toBe(result.spread.observations);
    expect(Number.isFinite(result.highExMaxVsCohort.grossMeanBps)).toBe(true);
  });

  it("reads only bars before the rebalance date", () => {
    const base = syntheticUniverse(0.06);
    const perturbed = new Map<string, DailyBar[]>();
    const random = rng(5);
    const cutoff = DATES[1_400]!;
    for (const [id, bars] of base) {
      perturbed.set(id, bars.map((b) => (b.date > cutoff ? { ...b, close: b.close * (1 + random()) } : b)));
    }
    const a = runS01Probe(base, always);
    const b = runS01Probe(perturbed, always);
    const earlyA = a.rebalances.filter((r) => r.date < DATES[1_300]!);
    const earlyB = b.rebalances.filter((r) => r.date < DATES[1_300]!);
    expect(earlyA.length).toBeGreaterThan(20);
    expect(JSON.stringify(earlyB)).toBe(JSON.stringify(earlyA));
  });

  it("is deterministic", () => {
    const universe = syntheticUniverse(0.06);
    expect(runS01Probe(universe, always).spread.grossMeanBps).toBe(
      runS01Probe(universe, always).spread.grossMeanBps,
    );
  });
});
