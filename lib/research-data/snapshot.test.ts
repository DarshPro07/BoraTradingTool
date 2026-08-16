import fs from "node:fs";
import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { persistCandles } from "@/lib/market/candle-store";
import { latestExperiment, recordExperiment, snapshotFromStore } from "./snapshot";

/**
 * The historical-research data contract, adversarially.
 *
 * The invariant: same strategy + same dataset snapshot + same engine = same result, forever —
 * and no provider window, store repair or later code path may silently change what a completed
 * experiment said.
 */

const temporaryDirectories: string[] = [];
let previousPath: string | undefined;

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-snapshot-"));
  temporaryDirectories.push(directory);
  process.env.MARKETPULSE_DB_PATH = path.join(directory, "snap.db");
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

const OPEN = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;

function seedBars(ticker = "IN:XNSE:RELIANCE", count = 80, start = 100): void {
  persistCandles(
    Array.from({ length: count }, (_, index) => ({
      ticker,
      resolution: "5",
      time: OPEN + index * 300,
      open: start + index,
      high: start + index + 1,
      low: start + index - 1,
      close: start + index,
      volume: 1_000,
    })),
  );
}

describe("T1 — the store is the only source; the provider does not exist here", () => {
  it("builds a snapshot from stored bars with no provider anywhere in the module", () => {
    // Structural proof: this suite runs with no network and no provider mock, and the module
    // imports only the candle store. If a provider call ever crept in, this test environment
    // would have nothing to answer it.
    seedBars();
    const snapshot = snapshotFromStore("NSE", "5m", "test");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    // 75, not the 80 seeded. `seedBars` lays 80 consecutive 5-minute bars from 09:15 IST, which
    // runs to 15:55 — past the 15:30 close. The snapshot withholds the five that fall at or beyond
    // the session boundary, which is the point: a bar stamped outside the continuous session is
    // not a tradeable observation, and the production store held exactly such artifacts (three
    // instruments, one zero-volume bar each at 15:30 on 2026-08-14).
    expect(snapshot.barCount).toBe(75);
    expect(snapshot.outOfSessionWithheld).toBe(5);
    expect(snapshot.instruments).toEqual(["IN:XNSE:RELIANCE"]);
  });

  it("refuses an empty store with the remedy named, instead of fetching", () => {
    const snapshot = snapshotFromStore("NSE", "5m", "test");
    expect(snapshot.ok).toBe(false);
    if (snapshot.ok) return;
    expect(snapshot.code).toBe("NO_STORED_DATA");
    expect(snapshot.message).toMatch(/ingestion/i);
    expect(snapshot.message).toMatch(/never replaced with a default|not a silent provider call/i);
  });
});

describe("T4 — resolution is part of dataset identity", () => {
  it("daily bars cannot satisfy a 5-minute snapshot", () => {
    persistCandles(
      Array.from({ length: 40 }, (_, index) => ({
        ticker: "IN:XNSE:RELIANCE",
        resolution: "D",
        time: OPEN + index * 86_400,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1_000,
      })),
    );
    const snapshot = snapshotFromStore("NSE", "5m", "test");
    expect(snapshot.ok).toBe(false);
  });
});

describe("T6 — one changed bar is a different dataset", () => {
  it("changes the fingerprint when a single bar changes", () => {
    seedBars();
    const first = snapshotFromStore("NSE", "5m", "test");
    if (!first.ok) throw new Error("first snapshot failed");

    // Mutate exactly one bar, via raw SQL: the store's own API is append-only by design, and the
    // point of this test is that even an out-of-band change is visible in the fingerprint.
    //
    // One paisa, not a tenfold jump. A large mutation now trips the snapshot's unexplained-step
    // quarantine (the instrument is withheld, and there is nothing left to fingerprint) — which is
    // the guard working. A minimal delta tests what this test is actually about, and tests it
    // harder: the fingerprint must notice the smallest possible change.
    closeDbForTests();
    const raw = new Database(process.env.MARKETPULSE_DB_PATH!);
    raw.prepare("UPDATE price_candles SET close = close + 0.01 WHERE time = ?").run(OPEN);
    raw.close();
    getDb();

    const second = snapshotFromStore("NSE", "5m", "test");
    if (!second.ok) throw new Error("second snapshot failed");
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.snapshotId).not.toBe(first.snapshotId);
  });

  it("reuses the same snapshot row when nothing changed", () => {
    seedBars();
    const first = snapshotFromStore("NSE", "5m", "test");
    const second = snapshotFromStore("NSE", "5m", "test");
    if (!first.ok || !second.ok) throw new Error("snapshot failed");
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(getDb().select().from(schema.datasetSnapshots).all()).toHaveLength(1);
  });
});

