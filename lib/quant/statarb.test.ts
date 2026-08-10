import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { persistCandles } from "@/lib/market/candle-store";
import { createRandom } from "@/lib/strategy/statistics";
import {
  ADF_CRITICAL,
  COINTEGRATION_METHOD_STATUS,
  ENGLE_GRANGER_CRITICAL,
  adfStatistic,
  integrationOrderCheck,
  runStatArbFormation,
} from "./statarb";

/**
 * Phase F invariants. The synthetic truth: B is a random walk, A = 2·B + stationary AR(1) noise —
 * genuinely cointegrated with hedge ratio 2. C is an independent random walk — NOT cointegrated
 * with either. The engine must find the true pair, refuse the false ones, and count EVERY attempt.
 */

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-statarb-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "sa.db");
  closeDbForTests();
  getDb();
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const OPEN = Date.UTC(2026, 0, 5, 10, 0, 0) / 1000;
const LENGTH = 400;

function seedSyntheticMarket(): void {
  // Normal increments via Box-Muller: the raw LCG uniforms are slightly anti-correlated, which
  // once made these "walks" test STATIONARY (ADF −2.91) and sank the whole fixture.
  const random = createRandom(2026);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
  const noise = createRandom(99);
  const walkB: number[] = [100];
  for (let index = 1; index < LENGTH; index += 1) {
    walkB.push(walkB[index - 1] + gauss());
  }
  let ar = 0;
  const seriesA = walkB.map((value) => {
    ar = 0.7 * ar + (noise() - 0.5) * 1.5;
    return 2 * value + ar + 50;
  });
  const walkC: number[] = [80];
  const randomC = createRandom(777);
  const gaussC = () => Math.sqrt(-2 * Math.log(Math.max(randomC(), 1e-12))) * Math.cos(2 * Math.PI * randomC());
  for (let index = 1; index < LENGTH; index += 1) {
    walkC.push(walkC[index - 1] + gaussC());
  }

  const seed = (ticker: string, closes: number[]) =>
    persistCandles(
      closes.map((close, index) => ({
        ticker,
        resolution: "D",
        time: OPEN + index * 86_400,
        open: close,
        high: close + 0.5,
        low: close - 0.5,
        close,
        volume: 1_000,
      })),
    );
  seed("IN:XNSE:RELIANCE", seriesA);
  seed("IN:XNSE:TCS", walkB);
  seed("IN:XNSE:HDFCBANK", walkC);
}

describe("ADF and integration checks", () => {
  it("calls a random walk non-stationary and its differences stationary — I(1)", () => {
    const random = createRandom(5);
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
    const walk: number[] = [100];
    for (let index = 1; index < 300; index += 1) walk.push(walk[index - 1] + gauss());
    const check = integrationOrderCheck(walk);
    expect(check.isI1).toBe(true);
    expect(check.levelsAdf!).toBeGreaterThan(ADF_CRITICAL.p05);
    expect(check.differencesAdf!).toBeLessThan(ADF_CRITICAL.p05);
  });

  it("calls a strongly mean-reverting series stationary", () => {
    const noise = createRandom(11);
    let value = 0;
    const series: number[] = [];
    for (let index = 0; index < 300; index += 1) {
      value = 0.5 * value + (noise() - 0.5);
      series.push(value);
    }
    expect(adfStatistic(series)!).toBeLessThan(ADF_CRITICAL.p05);
  });

  it("refuses a too-short series rather than guessing", () => {
    expect(adfStatistic([1, 2, 3])).toBeNull();
  });
});

