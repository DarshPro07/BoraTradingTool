import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { setLearningMode } from "@/lib/governance/runtime";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import type { Candle } from "@/lib/providers/types";
import { StrategyDslSchema, type StrategyDsl } from "@/lib/strategy/dsl";
import { persistCandles } from "@/lib/market/candle-store";
import { markAccumulated } from "@/lib/market/intraday-accumulator";
import { runLearningCycle, type MarketEvidence } from "./cycle";
import type { CandleLoader } from "./dataset";

/**
 * The cycle must not serve daily bars to an intraday strategy.
 *
 * This defect has now appeared twice, in two layers, for the same reason: something knew the
 * strategy's *market* and assumed that settled which bars to hand it.
 *
 *   1. `marketCandleLoader` read `dsl.universe.market` and took the resolution from its own
 *      closure, which the cycle set to "D".
 *   2. The cycle then began reusing `evidence.dataset` — daily bars fetched for the quant-core
 *      pass — for any strategy whose market matched, which re-created the same bug above the
 *      fixed loader and would have silently undone it.
 *
 * It is undetectable downstream. The market is right, the bars are real, and only the timeframe is
 * wrong, so a 5-minute strategy is rehearsed on daily candles and reports a plausible verdict.
 * Pinned here at the cycle boundary, which is the layer that keeps getting it wrong.
 */

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;
let previousQuantRoot: string | undefined;

let previousTestMode: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  previousQuantRoot = process.env.QUANT_CORE_ROOT;
  previousTestMode = process.env.MARKETPULSE_TEST_MODE;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-cycle-res-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "cycle.db");
  process.env.QUANT_CORE_ROOT = path.join(directory, "empty-core");
  process.env.QUANT_CORE_URL = "off";
  // Empty provider, or the cycle's accumulator leg fetches REAL bars into the store mid-test —
  // which is how this suite once saw a 5m snapshot appear out of nowhere and judged the wrong
  // branch. The store's contents must be exactly what the test seeded.
  process.env.MARKETPULSE_TEST_MODE = "1";
  closeDbForTests();
});

afterEach(() => {
  closeDbForTests();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  if (previousQuantRoot === undefined) delete process.env.QUANT_CORE_ROOT;
  else process.env.QUANT_CORE_ROOT = previousQuantRoot;
  if (previousTestMode === undefined) delete process.env.MARKETPULSE_TEST_MODE;
  else process.env.MARKETPULSE_TEST_MODE = previousTestMode;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

vi.setConfig({ testTimeout: 30_000 });

function bars(count: number, step: number): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    time: Date.UTC(2026, 7, 3, 3, 45, 0) / 1000 + index * step,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000,
  }));
}

/** Daily IN bars, exactly what `marketEvidence` puts in `evidence.dataset`. */
const dailyEvidence = async (): Promise<MarketEvidence> => {
  const dataset = { "IN:XNSE:RELIANCE": bars(120, 86_400) };
  return { dataset, reference: [], references: { IN: dataset["IN:XNSE:RELIANCE"] } };
};

const noIntake = async () => ({
  failed: false,
  reason: "intake disabled in test",
  enqueued: 0,
  deduped: 0,
  rejected: 0,
});

