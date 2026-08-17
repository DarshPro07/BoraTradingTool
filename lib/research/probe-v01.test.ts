import { describe, expect, it } from "vitest";
import { V01_CONTRACT, V01_CONTRACT_HASH, runV01Probe, type DailyBar } from "./probe-v01";

/**
 * V01 is direction-neutral, so two controls are not enough. The probe must recover **three** worlds:
 *
 * ```
 * CONTINUATION  high-volume extreme moves keep going   -> positive interaction
 * REVERSAL      high-volume extreme moves snap back    -> negative interaction
 * NULL          volume says nothing about what follows -> ~zero
 * ```
 *
 * A probe validated only in the direction its author expected would confirm that expectation on
 * real data. This policy has now caught a fixture defect on both previous probes — M02's liquidity
 * correlated with its planted drift, and X01's null reported +213 bps from month-boundary
 * misalignment — so it is applied before V01 is allowed to read the store.
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

/** ~8 years of weekday sessions, so the null is a decisive test rather than a coin flip. */
const DATES: string[] = (() => {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(2015, 0, 1));
  while (out.length < 2_100) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
})();

/**
 * A world where the return following an extreme move depends on the volume it happened under.
 *
 * `effect > 0` continuation, `< 0` reversal, `0` a genuine null. The mechanism is applied only to
 * the interaction: a high-volume mover gets `effect` times its recent move carried into the next
 * calendar month, and a normal-volume mover gets nothing. Volume itself is assigned independently
 * of return, so the two are not confounded — the mistake that blinded M02's positive control.
 *
 * Months are keyed on CALENDAR month, matching the probe's rebalance dates. Index-based blocks
 * drift against calendar month-ends and leak the following month's drift into the holding window,
 * which is exactly how X01's first null manufactured +213 bps.
 */
function syntheticUniverse(effect: number, count = 240, seed = 555): Map<string, DailyBar[]> {
  const random = rng(seed);
  const universe = new Map<string, DailyBar[]>();
  const months = [...new Set(DATES.map((d) => d.slice(0, 7)))].sort();
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const daysOf = new Map<string, string[]>();
  for (const date of DATES) daysOf.set(date.slice(0, 7), [...(daysOf.get(date.slice(0, 7)) ?? []), date]);

  for (let k = 0; k < count; k += 1) {
    // Per month: a shock applied over the final few sessions, and a volume state chosen
    // INDEPENDENTLY of that shock.
    const shocks = months.map(() => (random() - 0.5) * 0.16);
    const highVolume = months.map(() => random() < 0.5);

    const bars: DailyBar[] = [];
    let price = 100;
    const baseVolume = 1_000_000 + Math.floor(random() * 200_000);

    for (const date of DATES) {
      const key = date.slice(0, 7);
      const i = monthIndex.get(key)!;
      const days = daysOf.get(key)!;
      const position = days.indexOf(date);
      const isShockWindow = position >= days.length - V01_CONTRACT.formationSessions;

      // The shock lands in the last 5 sessions — the probe's formation window.
      const shock = isShockWindow ? shocks[i]! / V01_CONTRACT.formationSessions : 0;
      // Continuation/reversal is carried into the NEXT calendar month, and only for high volume.
      const carried = i > 0 && highVolume[i - 1] ? (effect * shocks[i - 1]!) / days.length : 0;

      price *= 1 + shock + carried + (random() - 0.5) * 0.004;
      // Volume is elevated across the shock window when this month is a high-volume month.
      const volume = isShockWindow && highVolume[i] ? baseVolume * 3 : baseVolume;
      bars.push({ date, close: price, volume });
    }
    universe.set(`SYN:${k}`, bars);
  }
  return universe;
}

const always = () => true;

