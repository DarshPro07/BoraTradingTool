import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import {
  activeSealFor,
  authorizeSeal,
  consumeSeal,
  createSeal,
  verifySealIntegrity,
  type HoldoutDecisionRule,
} from "./holdout-seal";

/**
 * The seal's whole job is immutability with a state machine: pinned window, pinned rule, one
 * live seal per universe, transitions only in order, and loud invalidation when the sealed bars
 * drift. Every test here reads the definition back from the database — the seal IS its row.
 */

useTemporaryDatabase();

const RULE: HoldoutDecisionRule = { minNetProfitFactor: 1.1, minTrades: 30 };
const OPEN_UTC = Date.UTC(2025, 0, 6, 3, 45, 0) / 1000;

function seedDaily(ticker: string, days = 400): void {
  const db = getDb();
  const rows = Array.from({ length: days }, (_, index) => ({
    ticker,
    resolution: "D",
    time: OPEN_UTC + index * 86_400,
    open: 100,
    high: 102,
    low: 98,
    close: 100 + (index % 9),
    volume: 1_000,
  }));
  for (const row of rows) db.insert(schema.priceCandles).values(row).run();
}

describe("sealing a window", () => {
  it("pins window, rule, fingerprint and defaults; one live seal per universe", async () => {
    seedDaily("IN:XNSE:SEALA");
    seedDaily("IN:XNSE:SEALB");

    const sealed = await createSeal({ market: "NSE", resolution: "D", decisionRule: RULE, actor: "test" });
    expect(sealed.ok, sealed.ok ? "" : sealed.message).toBe(true);
    if (!sealed.ok) return;

    expect(sealed.seal.state).toBe("SEALED");
    expect(sealed.seal.generation).toBe(1);
    expect(sealed.seal.barCount).toBeGreaterThanOrEqual(60);
    expect(sealed.seal.decisionRule).toEqual(RULE);
    expect(sealed.seal.purgeGapSeconds).toBe(14 * 86_400);
    expect(sealed.seal.embargoSeconds).toBe(7 * 86_400);
    expect(sealed.seal.endTime).toBeGreaterThan(sealed.seal.startTime);

    // The sealed-window snapshot row exists and is the definition's pin.
    const snapshot = getDb()
      .select()
      .from(schema.datasetSnapshots)
      .where(eq(schema.datasetSnapshots.id, sealed.seal.datasetSnapshotId))
      .get();
    expect(snapshot?.fingerprint).toBe(sealed.seal.fingerprint);

    const second = await createSeal({ market: "NSE", resolution: "D", decisionRule: RULE, actor: "test" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("ACTIVE_SEAL_EXISTS");

    expect(activeSealFor("NSE", "D")?.id).toBe(sealed.seal.id);
  });

  it("refuses a window too thin to satisfy the pinned minimum-trades rule", async () => {
    seedDaily("IN:XNSE:THIN");
    const last = OPEN_UTC + 399 * 86_400;
    const thin = await createSeal({
      market: "NSE",
      resolution: "D",
      decisionRule: RULE,
      actor: "test",
      startTime: last - 86_400,
      endTime: last,
    });
    expect(thin.ok).toBe(false);
    if (!thin.ok) expect(thin.code).toBe("WINDOW_TOO_THIN");
  });
});

describe("the state machine", () => {
  it("only SEALED authorizes; only AUTHORIZED consumes; a consumed universe can seal generation 2", async () => {
    seedDaily("IN:XNSE:STATEA");
    const sealed = await createSeal({ market: "NSE", resolution: "D", decisionRule: RULE, actor: "test" });
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const id = sealed.seal.id;

    // Consuming before authorization is refused with the state named.
    const early = consumeSeal(id, "premature");
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe("WRONG_STATE");

    const authorized = authorizeSeal(id, "owner:test");
    expect(authorized.ok).toBe(true);

    const again = authorizeSeal(id, "owner:test");
    expect(again.ok).toBe(false);

    const consumed = consumeSeal(id, "evaluation recorded (test)");
    expect(consumed.ok).toBe(true);

    const row = getDb()
      .select()
      .from(schema.holdoutDefinitions)
      .where(eq(schema.holdoutDefinitions.id, id))
      .get();
    expect(row?.state).toBe("CONSUMED");
    expect(row?.stateReason).toMatch(/evaluation recorded/);

    // The universe is free again — and the next seal is GENERATION 2, never a reuse.
    const next = await createSeal({ market: "NSE", resolution: "D", decisionRule: RULE, actor: "test" });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.seal.generation).toBe(2);
  });
});

describe("integrity", () => {
  it("a mutated sealed bar invalidates the seal loudly", async () => {
    seedDaily("IN:XNSE:DRIFT");
    const sealed = await createSeal({ market: "NSE", resolution: "D", decisionRule: RULE, actor: "test" });
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    const clean = await verifySealIntegrity(sealed.seal.id);
    expect(clean.ok).toBe(true);

    // Mutate one bar INSIDE the window.
    const inside = sealed.seal.startTime + Math.floor((sealed.seal.endTime - sealed.seal.startTime) / 2);
    const bar = getDb()
      .select()
      .from(schema.priceCandles)
      .where(and(eq(schema.priceCandles.ticker, "IN:XNSE:DRIFT"), eq(schema.priceCandles.resolution, "D")))
      .all()
      .find((row) => row.time >= inside);
    expect(bar).toBeDefined();
    getDb()
      .update(schema.priceCandles)
      .set({ close: bar!.close + 1 })
      .where(
        and(
          eq(schema.priceCandles.ticker, "IN:XNSE:DRIFT"),
          eq(schema.priceCandles.resolution, "D"),
          eq(schema.priceCandles.time, bar!.time),
        ),
      )
      .run();

    const drifted = await verifySealIntegrity(sealed.seal.id);
    expect(drifted.ok).toBe(false);
    if (!drifted.ok) expect(drifted.code).toBe("FINGERPRINT_DRIFT");

    const row = getDb()
      .select()
      .from(schema.holdoutDefinitions)
      .where(eq(schema.holdoutDefinitions.id, sealed.seal.id))
      .get();
    expect(row?.state).toBe("INVALIDATED");
    expect(row?.stateReason).toMatch(/changed underneath/);
  });
});

/**
 * DEVELOPMENT EXCLUSION — the property that makes a seal a seal.
 *
 * Before this, `snapshotFromStore` served the ENTIRE store to backtest/validation/rehearsal, so
 * the would-be holdout window was visible to every development experiment and no later
 * evaluation of it could be unbiased. With a live seal, a development snapshot must contain no
 * bar inside [start − purgeGap, end + embargo]: the purge keeps development labels from
 * overlapping into the window, the embargo keeps the window's serial correlation from leaking
 * out of it. Once the seal is consumed or invalidated, the region is development-legal again.
 */
describe("development snapshots exclude the sealed region", () => {
  it("no dev bar falls inside [start − purge, end + embargo] while a seal is live", async () => {
    const { snapshotFromStore } = await import("./snapshot");
    seedDaily("IN:XNSE:EXCLA");

    const before = snapshotFromStore("NSE", "D", "backtest");
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    const sealed = await createSeal({ market: "NSE", resolution: "D", decisionRule: RULE, actor: "test" });
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const lo = sealed.seal.startTime - sealed.seal.purgeGapSeconds;
    const hi = sealed.seal.endTime + sealed.seal.embargoSeconds;

    const dev = snapshotFromStore("NSE", "D", "backtest");
    expect(dev.ok).toBe(true);
    if (!dev.ok) return;

    const leaked = Object.values(dev.dataset)
      .flat()
      .filter((bar) => bar.time >= lo && bar.time <= hi);
    expect(
      leaked.length,
      `development snapshot leaks ${leaked.length} bar(s) from the sealed region [${lo}, ${hi}] — the holdout is visible to development`,
    ).toBe(0);
    // And it is a DIFFERENT dataset than the unsealed build, by fingerprint.
    expect(dev.fingerprint).not.toBe(before.fingerprint);

    // The FORWARD stage is consumption, not development — it must still see the full store
    // while the seal is live (blinding it zeroed the entire shadow stage on the first
    // consolidation master run: the sealed tail IS the recent data forward observation watches).
    const forward = snapshotFromStore("NSE", "D", "forward-shadow");
    expect(forward.ok).toBe(true);
    if (forward.ok) expect(forward.fingerprint).toBe(before.fingerprint);

    // FAIL-CLOSED, and this is the whole point: the boundary may not depend on someone having
    // remembered to enumerate their actor. An allowlist of development actors let `gauntlet` —
    // which SPENDS A PERMANENT TRIAL and selects on what it sees — replay across the sealed
    // window, and `statarb-formation` (pair mining IS strategy search) with it. Anything that is
    // not explicitly a consumption stage is development until proven otherwise.
    for (const developmentActor of [
      "gauntlet",
      "statarb-formation",
      "statarb-walkforward",
      "inspection",
      "some-actor-invented-next-year",
    ]) {
      const snapshot = snapshotFromStore("NSE", "D", developmentActor);
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) continue;
      const peeked = Object.values(snapshot.dataset)
        .flat()
        .filter((bar) => bar.time >= lo && bar.time <= hi);
      expect(
        peeked.length,
        `actor "${developmentActor}" saw ${peeked.length} sealed bar(s) — an unlisted actor must fail CLOSED, not open`,
      ).toBe(0);
    }

    // Consuming the seal frees the region for development again.
    authorizeSeal(sealed.seal.id, "owner:test");
    consumeSeal(sealed.seal.id, "done (test)");
    const after = snapshotFromStore("NSE", "D", "backtest");
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.fingerprint).toBe(before.fingerprint);
  });
});
