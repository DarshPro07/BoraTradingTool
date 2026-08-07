import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { MIN_FORWARD_OBSERVATIONS, forwardRecord, openForwardObservation, resolveForwardObservation } from "./forward";

useTemporaryDatabase();

function open(instrument = "US:XNAS:AAPL", entry = 100, stop = 98, at = new Date(2026, 7, 6, 10)) {
  const result = openForwardObservation({
    strategySpecId: "spec_probe",
    instrumentId: instrument,
    entryPrice: entry,
    stopPrice: stop,
    openedAt: at,
  });
  if ("error" in result) throw new Error(result.error);
  return result.id;
}

describe("a prediction is written before its outcome exists", () => {
  it("records an open observation with no R yet", () => {
    open();
    const record = forwardRecord();
    expect(record.observations).toBe(1);
    expect(record.open).toBe(1);
    expect(record.meanR).toBeNull();
  });

  it("refuses a stop equal to entry, which would divide by zero", () => {
    // An R-multiple with no risk denominator arrives as Infinity and dominates every average it
    // touches — a single bad record would make the whole forward mean meaningless.
    const result = openForwardObservation({
      strategySpecId: "s",
      instrumentId: "US:XNAS:AAPL",
      entryPrice: 100,
      stopPrice: 100,
    });
    expect("error" in result && result.error).toMatch(/no risk denominator/);
  });

  it("refuses non-positive prices", () => {
    const result = openForwardObservation({ strategySpecId: "s", instrumentId: "x", entryPrice: 0, stopPrice: 1 });
    expect("error" in result).toBe(true);
  });
});

describe("the risk denominator is fixed at open and cannot be revised", () => {
  it("computes R against the entry and risk recorded up front", () => {
    const id = open("US:XNAS:AAPL", 100, 98); // risk = 2
    const result = resolveForwardObservation(id, 106, "target");
    expect("rMultiple" in result && result.rMultiple).toBe(3); // (106 − 100) / 2
  });

  it("computes a negative R for a loss", () => {
    const id = open("US:XNAS:AAPL", 100, 98);
    const result = resolveForwardObservation(id, 98, "stop");
    expect("rMultiple" in result && result.rMultiple).toBe(-1);
  });

  it("refuses to re-resolve, because that is how a forward record gets laundered", () => {
    // Not an edge case. Re-resolving is the single mechanism by which this table stops being
    // trustworthy, and the person doing it always has a reason.
    const id = open();
    resolveForwardObservation(id, 106, "target");
    const second = resolveForwardObservation(id, 90, "stop");
    expect("error" in second && second.error).toMatch(/already resolved/);
  });

  it("refuses an unknown observation", () => {
    expect("error" in resolveForwardObservation("fwd_nope", 100, "closed")).toBe(true);
  });
});

describe("an open observation is not a favourable one", () => {
  it("excludes open observations from wins, losses and the mean", () => {
    // A record that counts open positions as neither drifts optimistic when losers are left open
    // and winners closed — which is what people do.
    const first = open("US:XNAS:AAPL", 100, 98, new Date(2026, 7, 6, 10));
    open("US:XNAS:MSFT", 200, 190, new Date(2026, 7, 6, 11));
    resolveForwardObservation(first, 98, "stop");

    const record = forwardRecord();
    expect(record.observations).toBe(2);
    expect(record.open).toBe(1);
    expect(record.losses).toBe(1);
    expect(record.wins).toBe(0);
    expect(record.meanR).toBe(-1);
  });

  it("excludes an invalidated setup from the mean rather than grading it", () => {
    // A halt or corporate action is not the strategy being wrong. Grading it as a loss punishes
    // it for something it did not do; grading it as a win is obviously worse.
    const id = open();
    resolveForwardObservation(id, 101, "invalidated");
    const record = forwardRecord();
    expect(record.resolved).toBe(1);
    expect(record.meanR).toBeNull();
    expect(record.wins + record.losses).toBe(0);
  });
});

describe("a small sample says so, loudly", () => {
  it("withholds the win rate below the threshold", () => {
    const id = open();
    resolveForwardObservation(id, 106, "target");
    const record = forwardRecord();
    // One win is 100%. Showing that figure with a caveat beside it does not help — a percentage
    // on a screen is read as a finding regardless of what is written next to it.
    expect(record.winRate).toBeNull();
    expect(record.isEvidence).toBe(false);
    expect(record.summary).toMatch(/cannot separate an edge from chance/);
  });

  it("reports a win rate and standard error once the sample is large enough", () => {
    for (let index = 0; index < MIN_FORWARD_OBSERVATIONS; index += 1) {
      const id = open(`US:XNAS:T${index}`, 100, 98, new Date(2026, 7, 6, 10, index));
      resolveForwardObservation(id, index % 2 === 0 ? 104 : 98, index % 2 === 0 ? "target" : "stop");
    }
    const record = forwardRecord();
    expect(record.isEvidence).toBe(true);
    expect(record.winRate).toBeCloseTo(0.5, 6);
    expect(record.standardError).not.toBeNull();
    expect(record.summary).toMatch(/only unbiased evidence/);
  });

  it("says plainly that nothing here is unbiased when the table is empty", () => {
    expect(forwardRecord().summary).toMatch(/nothing here is unbiased evidence/);
  });
});

describe("records are addressable per strategy", () => {
  it("filters by spec", () => {
    open();
    expect(forwardRecord("spec_probe").observations).toBe(1);
    expect(forwardRecord("spec_other").observations).toBe(0);
  });
});
