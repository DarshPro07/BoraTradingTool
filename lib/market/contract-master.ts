import { listCurrentInstruments } from "./catalog";
import type { Instrument } from "./types";

/**
 * Point-in-time instrument and contract metadata.
 *
 * ## The bias this removes
 *
 * A current-only catalog contains today's cash equities. Treating it as historical makes
 * survivorship bias structural rather than accidental: a name
 * delisted in 2025 is simply absent from a 2024 simulation, so the simulation can only ever pick
 * from companies that survived. It never errors. It just reports a better number than the strategy
 * would have achieved, and the error grows with the length of the backtest.
 *
 * The same applies to derivatives with an extra edge: `NIFTY` is not one permanently tradable
 * security. It is a succession of contracts, each with its own expiry, lot size and tick size, and
 * NSE revises those. Pricing a 2024 trade with today's lot size misstates every rupee of its P&L.
 *
 * ## The rule
 *
 * **A query at `asOf = T` may see only snapshots observed at or before T**, and of those, the most
 * recent one per instrument. Everything else follows.
 *
 * Two failure modes are deliberately kept apart:
 *
 *   - **not yet observed** — the archive does not reach back that far. A refusal, never an empty
 *     universe, because `[]` reads as "nothing existed then" and that is a different claim.
 *   - **expired or delisted** — the instrument is a historical fact that still belongs in the
 *     archive, but no order could be placed in it on that date. `isTradableAt` answers that; the
 *     snapshot is not deleted.
 */

export type ListingStatus = "LISTED" | "SUSPENDED" | "DELISTED";
export type InstrumentType = "EQUITY" | "ETF" | "FUTURES" | "OPTIONS" | "INDEX";

export interface InstrumentSnapshot {
  /** When this observation was taken. The point-in-time key — nothing here is visible before it. */
  observedAt: string;
  instrumentKey: string;
  tradingSymbol: string;
  underlying: string;
  exchange: string;
  segment: string;
  instrumentType: InstrumentType;
  /** Contract size at `observedAt`. Revised by the exchange; never assume today's value. */
  lotSize: number;
  tickSize: number;
  listingStatus: ListingStatus;
  /** ISO date. Null for cash equities and ETFs, which do not expire. */
  expiry: string | null;
}

export type ContractMasterErrorCode =
  | "NOT_YET_OBSERVED"
  | "UNKNOWN_INSTRUMENT"
  | "STATIC_CATALOG_IS_NOT_HISTORICAL";

export class ContractMasterError extends Error {
  constructor(
    readonly code: ContractMasterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContractMasterError";
  }
}

function observedBy(snapshot: InstrumentSnapshot, asOf: Date): boolean {
  return Date.parse(snapshot.observedAt) <= asOf.getTime();
}

/**
 * The most recent snapshot per instrument at or before `asOf`.
 *
 * Sorted ascending by `observedAt` and overwritten as we go, so the last write per key is the
 * latest observation that was actually available. Later snapshots are not merely filtered out of
 * the result — they never participate.
 */
function latestByInstrument(
  snapshots: readonly InstrumentSnapshot[],
  asOf: Date,
): Map<string, InstrumentSnapshot> {
  const visible = snapshots
    .filter((snapshot) => observedBy(snapshot, asOf))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  const latest = new Map<string, InstrumentSnapshot>();
  for (const snapshot of visible) latest.set(snapshot.instrumentKey, snapshot);
  return latest;
}

function assertReachesBack(snapshots: readonly InstrumentSnapshot[], asOf: Date): void {
  const earliest = snapshots.reduce(
    (min, snapshot) => Math.min(min, Date.parse(snapshot.observedAt)),
    Number.POSITIVE_INFINITY,
  );
  if (asOf.getTime() >= earliest) return;
  throw new ContractMasterError(
    "NOT_YET_OBSERVED",
    `The instrument archive begins ${new Date(earliest).toISOString().slice(0, 10)}, after the ` +
      `requested ${asOf.toISOString().slice(0, 10)}. Returning an empty universe would assert that ` +
      "no instruments existed then, which is a different claim from not knowing.",
  );
}

/**
 * Every instrument that was listed and known at `asOf`.
 *
 * Includes names that later delisted — that is the entire point. Excludes names whose delisting
 * had already been observed by `asOf`, because they were genuinely gone by then.
 */
export function universeAsOf(
  snapshots: readonly InstrumentSnapshot[],
  asOf: Date,
): InstrumentSnapshot[] {
  assertReachesBack(snapshots, asOf);
  return [...latestByInstrument(snapshots, asOf).values()]
    .filter((snapshot) => snapshot.listingStatus === "LISTED")
    .sort((a, b) => a.instrumentKey.localeCompare(b.instrumentKey));
}

/** One instrument's metadata as it stood at `asOf`. */
export function contractAsOf(
  snapshots: readonly InstrumentSnapshot[],
  instrumentKey: string,
  asOf: Date,
): InstrumentSnapshot {
  const known = snapshots.some((snapshot) => snapshot.instrumentKey === instrumentKey);
  if (!known) {
    throw new ContractMasterError(
      "UNKNOWN_INSTRUMENT",
      `${instrumentKey} does not appear in the instrument archive at any date.`,
    );
  }

  const found = latestByInstrument(snapshots, asOf).get(instrumentKey);
  if (!found) {
    throw new ContractMasterError(
      "NOT_YET_OBSERVED",
      `${instrumentKey} exists in the archive but was not observed by ` +
        `${asOf.toISOString().slice(0, 10)}. Serving a later snapshot would be lookahead.`,
    );
  }
  return found;
}

/**
 * Whether an order could actually have been placed in this instrument on this date.
 *
 * Separate from presence in the archive. An expired March contract is still a historical fact and
 * still belongs in the record; it simply cannot be traded in May. Deleting it instead would make
 * the archive itself survivorship-contaminated.
 */
export function isTradableAt(snapshot: InstrumentSnapshot, at: Date): boolean {
  if (snapshot.listingStatus !== "LISTED") return false;
  if (snapshot.expiry === null) return true;
  // Expiry day itself is tradable; the contract dies at its close.
  return at.getTime() <= Date.parse(`${snapshot.expiry}T23:59:59Z`);
}

/**
 * The current catalog, which may only answer "what exists now".
 *
 * This is the fix for the structural bias rather than a warning about it. The current repository is
 * today's list; asking it what existed on a past date has one honest answer, and it is a refusal.
 * Making that refusal mechanical means a backtest cannot quietly acquire the bias by reaching for
 * the convenient import.
 */
export function currentCatalogOnly(asOf: Date | null): readonly Instrument[] {
  if (asOf !== null) {
    throw new ContractMasterError(
      "STATIC_CATALOG_IS_NOT_HISTORICAL",
      "The current instrument repository is not a historical universe, so using it for " +
        `${asOf.toISOString().slice(0, 10)} would introduce survivorship bias — it contains only ` +
        "instruments that still exist today. Use universeAsOf() against dated snapshots instead.",
    );
  }
  return listCurrentInstruments();
}
