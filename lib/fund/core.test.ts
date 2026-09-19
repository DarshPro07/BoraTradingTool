import { describe, expect, it } from "vitest";
import { MANDATES, isDecisionDate, mandateHash, shiftDate, signal, type Close } from "./mandates";
import { maxDrawdown, mandateMetrics, minTrackRecordLength, trustGates } from "./metrics";

const FN1 = MANDATES.find((m) => m.id === "FN1")!;
const FC1 = MANDATES.find((m) => m.id === "FC1")!;

const series = (start: string, values: number[]): Close[] =>
  values.map((close, i) => ({ date: shiftDate(start, i), close }));

describe("mandates are frozen", () => {
  it("cannot be mutated, and each has a stable distinct hash", () => {
    expect(Object.isFrozen(MANDATES) && Object.isFrozen(FN1)).toBe(true);
    const hashes = MANDATES.map(mandateHash);
    expect(new Set(hashes).size).toBe(MANDATES.length);
    expect(mandateHash(FN1)).toBe(mandateHash(FN1));
  });
});

describe("signal", () => {
  it("ABOVE_SMA holds above the 200-session average, exits below it, and abstains short of 200", () => {
    const rising = series("2025-01-01", Array.from({ length: 200 }, (_, i) => 100 + i));
    expect(signal(FN1, rising)?.hold).toBe(true);
    const crashed = [...rising.slice(0, 199), { date: "2025-07-19", close: 50 }];
    expect(signal(FN1, crashed)?.hold).toBe(false);
    expect(signal(FN1, rising.slice(1)), "199 sessions is not enough; missing is not 'out'").toBeNull();
  });

  it("TRAILING_RETURN_POSITIVE compares with the close 28 days earlier", () => {
    const up = series("2026-08-01", Array.from({ length: 40 }, (_, i) => 100 + i));
    const s = signal(FC1, up)!;
    expect(s.hold).toBe(true);
    expect(s.inputs.pastDate).toBe(shiftDate(up.at(-1)!.date, -28));
    const down = series("2026-08-01", Array.from({ length: 40 }, (_, i) => 200 - i));
    expect(signal(FC1, down)?.hold).toBe(false);
    expect(signal(FC1, up.slice(-10))).toBeNull();
  });
});

describe("decision dates", () => {
  it("FN1 decides on the last session of the month, including across a weekend", () => {
    expect(isDecisionDate(FN1, "2026-09-30")).toBe(true);
    expect(isDecisionDate(FN1, "2026-09-29")).toBe(false);
    // 2026-10-31 is a Saturday: Friday the 30th is the month's last session.
    expect(isDecisionDate(FN1, "2026-10-30")).toBe(true);
  });

  it("FC1 decides on the Sunday UTC bar (the Monday 00:00 close)", () => {
    expect(isDecisionDate(FC1, "2026-09-20")).toBe(true);
    expect(isDecisionDate(FC1, "2026-09-19")).toBe(false);
  });
});

describe("metrics", () => {
  it("max drawdown is the worst peak-to-trough", () => {
    expect(maxDrawdown([100, 120, 90, 130, 104])).toBeCloseTo(0.25, 12);
  });

  it("MinTRL is infinite for a non-positive Sharpe and shrinks as Sharpe grows", () => {
    expect(minTrackRecordLength([0.01, -0.02, 0.01, -0.02])).toBe(Number.POSITIVE_INFINITY);
    const weak = Array.from({ length: 200 }, (_, i) => (i % 2 ? 0.012 : -0.01));
    const strong = Array.from({ length: 200 }, (_, i) => (i % 2 ? 0.02 : -0.01));
    expect(minTrackRecordLength(strong)).toBeLessThan(minTrackRecordLength(weak));
  });

  it("MinTRL matches 1 + (z/SR)^2 for a symmetric two-point process (skew 0, kurtosis ~1)", () => {
    const xs = Array.from({ length: 1_000 }, (_, i) => (i % 2 ? 0.03 : -0.01));
    const mean = 0.01;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1));
    const expected = 1 + (1.6448536269514722 / (mean / sd)) ** 2;
    expect(minTrackRecordLength(xs) / expected).toBeCloseTo(1, 1);
  });

  it("gates stay shut on a short record, whatever the returns look like", () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ date: shiftDate("2026-09-01", i), nav: 100 + i, benchmark: 100 }));
    const gates = trustGates(FC1, mandateMetrics(points, 365), {
      decisionDatesDue: 3, decisionDatesRecorded: 3, unexplainedFailures: 0, decisionPoints: 3,
    });
    expect(gates.T1_OPERATIONAL).toBe(false);
    expect(gates.T2_BEHAVES_AS_DECLARED).toBe(false);
    expect(gates.eligibleToProposeLive).toBe(false);
  });
});
