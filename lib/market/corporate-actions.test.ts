import { describe, expect, it } from "vitest";
import { closeDatabase, getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import {
  actionsFor,
  corporateActionLedgerReady,
  recordCorporateActions,
  syncCorporateActions,
} from "./corporate-actions";
import type { CorporateAction } from "./price-basis";
import type { Instrument } from "./types";

/**
 * Durability is the point. The canonical store keeps raw traded prices — which execution
 * simulation needs — so the ONLY way a continuous series can be reconstructed later is if the
 * actions themselves survive. A ledger that lost them would leave the mixed-basis defect
 * permanently unfixable.
 */

useTemporaryDatabase();

const RELIANCE: Instrument = {
  id: "IN:XNSE:RELIANCE",
  market: "IN",
  exchange: "XNSE",
  symbol: "RELIANCE",
  providerSymbol: "RELIANCE.NS",
  name: "Reliance Industries",
} as Instrument;

const split: CorporateAction = {
  instrumentId: RELIANCE.id,
  effectiveTime: 1_730_087_100,
  kind: "SPLIT",
  ratio: 2,
  amount: null,
  source: "yahoo:events",
};

describe("the corporate-action ledger", () => {
  it("is installed", () => {
    expect(corporateActionLedgerReady()).toBe(true);
  });

  it("records an action and survives a restart", () => {
    expect(recordCorporateActions([split])).toBe(1);
    closeDatabase(); // a real restart for this process: the cached handle is dropped
    const held = actionsFor(RELIANCE.id);
    expect(held).toHaveLength(1);
    expect(held[0].ratio).toBe(2);
    expect(held[0].source).toBe("yahoo:events");
  });

  it("is idempotent, so re-syncing every day cannot duplicate an event", () => {
    expect(recordCorporateActions([split])).toBe(1);
    expect(recordCorporateActions([split])).toBe(0);
    expect(actionsFor(RELIANCE.id)).toHaveLength(1);
  });

  it("refuses to be edited or deleted — an action is what happened", () => {
    recordCorporateActions([split]);
    // Enforced by triggers, not by application logic, so immutability holds against any writer.
    expect(() => getDb().delete(schema.corporateActions).run()).toThrow(/append-only/i);
    expect(() =>
      getDb().update(schema.corporateActions).set({ ratio: 99 }).run(),
    ).toThrow(/immutable/i);
    expect(actionsFor(RELIANCE.id)[0].ratio).toBe(2);
  });

  it("keeps splits and dividends apart", () => {
    recordCorporateActions([
      split,
      { ...split, kind: "DIVIDEND", ratio: null, amount: 10 },
    ]);
    const held = actionsFor(RELIANCE.id);
    expect(held).toHaveLength(2);
    expect(held.filter((a) => a.kind === "SPLIT")).toHaveLength(1);
    expect(held.filter((a) => a.kind === "DIVIDEND")).toHaveLength(1);
  });
});

describe("syncing actions from the provider", () => {
  it("records what the provider declares, without reaching the network in a test", async () => {
    const report = await syncCorporateActions([RELIANCE], 0, 2_000_000_000, async () => [
      { effectiveTime: 1_730_087_100, kind: "SPLIT", ratio: 2, amount: null, evidence: "yahoo split 2:1" },
    ]);
    expect(report.instruments).toBe(1);
    expect(report.recorded).toBe(1);
    expect(report.failed).toBe(0);
    expect(actionsFor(RELIANCE.id)[0].ratio).toBe(2);
  });

  it("one instrument failing does not cost the others their sync", async () => {
    const second = { ...RELIANCE, id: "IN:XNSE:TCS", providerSymbol: "TCS.NS" } as Instrument;
    const report = await syncCorporateActions([RELIANCE, second], 0, 2_000_000_000, async (symbol) => {
      if (symbol === "RELIANCE.NS") throw new Error("provider rate limited");
      return [{ effectiveTime: 1_700_000_000, kind: "SPLIT", ratio: 5, amount: null, evidence: "yahoo split 5:1" }];
    });
    expect(report.failed).toBe(1);
    expect(report.recorded).toBe(1);
    expect(report.errors[0]).toMatch(/rate limited/);
    expect(actionsFor("IN:XNSE:TCS")).toHaveLength(1);
  });
});

describe("end to end: the RELIANCE discontinuity is gone from the snapshot", () => {
  /**
   * The whole point, reproduced against the real store and the real snapshot builder.
   *
   * Stored bars keep the mixed basis exactly as production holds it — 2,655 before the split,
   * 1,334 after — because those are the prices that were on the tape when each bar was written.
   * The snapshot must hand research a CONTINUOUS series without the store being rewritten.
   */
  const SPLIT_AT = 1_730_000_000;
  const DAY = 86_400;

  function store(price: number, count: number, from: number) {
    return Array.from({ length: count }, (_unused, i) => ({
      ticker: RELIANCE.id,
      resolution: "D",
      time: from + i * DAY,
      open: price,
      high: price * 1.005,
      low: price * 0.995,
      close: price,
      volume: 1_000,
    }));
  }

  it("hands research a continuous series while the store keeps the raw prices", async () => {
    const { persistCandles, loadStoredCandles } = await import("./candle-store");
    const { snapshotFromStore } = await import("@/lib/research-data/snapshot");

    persistCandles([
      ...store(2655.7, 6, SPLIT_AT - 6 * DAY),
      ...store(1334.35, 6, SPLIT_AT),
    ]);
    recordCorporateActions([
      { instrumentId: RELIANCE.id, effectiveTime: SPLIT_AT, kind: "SPLIT", ratio: 2, amount: null, source: "yahoo:events" },
    ]);

    const snapshot = snapshotFromStore("NSE", "D", "rehearsal");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    expect(snapshot.priceBasis).toBe("SPLIT_ADJUSTED");
    expect(snapshot.actionsApplied).toBe(1);

    const series = snapshot.dataset[RELIANCE.id];
    expect(series).toBeDefined();
    // The step that manufactured a -50% "oversold" signal is gone.
    const closes = series.map((bar) => bar.close);
    const worstStep = Math.min(...closes.slice(1).map((c, i) => c / closes[i]));
    expect(worstStep).toBeGreaterThan(0.9);

    // ...and the store still holds what actually traded, for execution simulation.
    const raw = loadStoredCandles(RELIANCE.id, "D");
    expect(raw[0].close).toBe(2655.7);
  });

  it("does not double-adjust when the stored series is already continuous", async () => {
    const { persistCandles } = await import("./candle-store");
    const { snapshotFromStore } = await import("@/lib/research-data/snapshot");

    // An instrument fetched entirely after the split: already adjusted end to end.
    persistCandles([...store(1334.35, 6, SPLIT_AT - 6 * DAY), ...store(1334.35, 6, SPLIT_AT)]);
    recordCorporateActions([
      { instrumentId: RELIANCE.id, effectiveTime: SPLIT_AT, kind: "SPLIT", ratio: 2, amount: null, source: "yahoo:events" },
    ]);

    const snapshot = snapshotFromStore("NSE", "D", "rehearsal");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.actionsApplied).toBe(0);
    expect(snapshot.actionsSkipped).toBe(1);
    expect(snapshot.dataset[RELIANCE.id][0].close).toBeCloseTo(1334.35, 4);
  });
});
