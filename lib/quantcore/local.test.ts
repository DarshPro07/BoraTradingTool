import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import type { Candle } from "@/lib/providers/types";
import { fetchQuantResource, quantCoreStatus } from "./client";
import { generateQuantCoreArtifacts } from "./generate";
import { MEASUREMENT_BARS, classifyRegime } from "./regime";

/**
 * The quant core is now supplied by this repository rather than by the Python service at
 * `E:\Trading_BOT`, which is not installed on this machine. These tests pin the two properties
 * that make that acceptable: nothing is fabricated when the evidence is absent, and the artifacts
 * are read back through the unmodified contract reader rather than a special path.
 */

useTemporaryDatabase();

/**
 * Every test here opens a fresh SQLite file, runs the migrations, and writes five artifacts to
 * disk. Under the full suite's parallelism that has exceeded vitest's 5s default — and a timeout
 * is not an assertion failure: it claims the machine was slow, not that the code is wrong.
 * `vitest.config.ts` is owner-reviewed, so the allowance is stated per file instead.
 */
vi.setConfig({ testTimeout: 30_000 });

const roots: string[] = [];
function makeRoot(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-localcore-"));
  roots.push(directory);
  return directory;
}

function bars(count: number, volatility: number, seed = 1): Candle[] {
  // Deterministic pseudo-random walk. `Math.random` would make a failure unreproducible, and a
  // volatility test that cannot be re-run is not evidence of anything.
  let state = seed;
  let price = 100;
  return Array.from({ length: count }, (_, index) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const shock = (state / 2_147_483_648 - 0.5) * volatility;
    price = Math.max(1, price * (1 + shock));
    return {
      time: 1_700_000_000 + index * 86_400,
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 1_000_000,
    };
  });
}

describe("regime classification", () => {
  it("refuses to classify a series too short to rank", () => {
    // `NORMAL` is the tempting default and the dangerous one: a real label a caller will act on,
    // produced by a measurement that never happened.
    expect(classifyRegime(bars(MEASUREMENT_BARS + 5, 0.01))).toBeNull();
    expect(classifyRegime([])).toBeNull();
  });

  it("ranks a window against its own history rather than an absolute threshold", () => {
    const reading = classifyRegime(bars(400, 0.02));
    expect(reading).not.toBeNull();
    expect(reading!.percentile).toBeGreaterThanOrEqual(0);
    expect(reading!.percentile).toBeLessThanOrEqual(1);
    expect(["LOW_VOL", "NORMAL", "HIGH_VOL"]).toContain(reading!.state);
  });

  it("calls a reading near a boundary unconfident", () => {
    // Confidence is distance from the nearest label boundary, not a probability the regime is
    // right. A reading sitting on the line is a coin toss and must not report as certain.
    const reading = classifyRegime(bars(400, 0.02));
    expect(reading!.confidence).toBeGreaterThanOrEqual(0);
    expect(reading!.confidence).toBeLessThanOrEqual(1);
  });

  it("dates the reading from the last bar, not from the clock", () => {
    // Otherwise data that stopped on Friday looks fresh forever and the freshness budget, which
    // is the only thing standing between stale data and a decision, never fires.
    const series = bars(400, 0.02);
    const reading = classifyRegime(series);
    const lastBarDate = new Date(series[series.length - 1].time * 1_000).toISOString().slice(0, 10);
    expect(reading!.asOf).toBe(lastBarDate);
  });

  it("never claims walk-forward calibration it has not earned", () => {
    const root = makeRoot();
    generateQuantCoreArtifacts({ root, referenceCandles: bars(400, 0.02) });
    const written = JSON.parse(fs.readFileSync(path.join(root, "data/regime_state.json"), "utf8"));
    expect(written.calibration).not.toMatch(/walk_forward/);
    expect(written.calibration).toMatch(/realised_vol_percentile/);
  });
});