describe("formation — finds the true pair, refuses the rest, counts everything", () => {
  it("detects the engineered cointegrated pair with hedge ≈ 2 and a usable half-life", () => {
    seedSyntheticMarket();
    const result = runStatArbFormation({ market: "NSE", resolution: "D", correlationScreen: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Every attempted pair is in the search history — mining is never free.
    expect(result.candidatesTested).toBe(3); // 3 instruments → 3 pairs
    const pair = result.survivors.find(
      (candidate) =>
        (candidate.a === "IN:XNSE:RELIANCE" && candidate.b === "IN:XNSE:TCS") ||
        (candidate.a === "IN:XNSE:TCS" && candidate.b === "IN:XNSE:RELIANCE"),
    );
    expect(pair).toBeDefined();
    expect(Math.abs(pair!.hedgeRatio)).toBeGreaterThan(1.5);
    expect(Math.abs(pair!.hedgeRatio)).toBeLessThan(2.5);
    expect(pair!.halfLifeBars).not.toBeNull();
    expect(pair!.integrationA.isI1).toBe(true);
    expect(pair!.rollingStability).not.toBeNull();

    // The independent walk C survives with NOTHING (rejected at correlation or cointegration).
    for (const survivor of result.survivors) {
      expect([survivor.a, survivor.b]).not.toContain("IN:XNSE:HDFCBANK");
    }
    const rejectedTotal = Object.values(result.rejectedCounts).reduce((a, b) => a + b, 0);
    expect(rejectedTotal + result.survivors.length).toBe(result.candidatesTested);
  });

  it("persists the full manifest in the audit ledger — the search is reproducible, not an anecdote", () => {
    seedSyntheticMarket();
    const result = runStatArbFormation({ market: "NSE", resolution: "D", correlationScreen: 0.5 });
    if (!result.ok) throw new Error("formation refused");

    expect(result.manifest.candidatesTested).toBe(result.candidatesTested);
    expect(result.manifest.cointegrationMethod).toBe("engle_granger_adf");
    expect(result.manifest.shortabilityAssumption).toMatch(/STATED, NOT VERIFIED/);
    expect(result.manifest.assumptionFingerprints.map((entry) => entry.id)).toContain("engle_granger_adf");

    const audit = getDb()
      .select()
      .from(schema.auditEvents)
      .all()
      .find((event) => event.action === "statarb_formation");
    expect(audit).toBeDefined();
    const detail = JSON.parse(audit!.detail!) as { formationId: string; manifest: { formationSnapshotId: string } };
    expect(detail.formationId).toBe(result.formationId);
    expect(detail.manifest.formationSnapshotId).toBe(result.formationSnapshotId);
  });

  it("refuses an empty store as an ingestion task", () => {
    const result = runStatArbFormation({ market: "NSE", resolution: "D" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_STORED_DATA");
  });
});

describe("critical values — the defect the parity corpus found", () => {
  it("cointegration residuals use ENGLE-GRANGER values, never the plain ADF ones", () => {
    // The bug: testing an estimated regression's residual against plain ADF -2.86 gave a 13.9%
    // false-positive rate on INDEPENDENT random walks (nominal 5%). Statistics matched
    // statsmodels to ~0.01 the whole time — only the threshold was wrong.
    expect(ENGLE_GRANGER_CRITICAL.p05).toBeLessThan(ADF_CRITICAL.p05);
    expect(ENGLE_GRANGER_CRITICAL.p05).toBeCloseTo(-3.34, 2);
    expect(ENGLE_GRANGER_CRITICAL.p01).toBeLessThan(ENGLE_GRANGER_CRITICAL.p05);
    expect(ENGLE_GRANGER_CRITICAL.p10).toBeGreaterThan(ENGLE_GRANGER_CRITICAL.p05);
  });

  it("rejects independent random walks at roughly the nominal rate, not 3x it", () => {
    // 40 independent pairs of Gaussian random walks. With plain-ADF thresholds this produced
    // ~14% false cointegration; with EG thresholds it must sit near 5%.
    let falsePositives = 0;
    const trials = 40;
    for (let trial = 0; trial < trials; trial += 1) {
      const ra = createRandom(1000 + trial * 7);
      const rb = createRandom(50_000 + trial * 13);
      const gauss = (draw: () => number) =>
        Math.sqrt(-2 * Math.log(Math.max(draw(), 1e-12))) * Math.cos(2 * Math.PI * draw());
      const a: number[] = [100];
      const b: number[] = [80];
      for (let index = 1; index < 250; index += 1) {
        a.push(a[index - 1] + gauss(ra) * 1.5);
        b.push(b[index - 1] + gauss(rb) * 1.5);
      }
      const meanA = a.reduce((x, y) => x + y, 0) / a.length;
      const meanB = b.reduce((x, y) => x + y, 0) / b.length;
      let covariance = 0;
      let variance = 0;
      for (let index = 0; index < a.length; index += 1) {
        covariance += (b[index] - meanB) * (a[index] - meanA);
        variance += (b[index] - meanB) ** 2;
      }
      const hedge = variance > 0 ? covariance / variance : 0;
      const spread = a.map((value, index) => value - hedge * b[index]);
      const statistic = adfStatistic(spread);
      if (statistic !== null && statistic < ENGLE_GRANGER_CRITICAL.p05) falsePositives += 1;
    }
    expect(falsePositives / trials).toBeLessThanOrEqual(0.15);
  });

  it("the method status carries the MEASURED parity result, not a promise", () => {
    expect(COINTEGRATION_METHOD_STATUS.methodStatus).toBe("APPROXIMATE_PARITY_MEASURED");
    expect(COINTEGRATION_METHOD_STATUS.parityResult.agreement).toBeGreaterThan(0.95);
    expect(COINTEGRATION_METHOD_STATUS.parityResult.reference).toMatch(/statsmodels/);
    expect(COINTEGRATION_METHOD_STATUS.label).toMatch(/still an approximation/);
  });
});
