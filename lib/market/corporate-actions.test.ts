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

describe("inferred actions are lower authority than declared ones", () => {
  const SPLIT_AT2 = 1_730_500_000;
  const DAY2 = 86_400;

  function store2(price: number, count: number, from: number) {
    return Array.from({ length: count }, (_unused, i) => ({
      ticker: "IN:XNSE:BONUSCO",
      resolution: "D",
      time: from + i * DAY2,
      open: price,
      high: price * 1.005,
      low: price * 0.995,
      close: price,
      volume: 1_000,
    }));
  }

  /**
   * Owner rule, 2026-08-16: `detected:store` must never be promoted to the authority of an
   * exchange- or provider-declared action. A bonus issue Yahoo does not report and we deduce from
   * a 2.99x step is a defensible correction — it is not the same evidence.
   *
   * So a snapshot built partly on inference is a DIFFERENT dataset from one built entirely on
   * declared actions, and the two must not be able to share a fingerprint. Otherwise a
   * validation-grade result could rest on inference without any reader being able to tell.
   */
  it("reports how much of the correction rests on inference, and feeds it into the hash", async () => {
    const { persistCandles } = await import("./candle-store");
    const { snapshotFromStore } = await import("@/lib/research-data/snapshot");

    persistCandles([...store2(2000, 6, SPLIT_AT2 - 6 * DAY2), ...store2(1000, 6, SPLIT_AT2)]);
    recordCorporateActions([
      {
        instrumentId: "IN:XNSE:BONUSCO",
        effectiveTime: SPLIT_AT2,
        kind: "SPLIT",
        ratio: 2,
        amount: null,
        source: "detected:store",
      },
    ]);

    const snapshot = snapshotFromStore("NSE", "D", "rehearsal");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    // The correction landed — the 2x step is gone...
    expect(snapshot.actionsApplied).toBe(1);
    expect(snapshot.dataset["IN:XNSE:BONUSCO"][0].close).toBeCloseTo(1000, 6);
    // ...and the snapshot says out loud that it rests on an inference rather than a declaration.
    // `buildSnapshot` also folds the instrument, time and factor of each inferred correction into
    // the fingerprint, so an inferred series cannot pass as a declared one.
    expect(snapshot.inferredActionsUsed).toBe(1);
  });

  it("counts a provider-declared correction as zero inference", async () => {
    const { persistCandles } = await import("./candle-store");
    const { snapshotFromStore } = await import("@/lib/research-data/snapshot");

    persistCandles([...store2(2000, 6, SPLIT_AT2 - 6 * DAY2), ...store2(1000, 6, SPLIT_AT2)]);
    recordCorporateActions([
      {
        instrumentId: "IN:XNSE:BONUSCO",
        effectiveTime: SPLIT_AT2,
        kind: "SPLIT",
        ratio: 2,
        amount: null,
        source: "yahoo:events",
      },
    ]);

    const snapshot = snapshotFromStore("NSE", "D", "rehearsal");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.actionsApplied).toBe(1);
    expect(snapshot.inferredActionsUsed, "a declared action is not an inference").toBe(0);
  });
});

describe("out-of-session bars must not reach regular-session research", () => {
  /**
   * Measured 2026-08-16 in the production store. The scheduled accumulation pass flagged nine
   * `OUT_OF_SESSION` fetches, and they resolved to one bar type on one date:
   *
   *   2026-08-14 (Friday) 15:30 IST — exactly the session close
   *   ASAHIINDIA · BALAMINES · BLUEDART, at 5m, 15m and 60m
   *   O = H = L = C, volume = 0
   *
   * A zero-volume, zero-range stamp at the closing boundary is a provider artifact, not a traded
   * observation — nothing changed hands at that price at that time. All three instruments were
   * nonetheless counted among the eighteen family-ready names.
   *
   * The bar is kept: it is a real thing the provider said, and the ledger records it. What it must
   * not do is enter a REGULAR-SESSION backtest as a tradeable price, because a strategy without a
   * time cutoff would fill at a price where no volume existed. The declared seeds happen to
   * exclude it via their 14:30 entry cutoff, but that is a property of those seeds, not a
   * guarantee the engine makes.
   */
  const IST_OFFSET = 19_800;

  /** A bar at `hhmm` IST on a given date, in the store's shape. */
  function barAt(date: string, hhmm: string, ticker: string, resolution: string, volume: number) {
    const [h, m] = hhmm.split(":").map(Number);
    const midnightUtc = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
    return {
      ticker,
      resolution,
      time: midnightUtc + h * 3600 + m * 60 - IST_OFFSET,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume,
    };
  }

  it("withholds a closing-boundary artifact while keeping the session's real bars", async () => {
    const { persistCandles } = await import("./candle-store");
    const { snapshotFromStore } = await import("@/lib/research-data/snapshot");

    const ticker = "IN:XNSE:CLOSESTAMP";
    const bars = [];
    // A full regular session, 09:15 through 15:25 at 5m.
    for (let minute = 9 * 60 + 15; minute <= 15 * 60 + 25; minute += 5) {
      const hh = String(Math.floor(minute / 60)).padStart(2, "0");
      const mm = String(minute % 60).padStart(2, "0");
      bars.push(barAt("2026-08-14", `${hh}:${mm}`, ticker, "5", 1_000));
    }
    // ...plus the artifact at exactly the close.
    bars.push(barAt("2026-08-14", "15:30", ticker, "5", 0));
    persistCandles(bars);

    const snapshot = snapshotFromStore("NSE", "5m", "rehearsal");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    const served = snapshot.dataset[ticker] ?? [];
    expect(served.length, "the session's real bars must survive").toBe(bars.length - 1);

    // Nothing at or beyond the close reaches research.
    const minuteOf = (time: number) => {
      const ist = (time + IST_OFFSET) % 86_400;
      return Math.floor(ist / 60);
    };
    expect(served.every((bar) => minuteOf(bar.time) < 15 * 60 + 30)).toBe(true);
    expect(snapshot.outOfSessionWithheld).toBe(1);
  });

  it("leaves daily bars alone — they have no intraday session to be outside of", async () => {
    const { persistCandles } = await import("./candle-store");
    const { snapshotFromStore } = await import("@/lib/research-data/snapshot");

    const ticker = "IN:XNSE:DAILYONLY";
    // Trading days, not calendar days: a flat 86,400s stride manufactures weekend bars, which the
    // store refuses (`tests/invariants/session-calendar.invariant.test.ts`). The point of this test
    // is the intraday session filter, so the fixture must not trip a different guard on the way in.
    const { sessionOpenEpoch, isPlausibleSessionDate } = await import("./session-calendar");
    const sessions: number[] = [];
    for (const cursor = new Date("2023-11-15T00:00:00Z"); sessions.length < 40; ) {
      const iso = cursor.toISOString().slice(0, 10);
      // Real sessions, not merely weekdays — the store also refuses trading holidays.
      if (isPlausibleSessionDate(iso)) sessions.push(sessionOpenEpoch(iso));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    persistCandles(
      sessions.map((time) => ({
        ticker,
        resolution: "D",
        time,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1_000,
      })),
    );
    const snapshot = snapshotFromStore("NSE", "D", "rehearsal");
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.dataset[ticker]?.length).toBe(40);
    expect(snapshot.outOfSessionWithheld).toBe(0);
  });
});
