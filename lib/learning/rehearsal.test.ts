import { describe, expect, it } from "vitest";
import { runValidationRehearsal } from "./rehearsal";
import type { Candle } from "@/lib/providers/types";

/**
 * The load-bearing assertion in this file is the one that looks like it does nothing:
 * `recordedNothing`. A rehearsal that quietly wrote a trial would raise the statistical bar for
 * every candidate it touched, on a timer, with no owner instruction and no way to undo it.
 */

function bars(count = 400, phase = 0): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin((index + phase) / 9) * 6 + index * 0.04;
    return { time: 1_700_000_000 + index * 86_400, open: close * 0.998, high: close * 1.01, low: close * 0.99, close, volume: 1_000_000 };
  });
}

/** A dataset of several instruments, so the position cap can actually bind. */
function dataset(instruments = 4): Record<string, Candle[]> {
  return Object.fromEntries(
    Array.from({ length: instruments }, (_, index) => [`US:XNAS:T${index}`, bars(400, index * 30)]),
  );
}

const loader = (data: Record<string, Candle[]> = dataset()) => async () => data;

describe("mode gating comes from the policy, not from a second ladder", () => {
  it("refuses at off", async () => {
    const report = await runValidationRehearsal(loader(), "off");
    expect(report.evaluated).toBe(0);
    expect(report.skipped[0]).toMatch(/requires learning mode/);
  });

  it("refuses at observing, naming the mode it needs", async () => {
    const report = await runValidationRehearsal(loader(), "observing");
    expect(report.evaluated).toBe(0);
    expect(report.skipped[0]).toMatch(/"learning"/);
  });

  it("still records nothing when it refuses", async () => {
    expect((await runValidationRehearsal(loader(), "off")).recordedNothing).toBe(true);
  });

  it("does not even ask the provider for candles when the mode forbids it", async () => {
    let called = 0;
    await runValidationRehearsal(async () => {
      called += 1;
      return dataset();
    }, "observing");
    expect(called).toBe(0);
  });
});

describe("running at learning mode", () => {
  it("records nothing, whatever it finds", async () => {
    const report = await runValidationRehearsal(loader(), "learning");
    expect(report.recordedNothing).toBe(true);
  });

  it("survives a provider that throws, without calling the outage 'no data'", async () => {
    const report = await runValidationRehearsal(async () => {
      throw new Error("provider down");
    }, "learning");
    expect(report.recordedNothing).toBe(true);
    for (const outcome of report.outcomes) {
      expect(outcome.verdict).toBe("not_evaluable");
    }
  });

  it("reports missing candles rather than substituting a default series", async () => {
    const report = await runValidationRehearsal(async () => ({}), "learning");
    for (const outcome of report.outcomes) {
      expect(outcome.verdict).toBe("not_evaluable");
      // Either honest refusal is acceptable — the feature gap or the data gap — but it must be
      // one of them, naming a specific cause. What is never acceptable is a fabricated series
      // producing trades out of nothing.
      expect(outcome.reason).toMatch(/FEATURE_NOT_AVAILABLE|Missing data is reported|INSUFFICIENT_BARS/);
      expect(outcome.trades).toBe(0);
      expect(outcome.battery).toBeNull();
    }
  });

  it("does not touch the provider for a strategy whose features it cannot derive", async () => {
    // The bug this pins: the fetch used to run first, so twelve instruments × three years were
    // pulled on every cycle before discovering the strategy needed `market_cap` — which no
    // amount of price history supplies. On a slow link that was twelve connect timeouts, every
    // fifteen minutes, indefinitely.
    let calls = 0;
    const report = await runValidationRehearsal(async () => {
      calls += 1;
      return {};
    }, "learning");

    const featureBlocked = report.outcomes.filter((outcome) =>
      outcome.reason.includes("FEATURE_NOT_AVAILABLE"),
    ).length;
    if (report.outcomes.length > 0 && featureBlocked === report.outcomes.length) {
      expect(calls).toBe(0);
    }
    // Whatever the mix, the loader is never called more often than there are candidates.
    expect(calls).toBeLessThanOrEqual(report.outcomes.length);
  });

  it("reports an empty candle array the same way as a missing instrument", async () => {
    const report = await runValidationRehearsal(async () => ({ "US:XNAS:T0": [] }), "learning");
    for (const outcome of report.outcomes) {
      expect(outcome.verdict).toBe("not_evaluable");
    }
  });

  it("walks every instrument in the dataset, not just the first", async () => {
    const report = await runValidationRehearsal(loader(dataset(4)), "learning");
    for (const outcome of report.outcomes) {
      // A market-wide DSL judged on one instrument has unlimited position slots, so
      // maxPositions never binds and its real capacity is invisible.
      if (outcome.verdict !== "not_evaluable") expect(outcome.instrumentsEvaluated).toBe(4);
    }
  });

  it("does not call an inconclusive battery a failure", async () => {
    // Barely enough bars to backtest, nowhere near the 30 trades the battery needs. The
    // candidate is unproven, not refuted, and retiring it here would be for the wrong reason.
    const thin = { "US:XNAS:T0": bars(60) };
    const report = await runValidationRehearsal(loader(thin), "learning");
    for (const outcome of report.outcomes) {
      if (outcome.battery?.verdict === "inconclusive") expect(outcome.verdict).toBe("not_evaluable");
    }
  });

  it("never claims a candidate is proven, only that it would survive", async () => {
    const report = await runValidationRehearsal(loader(), "learning");
    for (const outcome of report.outcomes) {
      expect(["would_pass", "would_fail", "not_evaluable"]).toContain(outcome.verdict);
    }
    // The word "proven" must not appear: a rehearsal is not evidence and the summary says so.
    expect(report.summary.toLowerCase()).not.toContain("proven");

    // Both branches assert. Keying this off the summary text matched "none would survive" too,
    // and a conditional that can fall through asserts nothing on the path it skips.
    if (report.outcomes.some((outcome) => outcome.verdict === "would_pass")) {
      expect(report.summary).toMatch(/not evidence/);
    } else {
      expect(report.summary).toMatch(/No trial was spent/);
    }
  });

  it("is deterministic across runs, so a candidate cannot be re-rolled into passing", async () => {
    const once = await runValidationRehearsal(loader(), "learning", new Date(0));
    const twice = await runValidationRehearsal(loader(), "learning", new Date(0));
    expect(once).toEqual(twice);
  });

  it("stamps when it ran", async () => {
    const at = new Date("2026-08-06T12:00:00.000Z");
    expect((await runValidationRehearsal(loader(), "learning", at)).ranAt).toBe(at.toISOString());
  });
});
