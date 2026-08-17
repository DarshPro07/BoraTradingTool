import { describe, expect, it } from "vitest";
import { X01_CONTRACT, X01_CONTRACT_HASH, runX01Probe, type DailyBar } from "./probe-x01";

/**
 * Foundry policy, applied before X01 is allowed to read real data:
 *
 * > No real-data probe result is trusted until the probe has both a known-positive synthetic world
 * > it detects, and a genuine null world in which it does not hallucinate an effect.
 *
 * The null matters especially here. Extreme-return fixtures create volatility clustering very
 * easily, and a stock that is volatile in the formation month tends to be volatile in the holding
 * month — which can manufacture a MAX/return relationship out of nothing at all. That is the same
 * class of mistake M02's first null made by re-randomising drift on the holding period.
 *
 * X01 is direction-neutral, so the positive control is run in BOTH directions: the probe must
 * recover the sign it was given, not merely register that something is there.
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

/** ~10 years of weekday sessions. Long enough that the null control is a decisive test, not a
 * coin-flip: at 800 sessions it had 34 rebalances and a 48 bps point estimate that was statistically
 * silent but visually alarming. */
const DATES: string[] = (() => {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(2015, 0, 1));
  while (out.length < 2_600) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
})();

const MONTH = 21;

/**
 * A universe in which a stock's prior-month MAX is linked to its next-month return by `effect`.
 *
 * Each instrument draws an independent "spike" per CALENDAR month, which sets that month's MAX;
 * with `effect` non-zero, the spike then drives a drift in the FOLLOWING calendar month.
 *
 * **Calendar months, not 21-session blocks.** A first version keyed months off `floor(i / 21)`
 * while rebalances land on calendar month-ends. The two drift apart, so a formation window could
 * straddle two synthetic months and pick up a spike whose companion drift landed inside the holding
 * window — and the NULL world reported **+213 bps**, a large effect manufactured entirely by fixture
 * misalignment. That is exactly the artifact the null control exists to catch, and it would
 * otherwise have validated the probe on a lie.
 *
 * `effect = 0` is now a genuine null: spikes vary hugely across stocks and months and carry no
 * information about what follows. Base volatility is identical across names, so no volatility
 * clustering can leak a relation the fixture did not intend.
 */
function syntheticUniverse(effect: number, count = 200, seed = 4242): Map<string, DailyBar[]> {
  const random = rng(seed);
  const universe = new Map<string, DailyBar[]>();

  const months = [...new Set(DATES.map((d) => d.slice(0, 7)))].sort();
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const daysInMonth = new Map<string, string[]>();
  for (const date of DATES) {
    const key = date.slice(0, 7);
    daysInMonth.set(key, [...(daysInMonth.get(key) ?? []), date]);
  }

  for (let k = 0; k < count; k += 1) {
    const spikes = months.map(() => random() * 0.10); // 0-10%, independent every month
    const spikeDate = new Map(
      months.map((m) => {
        const days = daysInMonth.get(m)!;
        return [m, days[Math.floor(random() * days.length)]!];
      }),
    );

    const bars: DailyBar[] = [];
    let price = 100;
    const volume = 1_000_000 + Math.floor(random() * 500_000);

    for (const date of DATES) {
      const key = date.slice(0, 7);
      const i = monthIndex.get(key)!;
      const carried = i > 0 ? spikes[i - 1]! : 0.05;
      const drift = (effect * (carried - 0.05)) / daysInMonth.get(key)!.length;
      const spike = spikeDate.get(key) === date ? spikes[i]! : 0;

      price *= 1 + drift + spike + (random() - 0.5) * 0.004;
      bars.push({ date, close: price, volume });
    }
    universe.set(`SYN:${k}`, bars);
  }
  return universe;
}

const always = () => true;