describe("generated artifacts read back through the contract", () => {
  it("writes a universe the unmodified reader accepts", async () => {
    const root = makeRoot();
    const report = generateQuantCoreArtifacts({ root });
    expect(report.written).toContain("data/universe.json");

    const result = await fetchQuantResource("universe", { root, baseUrl: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transport).toBe("filesystem");
    expect(result.data.count).toBe(result.data.instruments.length);
    expect(result.data.count).toBeGreaterThan(0);
  });

  it("reports a healthy core once a packet exists, and never claims live execution", async () => {
    const root = makeRoot();
    generateQuantCoreArtifacts({ root });

    const status = await quantCoreStatus({ root, baseUrl: null });
    expect(status.reachable).toBe(true);
    expect(status.transport).toBe("filesystem");
    // Structural: there is no broker adapter in this repository at all. The control plane treats
    // a `true` here as a hard fault, so a generator that emitted one would trip its own alarm.
    expect(status.liveExecution).toBe(false);
    expect(status.mode).toBe("PAPER_ONLY");
  });

  it("labels its own numbers as self-generated so they cannot pass as corroboration", async () => {
    // The board packet this replaces reported 4,917 observations from an independently written
    // Python implementation. These counts are a different population from a different engine, and
    // reading agreement between them and local backtests as confirmation would be circular.
    const root = makeRoot();
    generateQuantCoreArtifacts({ root });
    const health = await fetchQuantResource("health", { root, baseUrl: null });
    expect(health.ok).toBe(true);
    if (!health.ok) return;
    expect(health.data.dataStatus.primaryLimit).toMatch(/SELF_GENERATED/);
    expect(health.data.dataStatus.primaryLimit).toMatch(/circular/i);
  });

  it("counts trials by verdict without inventing any", async () => {
    const root = makeRoot();
    // `trials.strategy_spec_id` is a real foreign key — a trial cannot exist without the strategy
    // it was spent on, which is exactly the constraint that makes the ledger auditable.
    getDb()
      .insert(schema.strategySpecs)
      .values({
        id: "s1",
        hypothesisId: null,
        parentId: null,
        name: "counted_fixture",
        version: 1,
        dsl: "{}",
        dslHash: "0".repeat(32),
        status: "draft",
        createdBy: "local-core-test",
        createdAt: new Date(),
      })
      .run();

    getDb()
      .insert(schema.trials)
      .values([
        { strategySpecId: "s1", kind: "gauntlet", verdict: "PASS", reason: null, actor: "t", startedAt: new Date(), completedAt: new Date() },
        { strategySpecId: "s1", kind: "gauntlet", verdict: "FAIL", reason: "cost_failure", actor: "t", startedAt: new Date(), completedAt: new Date() },
        { strategySpecId: "s1", kind: "gauntlet", verdict: "INCONCLUSIVE", reason: null, actor: "t", startedAt: new Date(), completedAt: null },
      ])
      .run();

    generateQuantCoreArtifacts({ root });

    const trials = await fetchQuantResource("trials", { root, baseUrl: null });
    expect(trials.ok && trials.data.total).toBe(3);

    const board = await fetchQuantResource("board", { root, baseUrl: null });
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    expect(board.data.outcomeAudit.historicalWins).toBe(1);
    expect(board.data.outcomeAudit.historicalLosses).toBe(1);
    expect(board.data.outcomeAudit.historicalExpired).toBe(1);
    expect(board.data.outcomeAudit.mlGate).toBe("NOT_APPLICABLE");
  });

  it("writes no regime file when volatility was never measured", async () => {
    const root = makeRoot();
    const report = generateQuantCoreArtifacts({ root });
    expect(report.skipped.map((entry) => entry.resource)).toContain("regime");

    // The absent file is the point: the contract reads it as RESOURCE_NOT_PROVIDED, which is true.
    const result = await fetchQuantResource("regime", { root, baseUrl: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("RESOURCE_NOT_PROVIDED");
  });

  it("emits an empty candidate list rather than inventing candidates offline", async () => {
    // A pass with no bars scanned nothing. The honest board is empty — not a plausible-looking
    // list assembled from nothing — and the omission is recorded rather than left to inference.
    const root = makeRoot();
    const report = generateQuantCoreArtifacts({ root });
    const board = await fetchQuantResource("board", { root, baseUrl: null });
    expect(board.ok && board.data.candidates).toEqual([]);
    expect(report.skipped.map((entry) => entry.resource)).toContain("board.candidates");
  });

  it("carries real candidates once bars are supplied, through the unmodified reader", async () => {
    const root = makeRoot();
    getDb()
      .insert(schema.strategySpecs)
      .values({
        id: "spec_live",
        hypothesisId: null,
        parentId: null,
        name: "live_fixture",
        version: 1,
        dsl: JSON.stringify({
          name: "live_fixture",
          universe: { market: "US", maxPositions: 10 },
          entry: { feature: "close", op: "gt", value: 0 },
          exit: { afterDays: 5, stopLossPct: 3 },
          sizing: { maxPositionPct: 10 },
          costs: { commissionBps: 3, slippageBps: 7 },
        }),
        dslHash: "1".repeat(32),
        status: "paper_challenger",
        createdBy: "local-core-test",
        createdAt: new Date(),
      })
      .run();

    generateQuantCoreArtifacts({ root, dataset: { "US:XNAS:AAPL": bars(300, 0.01) } });

    const board = await fetchQuantResource("board", { root, baseUrl: null });
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    expect(board.data.candidates).toHaveLength(1);
    expect(board.data.candidates[0].verdict).toBe("PAPER_CANDIDATE");
    expect(board.data.candidates[0].setup).toBe("live_fixture");
    // Provider symbol, not the internal id — the board is read by people, and by a Python service
    // that never knew this system's instrument keys.
    expect(board.data.candidates[0].symbol).toBe("AAPL");
    expect(board.data.candidates[0].score).toBeNull();
  });

  it("is overridden by a hand-supplied file at the same path", async () => {
    // Generation is a default, not a monopoly: drop a real packet in and it is read identically,
    // because the reader cannot tell the difference and should not need to.
    const root = makeRoot();
    generateQuantCoreArtifacts({ root });
    fs.writeFileSync(
      path.join(root, "data/universe.json"),
      JSON.stringify({ market: "NSE", count: 1, instruments: [{ symbol: "RELIANCE.NS", sector: "Energy", liquid: true }] }),
      "utf8",
    );

    const result = await fetchQuantResource("universe", { root, baseUrl: null });
    expect(result.ok && result.data.market).toBe("NSE");
    expect(result.ok && result.data.instruments[0].sector).toBe("Energy");
  });
});
