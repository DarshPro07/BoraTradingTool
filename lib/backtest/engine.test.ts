import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import type { Candle } from "@/lib/providers/types";
import type { StrategyDsl } from "@/lib/strategy/dsl";
import { runGauntlet } from "@/lib/strategy/gauntlet";
import { placeInTestFamily, registerTestSnapshot } from "@/lib/strategy/identity-fixture";
import { runBacktest } from "./engine";

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-backtest-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "backtest.db");
  closeDbForTests();
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** Deterministic ramp: close rises by 1 each bar, open sits half a point below it. */
function ramp(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i;
    return { time: 1_700_000_000 + i * 86_400, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1_000 };
  });
}

function dsl(overrides: Partial<StrategyDsl> = {}): StrategyDsl {
  return {
    name: "ramp_follow",
    universe: { market: "NSE", maxPositions: 10 },
    entry: { feature: "close", op: "gt", value: 110 },
    exit: { afterDays: 3, stopLossPct: 3 },
    sizing: { maxPositionPct: 10 },
    costs: { commissionBps: 3, slippageBps: 7 },
    ...overrides,
  } as StrategyDsl;
}

describe("lookahead", () => {
  it("fills at the next open, never the close it decided on", () => {
    // Deciding and filling on the same close is the most common way a backtest invents edge.
    const bars = ramp(40);
    const result = runBacktest(dsl(), bars);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const first = result.trades[0];
    // close first exceeds 110 at index 11; the fill belongs to index 12's open.
    expect(first.entryIndex).toBe(12);
    expect(first.entryPrice).toBe(bars[12].open);
    expect(first.entryPrice).not.toBe(bars[11].close);
  });

  it("never opens a position on the final bar", () => {
    const result = runBacktest(dsl({ entry: { feature: "close", op: "gt", value: 0 } } as Partial<StrategyDsl>), ramp(40));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const trade of result.trades) expect(trade.entryIndex).toBeLessThan(39);
  });
});

describe("refusals", () => {
  it("refuses a feature it cannot derive rather than defaulting it to zero", () => {
    const result = runBacktest(
      dsl({ entry: { feature: "sector_relative_strength", op: "gt", value: 0 } } as Partial<StrategyDsl>),
      ramp(40),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(result.message).toMatch(/sector_relative_strength/);
  });

  it("refuses bars that are not strictly ordered instead of re-sorting them", () => {
    const bars = ramp(40);
    bars[20].time = bars[19].time; // duplicate timestamp
    const result = runBacktest(dsl(), bars);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNORDERED_BARS");
  });

  it("refuses a series too short to conclude anything from", () => {
    const result = runBacktest(dsl(), ramp(10));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INSUFFICIENT_BARS");
  });
});

describe("exits", () => {
  it("charges the modelled round trip against every trade", () => {
    const result = runBacktest(dsl(), ramp(40));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // commission 3bps + slippage 7bps, both sides = 20bps.
    for (const trade of result.trades) {
      expect(trade.grossReturn - trade.netReturn).toBeCloseTo(0.002, 10);
    }
  });

  it("assumes the stop is hit before the target when a bar spans both", () => {
    // The intrabar path is unknowable from OHLC. Assuming the favourable order would
    // flatter every strategy that defines both a stop and a target.
    const bars = ramp(40);
    const entry = 12;
    bars[entry + 1] = { ...bars[entry + 1], low: 1, high: 10_000 };

    const result = runBacktest(dsl({ exit: { afterDays: 10, stopLossPct: 3, takeProfitPct: 3 } } as Partial<StrategyDsl>), bars);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trades[0].exitReason).toBe("stop_loss");
  });

  it("closes an open position at the end of the series", () => {
    const result = runBacktest(dsl({ exit: { afterDays: 250, stopLossPct: 90 } } as Partial<StrategyDsl>), ramp(40));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trades.at(-1)?.exitReason).toBe("end_of_data");
  });
});

describe("evidence handed to the gauntlet", () => {
  it("aligns the no-trade benchmark one-for-one with out-of-sample trades", () => {
    const result = runBacktest(dsl(), ramp(200));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.noTradeReturns).toHaveLength(result.evidence.outOfSampleReturns.length);
  });

  it("splits trades into in-sample and out-of-sample without overlap", () => {
    const result = runBacktest(dsl(), ramp(200), { inSampleFraction: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { inSampleReturns, outOfSampleReturns } = result.evidence;
    expect(inSampleReturns.length + outOfSampleReturns.length).toBe(result.trades.length);
  });

  it("feeds the gauntlet directly — the circuit the validation stack was missing", () => {
    // Before this engine existed, runGauntlet was reachable only from tests supplying
    // hand-written arrays, so every statistic graded numbers nobody had derived.
    const result = runBacktest(dsl(), ramp(400));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const specId = recordStrategySpec({ name: "ramp_follow", version: 1, dsl: dsl(), createdBy: "test" });
    // A strategy must belong to a declared family before any statistical claim is made about it.
    // Without this `runGauntlet` throws `ResearchIdentityMissing`, because the deflated Sharpe
    // ratio would otherwise be corrected against a denominator of one.
    placeInTestFamily(specId, dsl());
    registerTestSnapshot();
    const report = runGauntlet(specId, dsl(), {
      ...result.evidence,
      datasetSnapshotId: "dss_test",
      datasetFingerprint: "fp_test",
    });

    expect(report.specId).toBe(specId);
    expect(report.stages.length).toBeGreaterThan(0);
    expect(report.trialsCounted).toBe(1);
  });
});