describe("V01 contract", () => {
  it("registers no direction and makes the interaction the primary statistic", () => {
    expect(V01_CONTRACT.priorDirection).toBe("UNKNOWN");
    expect(V01_CONTRACT.primaryStatistic).toBe("INTERACTION_HIGH_MINUS_NORMAL_VOLUME_SPREAD");
    expect(Object.isFrozen(V01_CONTRACT)).toBe(true);
    expect(V01_CONTRACT_HASH).toMatch(/^[0-9a-f]{16}$/);
  });

  it("claims a mechanism, not a trading rule", () => {
    // The source documents return-volume dynamics and investor biases. Reading a rule out of it
    // would be the transfer error the provenance fields exist to prevent.
    expect(V01_CONTRACT.transferAssumption).toBe("MECHANISM_ONLY_NO_TRADING_RULE_CLAIMED");
    expect(V01_CONTRACT.promotionForbidden).toBe(true);
  });
});

describe("runV01Probe — three controls", () => {
  it("recovers CONTINUATION when high-volume moves are engineered to persist", () => {
    const result = runV01Probe(syntheticUniverse(0.6), always);

    expect(result.rebalances.length).toBeGreaterThan(50);
    expect(result.interaction.grossMeanBps).toBeGreaterThan(50);
    expect(result.interaction.hac.tStatistic).toBeGreaterThan(2);
  });

  it("recovers REVERSAL when high-volume moves are engineered to snap back", () => {
    const result = runV01Probe(syntheticUniverse(-0.6), always);

    expect(result.rebalances.length).toBeGreaterThan(50);
    expect(result.interaction.grossMeanBps).toBeLessThan(-50);
    expect(result.interaction.hac.tStatistic).toBeLessThan(-2);
  });

  it("finds nothing when volume carries no information", () => {
    const result = runV01Probe(syntheticUniverse(0), always);

    expect(result.rebalances.length).toBeGreaterThan(50);
    // Asserted on the INFERENCE, not the point estimate. At n~59 a mean of -37 bps is noise, and a
    // tight magnitude bound would be testing the seed rather than the probe. What must hold is that
    // the interval covers zero — and the separation from the planted worlds is enormous either way
    // (+674 and -735 bps against -37).
    expect(Math.abs(result.interaction.hac.tStatistic)).toBeLessThan(2);
    expect(result.interaction.hac.ci95[0]).toBeLessThan(0);
    expect(result.interaction.hac.ci95[1]).toBeGreaterThan(0);
    expect(Math.abs(result.interaction.grossMeanBps)).toBeLessThan(100);
  });
});

describe("runV01Probe — construction", () => {
  it("measures every cell against the same cohort on the same date", () => {
    // Foundry policy after M02: "the portfolio went up" is not selection. In a null world every
    // cell must therefore sit near zero, because each is already an excess return.
    const result = runV01Probe(syntheticUniverse(0), always);
    for (const cell of Object.values(result.cells)) {
      expect(Math.abs(cell.grossMeanBps)).toBeLessThan(60);
    }
  });

  it("reads returns and volume only from before the rebalance date", () => {
    const base = syntheticUniverse(0.6);
    const perturbed = new Map<string, DailyBar[]>();
    const random = rng(3);
    const cutoff = DATES[1_500]!;
    for (const [id, bars] of base) {
      perturbed.set(
        id,
        bars.map((b) =>
          b.date > cutoff ? { ...b, close: b.close * (1 + random()), volume: b.volume * 7 } : b,
        ),
      );
    }
    const a = runV01Probe(base, always);
    const b = runV01Probe(perturbed, always);

    const earlyA = a.rebalances.filter((r) => r.date < DATES[1_400]!);
    const earlyB = b.rebalances.filter((r) => r.date < DATES[1_400]!);
    expect(earlyA.length).toBeGreaterThan(30);
    expect(JSON.stringify(earlyB)).toBe(JSON.stringify(earlyA));
  });

  it("skips a rebalance rather than reporting a cell it could not form", () => {
    // An empty cell filled with zero would read as "no effect" for that regime.
    const tiny = new Map([...syntheticUniverse(0.6)].slice(0, 50));
    expect(runV01Probe(tiny, always).rebalances).toHaveLength(0);
  });

  it("is deterministic", () => {
    const universe = syntheticUniverse(0.6);
    expect(runV01Probe(universe, always).interaction.grossMeanBps).toBe(
      runV01Probe(universe, always).interaction.grossMeanBps,
    );
  });
});