function spec(name: string, resolution: "D" | "5m"): StrategyDsl {
  return StrategyDslSchema.parse({
    name,
    universe: { market: "NSE", maxPositions: 4, resolution },
    entry: { feature: "close", op: "gt", value: 0 },
    exit: resolution === "D" ? { afterDays: 5, stopLossPct: 2 } : { stopLossPct: 0.5 },
    sizing: { maxPositionPct: 25 },
    costs:
      resolution === "D"
        ? { commissionBps: 5, slippageBps: 7 }
        : { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
  });
}

describe("the rehearsal reads recorded snapshots at the declared resolution (13b)", () => {
  it("refuses an intraday strategy when the store holds only daily bars — never the daily cache, never a provider", async () => {
    // The old defect in both its forms: the cycle's cached daily sample, and the provider window.
    // Neither is reachable now — rehearsal takes snapshots from the canonical store, and a store
    // with no 5m bars is a stated ingestion gap, not a silently substituted timeframe.
    setLearningMode("learning", "owner");
    const intraday = spec("orb_probe", "5m");
    recordStrategySpec({ name: intraday.name, dsl: intraday, createdBy: "test" });
    // Ingestion IS allowed to use the provider — that is the contract. To test the refusal path
    // the store must stay exactly as seeded, so the session's accumulation is marked done.
    markAccumulated({ ran: true, inserted: 0, considered: 0, summary: "test: accumulation pinned" } as never, "test");
    persistCandles(
      Array.from({ length: 120 }, (_, index) => ({
        ticker: "IN:XNSE:RELIANCE",
        resolution: "D",
        time: Date.UTC(2026, 0, 5, 10, 0, 0) / 1000 + index * 86_400,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1_000,
      })),
    );

    const report = await runLearningCycle(
      "test-worker",
      async () => ({}) as Record<string, readonly Candle[]>,
      dailyEvidence,
      noIntake,
    );

    const outcome = report.rehearsal?.outcomes.find((entry) => entry.name === "orb_probe");
    expect(outcome).toBeDefined();
    expect(outcome!.verdict).toBe("not_evaluable");
    expect(outcome!.dataMissing).toBe(true);
    expect(outcome!.reason).toMatch(/5m/);
    expect(outcome!.reason).toMatch(/ingestion/i);
    expect(outcome!.datasetSnapshotId).toBeNull();
  });

  it("judges an intraday strategy on stored 5m bars, pinned to a recorded snapshot", async () => {
    setLearningMode("learning", "owner");
    const intraday = spec("orb_probe_data", "5m");
    recordStrategySpec({ name: intraday.name, dsl: intraday, createdBy: "test" });
    markAccumulated({ ran: true, inserted: 0, considered: 0, summary: "test: accumulation pinned" } as never, "test");
    const open = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;
    persistCandles(
      Array.from({ length: 150 }, (_, index) => ({
        ticker: "IN:XNSE:RELIANCE",
        resolution: "5",
        time: open + Math.floor(index / 75) * 86_400 + (index % 75) * 300,
        open: 100 + index * 0.1,
        high: 101 + index * 0.1,
        low: 99 + index * 0.1,
        close: 100 + index * 0.1,
        volume: 1_000,
      })),
    );

    const report = await runLearningCycle(
      "test-worker",
      async () => ({}) as Record<string, readonly Candle[]>,
      dailyEvidence,
      noIntake,
    );

    const outcome = report.rehearsal?.outcomes.find((entry) => entry.name === "orb_probe_data");
    expect(outcome).toBeDefined();
    // Whatever the verdict, it was reached on identified data: the snapshot id is recorded and
    // the daily cache never leaked in (a daily snapshot would carry different bar arithmetic).
    expect(outcome!.dataMissing).not.toBe(true);
    expect(outcome!.datasetSnapshotId).toMatch(/^dss_/);
    expect(outcome!.datasetFingerprint).toBeTruthy();
  });
});

describe("the guarded gauntlet reaches the cycle report", () => {
  it("the Trial Budget Governor lane is off by default, so the guarded gauntlet spends nothing", async () => {
    // The autonomous trial lane (MARKETPULSE_AUTONOMOUS_TRIALS) is off unless the owner sets it,
    // so the deterministic governor does not authorize a spend and the cycle reports a
    // recommendation, not a trial. This is the safe default posture.
    const intraday = spec("orb_probe", "5m");
    recordStrategySpec({ name: intraday.name, dsl: intraday, createdBy: "test" });

    const report = await runLearningCycle(
      "test-worker",
      async () => ({}) as Record<string, readonly Candle[]>,
      dailyEvidence,
      noIntake,
    );

    expect(report.autoGauntlet).not.toBeNull();
    // Lane off ⇒ the governor did not authorize ⇒ nothing spent.
    expect(report.autoGauntlet?.policyAllowed).toBe(false);
    expect(report.autoGauntlet?.spent).toBe(false);
    // The refusal is reported as a skip.
    expect(report.skipped.join(" ")).toMatch(/Guarded gauntlet/);
  });
});
