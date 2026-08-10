import { describe, expect, it } from "vitest";
import { useTemporaryDatabase } from "@/lib/db/testing";
import {
  ContractMasterError,
  contractAsOf,
  currentCatalogOnly,
  isTradableAt,
  universeAsOf,
  type InstrumentSnapshot,
} from "./contract-master";

useTemporaryDatabase();

/**
 * Point-in-time instrument metadata.
 *
 * `INSTRUMENT_CATALOG` in `lib/market/catalog.ts` is a frozen array of today's cash equities, and
 * every backtest in this repository reads it. That is survivorship bias by construction: an
 * instrument delisted in 2025 is invisible to a 2024 simulation, so the simulation only ever picks
 * from names that survived — and it will never report an error, only a better result.
 *
 * The firewall is one rule: **a query at `asOf = T` may only see snapshots observed at or before
 * T.** Everything here tests that rule and its consequences.
 */

function snapshot(overrides: Partial<InstrumentSnapshot> & { observedAt: string }): InstrumentSnapshot {
  return {
    instrumentKey: "NSE_FO|NIFTY24MARFUT",
    tradingSymbol: "NIFTY24MARFUT",
    underlying: "NIFTY",
    exchange: "NSE",
    segment: "FO",
    instrumentType: "FUTURES",
    lotSize: 50,
    tickSize: 0.05,
    listingStatus: "LISTED",
    expiry: "2024-03-28",
    ...overrides,
    observedAt: overrides.observedAt,
  };
}

/** A contract whose lot size was revised, plus a cash name that later delisted. */
const HISTORY: InstrumentSnapshot[] = [
  snapshot({ observedAt: "2024-01-01", lotSize: 50 }),
  snapshot({ observedAt: "2024-02-15", lotSize: 25 }), // NSE revised the lot
  snapshot({
    observedAt: "2024-01-01",
    instrumentKey: "NSE_EQ|DELISTCO",
    tradingSymbol: "DELISTCO",
    underlying: "DELISTCO",
    segment: "EQ",
    instrumentType: "EQUITY",
    expiry: null,
    lotSize: 1,
  }),
  snapshot({
    observedAt: "2025-06-01",
    instrumentKey: "NSE_EQ|DELISTCO",
    tradingSymbol: "DELISTCO",
    underlying: "DELISTCO",
    segment: "EQ",
    instrumentType: "EQUITY",
    expiry: null,
    lotSize: 1,
    listingStatus: "DELISTED",
  }),
];

describe("the leakage firewall", () => {
  it("hides a snapshot observed after the query date", () => {
    // The 2024-02-15 lot revision must be invisible on 2024-01-20.
    const universe = universeAsOf(HISTORY, new Date("2024-01-20T00:00:00Z"));
    const nifty = universe.find((row) => row.underlying === "NIFTY");
    expect(nifty?.lotSize).toBe(50);
  });

  it("uses the most recent snapshot at or before the query date", () => {
    const universe = universeAsOf(HISTORY, new Date("2024-03-01T00:00:00Z"));
    expect(universe.find((row) => row.underlying === "NIFTY")?.lotSize).toBe(25);
  });

  it("refuses a date earlier than anything observed, rather than returning an empty universe", () => {
    // An empty array here would read as "no instruments existed in 2020", which is false — the
    // archive simply does not reach back that far. Missing is not zero.
    expect(() => universeAsOf(HISTORY, new Date("2020-01-01T00:00:00Z"))).toThrow(ContractMasterError);
  });
});

describe("survivorship", () => {
  it("still shows an instrument that later delisted, at a date when it was listed", () => {
    // The bias this whole module exists to remove: DELISTCO must be selectable in 2024.
    const universe = universeAsOf(HISTORY, new Date("2024-06-01T00:00:00Z"));
    expect(universe.map((row) => row.tradingSymbol)).toContain("DELISTCO");
  });

  it("drops it once the delisting has been observed", () => {
    const universe = universeAsOf(HISTORY, new Date("2025-08-01T00:00:00Z"));
    expect(universe.map((row) => row.tradingSymbol)).not.toContain("DELISTCO");
  });
});

describe("expiry is a property of the contract, not of the query", () => {
  it("treats a futures contract as tradable before its expiry", () => {
    const row = contractAsOf(HISTORY, "NSE_FO|NIFTY24MARFUT", new Date("2024-02-01T00:00:00Z"));
    expect(isTradableAt(row, new Date("2024-02-01T00:00:00Z"))).toBe(true);
  });

  it("treats it as untradable after its expiry, even though the snapshot still exists", () => {
    // The snapshot remains — the contract is still a historical fact — but no order could be
    // placed in it on that date.
    const row = contractAsOf(HISTORY, "NSE_FO|NIFTY24MARFUT", new Date("2024-05-01T00:00:00Z"));
    expect(isTradableAt(row, new Date("2024-05-01T00:00:00Z"))).toBe(false);
  });

  it("never expires a cash equity", () => {
    const row = contractAsOf(HISTORY, "NSE_EQ|DELISTCO", new Date("2024-06-01T00:00:00Z"));
    expect(isTradableAt(row, new Date("2024-06-01T00:00:00Z"))).toBe(true);
  });
});

describe("point-in-time contract metadata", () => {
  it("returns the lot size that applied then, not the latest one", () => {
    // Using today's lot size for a 2024 trade misstates every rupee of P&L on it.
    const row = contractAsOf(HISTORY, "NSE_FO|NIFTY24MARFUT", new Date("2024-01-20T00:00:00Z"));
    expect(row.lotSize).toBe(50);
  });

  it("refuses an instrument that was not yet observed", () => {
    expect(() =>
      contractAsOf(HISTORY, "NSE_FO|NIFTY24MARFUT", new Date("2023-06-01T00:00:00Z")),
    ).toThrow(ContractMasterError);
  });

  it("refuses an instrument that is not in the archive at all", () => {
    expect(() => contractAsOf(HISTORY, "NSE_EQ|GHOST", new Date("2024-06-01T00:00:00Z"))).toThrow(
      /GHOST/,
    );
  });
});

describe("the static catalog refuses to answer a historical question", () => {
  it("serves the current universe when no as-of date is given", () => {
    expect(currentCatalogOnly(null).length).toBeGreaterThan(0);
  });

  it("refuses to be used as a historical universe", () => {
    // This is the actual fix for the survivorship bug: INSTRUMENT_CATALOG is today's list, so
    // asking it what existed in 2024 must fail loudly rather than answer confidently.
    expect(() => currentCatalogOnly(new Date("2024-06-01T00:00:00Z"))).toThrow(ContractMasterError);
    expect(() => currentCatalogOnly(new Date("2024-06-01T00:00:00Z"))).toThrow(/survivorship/i);
  });
});