describe("X01 contract", () => {
  it("registers NO directional prior, because the Indian evidence contradicts itself", () => {
    expect(X01_CONTRACT.priorDirection).toBe("UNKNOWN");
    expect(X01_CONTRACT.spreadDefinition).toBe("HIGH_MAX_MINUS_LOW_MAX");
    expect(Object.isFrozen(X01_CONTRACT)).toBe(true);
    expect(X01_CONTRACT_HASH).toMatch(/^[0-9a-f]{16}$/);
  });

  it("declares the price-band censoring it cannot model", () => {
    // MAX is literally the largest observed daily return, and NSE bands cap it by exchange rule.
    // Inventing historical bands would fabricate the variable under test.
    expect(X01_CONTRACT.priceBandCensoring).toBe("KNOWN_UNMODELED_LIMITATION");
    expect(X01_CONTRACT.replicationStatus).toBe("NOT_A_DIRECT_REPLICATION");
    expect(X01_CONTRACT.promotionForbidden).toBe(true);
  });
});

describe("runX01Probe — controls, run before any real data is believed", () => {
  it("recovers a POSITIVE relation when one is planted", () => {
    const result = runX01Probe(syntheticUniverse(1.0), always);

    expect(result.rebalances.length).toBeGreaterThan(100);
    expect(result.spread.grossMeanBps).toBeGreaterThan(50);
    expect(result.spread.hac.tStatistic).toBeGreaterThan(2);
  });

  it("recovers a NEGATIVE relation when one is planted", () => {
    // Direction-neutral means the instrument must be able to report either sign. A probe validated
    // only in the direction its author expected would confirm that expectation on real data.
    const result = runX01Probe(syntheticUniverse(-1.0), always);

    expect(result.rebalances.length).toBeGreaterThan(100);
    expect(result.spread.grossMeanBps).toBeLessThan(-50);
    expect(result.spread.hac.tStatistic).toBeLessThan(-2);
  });

  it("finds nothing in a genuine null world", () => {
    // The trap this guards: MAX is an extreme-return statistic, so a fixture where volatile stocks
    // stay volatile would produce a MAX/return relation from clustering alone.
    const result = runX01Probe(syntheticUniverse(0), always);

    expect(result.rebalances.length).toBeGreaterThan(100);
    expect(Math.abs(result.spread.grossMeanBps)).toBeLessThan(30);
    expect(Math.abs(result.spread.hac.tStatistic)).toBeLessThan(2);
  });
});

describe("runX01Probe — construction", () => {
  it("computes MAX from the formation window only", () => {
    // If a bar at or after the exit date could reach MAX, the ranking would use the return it is
    // being tested against.
    const base = syntheticUniverse(1.0);
    const perturbed = new Map<string, DailyBar[]>();
    const random = rng(11);
    const cutoff = DATES[1_800]!;
    for (const [id, bars] of base) {
      perturbed.set(
        id,
        bars.map((b) => (b.date > cutoff ? { ...b, close: b.close * (1 + random()) } : b)),
      );
    }
    const a = runX01Probe(base, always);
    const b = runX01Probe(perturbed, always);

    const earlyA = a.rebalances.filter((r) => r.date < DATES[1_700]!);
    const earlyB = b.rebalances.filter((r) => r.date < DATES[1_700]!);
    expect(earlyA.length).toBeGreaterThan(50);
    expect(JSON.stringify(earlyB)).toBe(JSON.stringify(earlyA));
  });

  it("reports both legs against the cohort, not only against each other", () => {
    // M02's long-only leg looked tradeable at +122 bps while adding +12.5 bps over its cohort.
    // Without this, a leg that is pure market exposure reads as selection.
    const result = runX01Probe(syntheticUniverse(1.0), always);
    expect(result.highVsCohort.observations).toBe(result.spread.observations);
    expect(result.lowVsCohort.observations).toBe(result.spread.observations);
    // A planted positive relation must put the high leg above the cohort and the low leg below.
    expect(result.highVsCohort.grossMeanBps).toBeGreaterThan(0);
    expect(result.lowVsCohort.grossMeanBps).toBeLessThan(0);
  });

  it("skips a rebalance rather than ranking too small a cohort", () => {
    const tiny = new Map([...syntheticUniverse(1.0)].slice(0, 30));
    expect(runX01Probe(tiny, always).rebalances).toHaveLength(0);
  });

  it("is deterministic", () => {
    const universe = syntheticUniverse(1.0);
    expect(runX01Probe(universe, always).spread.grossMeanBps).toBe(
      runX01Probe(universe, always).spread.grossMeanBps,
    );
  });
});
