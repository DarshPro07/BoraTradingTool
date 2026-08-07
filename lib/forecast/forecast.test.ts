import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FORECAST_FRESHNESS_MS, KRONOS_CHECKPOINTS, forecastPath, readKronosForecast } from "./kronos";
import { FORECAST_GATES, scoreForecast, type ScoredBar } from "./score";

const DAY = 86_400;
const T0 = 1_780_000_000; // Unix seconds, an arbitrary but fixed instant.
const GENERATED_AT = new Date(T0 * 1000).toISOString();

/**
 * One temp directory for the file, subdivided per case.
 *
 * `mkdtempSync` per test meant nine separate directory creations plus their nested writes. On
 * Windows, with a virus scanner watching the temp tree, each one is a synchronous round trip —
 * enough to push these tests past a five-second timeout when the machine is otherwise busy. One
 * root and a counter gives the same isolation for a fraction of the I/O.
 */
const SUITE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "kronos-test-"));
let caseCounter = 0;

function tempRoot(): string {
  const root = path.join(SUITE_ROOT, `case-${(caseCounter += 1)}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function writeForecast(root: string, body: unknown, instrumentId = "US:AAPL", timeframe = "1d"): void {
  const file = forecastPath(instrumentId, timeframe, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body), "utf8");
}

function validFile(overrides: Record<string, unknown> = {}) {
  return {
    instrumentId: "US:AAPL",
    timeframe: "1d",
    checkpoint: "Kronos-small",
    generatedAt: GENERATED_AT,
    lookbackBars: 256,
    bars: [{ time: T0 + DAY, open: 100, high: 101, low: 99, close: 100.5, volume: 1_000 }],
    ...overrides,
  };
}

describe("absence is reported, never defaulted", () => {
  it("refuses with RESOURCE_NOT_PROVIDED when no forecast exists", () => {
    const result = readKronosForecast("US:AAPL", "1d", tempRoot());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESOURCE_NOT_PROVIDED");
    // The message must explain *why* none exists, not just that none does.
    expect(result.message).toMatch(/Python quant core/);
  });

  it("refuses malformed JSON rather than reading past it", () => {
    const root = tempRoot();
    const file = forecastPath("US:AAPL", "1d", root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json", "utf8");
    const result = readKronosForecast("US:AAPL", "1d", root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RESOURCE_MALFORMED");
  });

  it("refuses a file that is for a different instrument", () => {
    const root = tempRoot();
    writeForecast(root, validFile({ instrumentId: "US:MSFT" }));
    const result = readKronosForecast("US:AAPL", "1d", root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/US:MSFT/);
  });

  it("refuses an unpublished checkpoint rather than guessing its context window", () => {
    const root = tempRoot();
    writeForecast(root, validFile({ checkpoint: "Kronos-enormous" }));
    const result = readKronosForecast("US:AAPL", "1d", root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNKNOWN_CHECKPOINT");
  });

  it("refuses a forecast with no bars", () => {
    const root = tempRoot();
    writeForecast(root, validFile({ bars: [] }));
    expect(readKronosForecast("US:AAPL", "1d", root).ok).toBe(false);
  });
});

describe("epistemic standing is stamped here, not supplied by the file", () => {
  it("marks a valid forecast not_forward_validated", () => {
    const root = tempRoot();
    writeForecast(root, validFile());
    const result = readKronosForecast("US:AAPL", "1d", root, T0 * 1000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.epistemicStatus).toBe("not_forward_validated");
  });

  it("ignores a file that tries to promote itself", () => {
    const root = tempRoot();
    writeForecast(root, validFile({ epistemicStatus: "known" }));
    const result = readKronosForecast("US:AAPL", "1d", root, T0 * 1000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.epistemicStatus).toBe("not_forward_validated");
  });

  it("flags a lookback longer than the checkpoint's context window", () => {
    const root = tempRoot();
    writeForecast(root, validFile({ lookbackBars: KRONOS_CHECKPOINTS["Kronos-small"].contextLength + 1 }));
    const result = readKronosForecast("US:AAPL", "1d", root, T0 * 1000);
    expect(result.ok && result.data.contextOverrun).toBe(true);
  });

  it("goes stale once it is describing bars that have already happened", () => {
    const root = tempRoot();
    writeForecast(root, validFile());
    const fresh = readKronosForecast("US:AAPL", "1d", root, T0 * 1000 + 1_000);
    const old = readKronosForecast("US:AAPL", "1d", root, T0 * 1000 + FORECAST_FRESHNESS_MS + 1_000);
    expect(fresh.ok && fresh.stale).toBe(false);
    expect(old.ok && old.stale).toBe(true);
  });
});

// ── scoring ─────────────────────────────────────────────────────────────────────────────

/** A random-walk-ish series, deterministic so the test cannot flake. */
function walk(count: number, start = 100): ScoredBar[] {
  const bars: ScoredBar[] = [];
  let close = start;
  for (let index = 0; index < count; index += 1) {
    close += Math.sin(index * 1.7) * 0.8 + Math.cos(index * 0.3) * 0.4;
    bars.push({ time: T0 + index * DAY, close });
  }
  return bars;
}

describe("a forecast must beat doing nothing", () => {
  const actual = walk(80);

  it("refuses to score fewer bars than the gate requires", () => {
    const result = scoreForecast({ generatedAt: GENERATED_AT, bars: actual.slice(1, 5) }, actual);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(new RegExp(`${FORECAST_GATES.minScoredBars}`));
  });

  it("calls a perfect forecast better than persistence", () => {
    // Predicting the realised close exactly: zero error against persistence's real error.
    const result = scoreForecast({ generatedAt: GENERATED_AT, bars: actual.slice(1) }, actual);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict).toBe("better_than_persistence");
    expect(result.mae).toBeCloseTo(0, 10);
    expect(result.maeImprovement).toBeGreaterThan(0);
    expect(result.directionalAccuracy).toBe(1);
  });

  it("refuses to credit a forecast that merely repeats the last close", () => {
    // The persistence baseline dressed up as a model. Its error is identical by construction,
    // so no amount of low MAE should let it through.
    const bars = actual.slice(1).map((bar, index) => ({ time: bar.time, close: actual[index].close }));
    const result = scoreForecast({ generatedAt: GENERATED_AT, bars }, actual);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict).toBe("no_better_than_persistence");
    expect(result.maeImprovement).toBeCloseTo(0, 10);
  });

  it("reports a low absolute error that is still worse than persistence", () => {
    // A quiet series where the model is off by a small constant every bar. MAE looks fine in
    // isolation; against persistence it is strictly worse, and that is the trap.
    const quiet: ScoredBar[] = Array.from({ length: 60 }, (_, index) => ({
      time: T0 + index * DAY,
      close: 100 + index * 0.001,
    }));
    const bars = quiet.slice(1).map((bar) => ({ time: bar.time, close: bar.close + 0.05 }));
    const result = scoreForecast({ generatedAt: GENERATED_AT, bars }, quiet);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mae).toBeLessThan(0.1); // an impressive-looking number in isolation
    expect(result.verdict).toBe("no_better_than_persistence");
    expect(result.reason).toMatch(/assume no change/);
  });

  it("drops predicted bars at or before the forecast's own generation time", () => {
    // Every "prediction" is of the past. Scoring these would make any model look prophetic.
    const past = actual.slice(0, 40).map((bar) => ({ time: bar.time - 40 * DAY, close: bar.close }));
    const result = scoreForecast({ generatedAt: GENERATED_AT, bars: past }, actual);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/generation time/);
  });

  it("refuses an unparseable generation time instead of scoring everything", () => {
    const result = scoreForecast({ generatedAt: "whenever", bars: actual.slice(1) }, actual);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/parseable/);
  });

  it("ignores predicted bars with no realised counterpart", () => {
    const bars = [
      ...actual.slice(1),
      { time: T0 + 900 * DAY, close: 999 }, // never realised
    ];
    const result = scoreForecast({ generatedAt: GENERATED_AT, bars }, actual);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scoredBars).toBe(actual.length - 1);
  });

  it("is deterministic, so the same forecast cannot be re-rolled into significance", () => {
    const once = scoreForecast({ generatedAt: GENERATED_AT, bars: actual.slice(1) }, actual);
    const twice = scoreForecast({ generatedAt: GENERATED_AT, bars: actual.slice(1) }, actual);
    expect(once).toEqual(twice);
  });
});
