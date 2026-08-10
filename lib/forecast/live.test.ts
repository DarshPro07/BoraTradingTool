import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it , vi } from "vitest";

// Multi-run accumulation tests do real repeated DB work; under full-suite load the 5s default
// read as a flake (7.3s observed). Same ceiling as the other schema-heavy suites.
vi.setConfig({ testTimeout: 30_000 });
import { FORECAST_GATES } from "./score";
import { archiveForecast, pendingForecasts, scoreDueForecasts } from "./live";

/**
 * Live validation of the forecaster — the only loop in this system that produces unbiased
 * evidence without risking capital or placing an order.
 *
 * The mechanic is what makes it honest: the prediction is written to disk, then time passes, then
 * it is graded against what actually happened. There is no path by which a bar can be scored
 * before it exists, so lookahead is structurally impossible rather than merely guarded against.
 *
 * `scoreForecast` has existed and been correct since it was written. Nothing ever called it.
 */

let root: string;
const roots: string[] = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-live-"));
  roots.push(root);
});

afterEach(() => {
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const DAY = 86_400;
const T0 = 1_780_000_000;

function forecast(overrides: Record<string, unknown> = {}) {
  return {
    instrumentId: "US:XNAS:AAPL",
    timeframe: "1d",
    checkpoint: "Kronos-base",
    generatedAt: new Date((T0 - DAY) * 1000).toISOString(),
    lookbackBars: 512,
    bars: [1, 2, 3, 4].map((step) => ({
      time: T0 + step * DAY,
      open: 100,
      high: 101,
      low: 99,
      close: 100 + step * 0.1,
      volume: 1_000,
    })),
    ...overrides,
  };
}

/** Realised bars covering the forecast window, plus the bar before it for the baseline. */
function actuals(count = 6, drift = 0.2) {
  return Array.from({ length: count }, (_unused, index) => ({
    time: T0 + index * DAY,
    close: 100 + index * drift,
  }));
}

describe("archiving a prediction before its outcome exists", () => {
  it("keeps a forecast that the next run would otherwise overwrite", () => {
    // The runner writes one file per instrument and overwrites it every pass. Without an archive
    // there is nothing left to grade — which is the mechanical reason nothing was ever scored.
    archiveForecast(forecast(), root);
    expect(pendingForecasts(root)).toHaveLength(1);
  });

  it("keeps two runs of the same instrument apart", () => {
    archiveForecast(forecast(), root);
    archiveForecast(forecast({ generatedAt: new Date(T0 * 1000).toISOString() }), root);
    expect(pendingForecasts(root)).toHaveLength(2);
  });

  it("does not archive the same run twice", () => {
    // The cycle runs every fifteen minutes and the forecast file changes far less often.
    const one = forecast();
    archiveForecast(one, root);
    archiveForecast(one, root);
    expect(pendingForecasts(root)).toHaveLength(1);
  });
});

describe("scoring only what has actually resolved", () => {
  it("leaves a forecast pending while its bars are still in the future", async () => {
    archiveForecast(forecast(), root);
    const report = await scoreDueForecasts(async () => actuals(1), root);

    expect(report.scored).toBe(0);
    expect(report.pending).toBe(1);
    expect(pendingForecasts(root)).toHaveLength(1);
  });

  it("does not re-score a forecast it has already graded", async () => {
    // Re-scoring is how a forward record gets laundered: the same prediction counted twice, and
    // the second count made when the answer is already known.
    for (let run = 0; run < 12; run += 1) {
      archiveForecast(forecast({ generatedAt: new Date((T0 - DAY * (run + 2)) * 1000).toISOString() }), root);
    }
    await scoreDueForecasts(async () => actuals(8), root);
    const second = await scoreDueForecasts(async () => actuals(8), root);

    expect(second.scored).toBe(0);
  });
});

describe("pooling, because one forecast is never enough", () => {
  it("refuses a verdict below the bar count the gate requires", async () => {
    // A single four-bar forecast cannot support a claim. `FORECAST_GATES.minScoredBars` is 30,
    // and reporting "beat persistence" off four bars would be exactly the headline number the
    // scorer was built to refuse.
    archiveForecast(forecast(), root);
    const report = await scoreDueForecasts(async () => actuals(8), root);

    expect(report.verdict).toBeNull();
    expect(report.reason).toMatch(new RegExp(String(FORECAST_GATES.minScoredBars)));
  });

  it("reaches a verdict once enough bars have accumulated across runs", async () => {
    for (let run = 0; run < 12; run += 1) {
      archiveForecast(
        forecast({ generatedAt: new Date((T0 - DAY * (run + 2)) * 1000).toISOString() }),
        root,
      );
    }
    const report = await scoreDueForecasts(async () => actuals(8), root);

    expect(report.scoredBars).toBeGreaterThanOrEqual(FORECAST_GATES.minScoredBars);
    expect(report.verdict).not.toBeNull();
  });
});

describe("the lookahead invariant", () => {
  it("drops a bar that is not after the run that predicted it", async () => {
    // Pooling across runs means the scorer sees one `generatedAt` for bars from many. Each bar is
    // therefore checked against *its own* forecast's timestamp here, before pooling — otherwise a
    // stale archive entry could contribute a bar that was already history when it was written.
    const bad = forecast({ generatedAt: new Date((T0 + 3 * DAY) * 1000).toISOString() });
    archiveForecast(bad, root);
    const report = await scoreDueForecasts(async () => actuals(8), root);

    expect(report.droppedAsLookahead).toBeGreaterThan(0);
  });
});

describe("when the data source is unavailable", () => {
  it("refuses rather than throwing, and scores nothing", async () => {
    archiveForecast(forecast(), root);
    const report = await scoreDueForecasts(async () => {
      throw new Error("provider unreachable");
    }, root);

    expect(report.scored).toBe(0);
    expect(report.reason).toMatch(/unreachable|could not/i);
    // The archive must survive a failed pass, or a provider outage would silently destroy
    // every pending prediction.
    expect(pendingForecasts(root)).toHaveLength(1);
  });
});