describe("T2/T7/T8 — a completed experiment is evidence and cannot drift", () => {
  it("reopens with exactly the trades it recorded, even after the store changes", () => {
    seedBars();
    const snapshot = snapshotFromStore("NSE", "5m", "test");
    if (!snapshot.ok) throw new Error("snapshot failed");

    const trades = [{ index: 0, note: "t0" }, { index: 1, note: "t1" }, { index: 2, note: "t2" }];
    const specId = "stg_test_spec";
    getDb()
      .insert(schema.strategySpecs)
      .values({ id: specId, name: "probe", version: 1, dsl: "{}", dslHash: "h", status: "draft", createdBy: "t", createdAt: new Date() })
      .run();
    recordExperiment({
      specId,
      snapshotId: snapshot.snapshotId,
      kind: "inspection",
      engineVersion: "1.4.0",
      executionProfileId: null,
      summary: "3 trade(s)",
      trades,
      actor: "test",
    });

    // The store then changes — new bars arrive, exactly what happens in production daily.
    seedBars("IN:XNSE:TCS", 80, 500);

    const reopened = latestExperiment(specId);
    expect(reopened).not.toBeNull();
    expect(reopened!.trades).toHaveLength(3);
    expect(reopened!.trades).toEqual(trades);
    expect(reopened!.experiment.tradeCount).toBe(3);
  });

  it("survives a cold reopen: new connection, ledger intact", () => {
    seedBars();
    const snapshot = snapshotFromStore("NSE", "5m", "test");
    if (!snapshot.ok) throw new Error("snapshot failed");
    getDb()
      .insert(schema.strategySpecs)
      .values({ id: "stg_cold", name: "cold", version: 1, dsl: "{}", dslHash: "h", status: "draft", createdBy: "t", createdAt: new Date() })
      .run();
    recordExperiment({
      specId: "stg_cold",
      snapshotId: snapshot.snapshotId,
      kind: "inspection",
      engineVersion: "1.4.0",
      executionProfileId: null,
      summary: "1 trade(s)",
      trades: [{ index: 0 }],
      actor: "test",
    });

    closeDbForTests(); // application restart
    getDb();

    const reopened = latestExperiment("stg_cold");
    expect(reopened!.trades).toHaveLength(1);
  });

  it("refuses to delete ledger rows — evidence cannot be unsaid", () => {
    seedBars();
    const snapshot = snapshotFromStore("NSE", "5m", "test");
    if (!snapshot.ok) throw new Error("snapshot failed");
    getDb()
      .insert(schema.strategySpecs)
      .values({ id: "stg_del", name: "del", version: 1, dsl: "{}", dslHash: "h", status: "draft", createdBy: "t", createdAt: new Date() })
      .run();
    recordExperiment({
      specId: "stg_del",
      snapshotId: snapshot.snapshotId,
      kind: "inspection",
      engineVersion: "1.4.0",
      executionProfileId: null,
      summary: "s",
      trades: [{ index: 0 }],
      actor: "test",
    });
    expect(() => getDb().delete(schema.experimentTrades).run()).toThrow(/append-only/i);
    expect(() => getDb().delete(schema.experiments).run()).toThrow(/append-only/i);
  });
});
