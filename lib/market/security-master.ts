import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { DataAvailability, Instrument, ListingStatus, NseAssetType } from "./types";

export type NseSourceKind = "MAIN" | "SME" | "ETF" | "REIT" | "INVIT";
const REQUIRED_NSE_SOURCE_KINDS: readonly NseSourceKind[] = ["MAIN", "SME", "ETF", "REIT", "INVIT"];

export interface NseSourceRow {
  securityId: string;
  isin: string;
  symbol: string;
  name: string;
  series: string;
  dateOfListing: string | null;
  paidUpValue: number | null;
  marketLot: number | null;
  faceValue: number | null;
  assetType: NseAssetType;
  source: NseSourceKind;
}

export interface NseSecurityMasterSource {
  kind: NseSourceKind;
  url: string;
  content: string;
}

export interface SecurityMasterSyncInput {
  observedAt: Date;
  actor: string;
  sources: readonly NseSecurityMasterSource[];
  minimumRows?: number;
  maxDropFraction?: number;
}

export type SecurityMasterSyncResult =
  | {
      ok: true;
      syncId: string;
      totalRows: number;
      mainRows: number;
      smeRows: number;
      etfRows: number;
      reitRows: number;
      invitRows: number;
    }
  | { ok: false; syncId: string; errorCode: SecurityMasterErrorCode; message: string };

export type SecurityMasterErrorCode =
  | "MALFORMED_SOURCE"
  | "DUPLICATE_SECURITY"
  | "IMPLAUSIBLE_ROW_DROP"
  | "NON_MONOTONIC_OBSERVATION"
  | "SOURCE_FETCH_FAILED"
  | "MASTER_UNAVAILABLE"
  | "NOT_YET_OBSERVED";

export class SecurityMasterError extends Error {
  constructor(
    readonly code: SecurityMasterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SecurityMasterError";
  }
}

export interface SecurityMasterInstrument extends Instrument {
  securityId: string;
  isin: string;
  series: string;
  listingStatus: ListingStatus;
  dataAvailability: DataAvailability;
  effectiveFrom: string;
  effectiveTo: string | null;
  assetType: NseAssetType;
}

export interface NseInstrumentSearch {
  items: SecurityMasterInstrument[];
  total: number;
  limit: number;
  offset: number;
}

const REQUIRED_HEADERS = [
  "SYMBOL",
  "NAME OF COMPANY",
  "SERIES",
  "DATE OF LISTING",
  "PAID UP VALUE",
  "MARKET LOT",
  "ISIN NUMBER",
  "FACE VALUE",
] as const;

const MONTHS: Readonly<Record<string, string>> = Object.freeze({
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
});

function csvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      record.push(value);
      value = "";
    } else if (character === "\n") {
      record.push(value.replace(/\r$/, ""));
      if (record.some((entry) => entry.trim())) records.push(record);
      record = [];
      value = "";
    } else value += character;
  }

  if (quoted) throw new SecurityMasterError("MALFORMED_SOURCE", "NSE CSV contains an unterminated quote.");
  record.push(value.replace(/\r$/, ""));
  if (record.some((entry) => entry.trim())) records.push(record);
  return records;
}

function normalizedHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().replace(/_/g, " ").replace(/\s+/g, " ").toUpperCase();
}

function isoListingDate(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  const match = /^(\d{1,2})-([A-Z]{3})-(\d{2}|\d{4})$/.exec(normalized);
  if (!match || !MONTHS[match[2]]) {
    throw new SecurityMasterError("MALFORMED_SOURCE", `Invalid NSE listing date: ${value}`);
  }
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${MONTHS[match[2]]}-${match[1].padStart(2, "0")}`;
}

function optionalNumber(value: string, label: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new SecurityMasterError("MALFORMED_SOURCE", `Invalid ${label}: ${value}`);
  }
  return parsed;
}

export function parseNseSecurityCsv(content: string, source: NseSourceKind): NseSourceRow[] {
  const records = csvRecords(content);
  if (records.length < 2) {
    throw new SecurityMasterError("MALFORMED_SOURCE", `${source} NSE CSV has no data rows.`);
  }
  const headers = records[0].map(normalizedHeader);
  const indexes = new Map(headers.map((header, index) => [header, index]));
  if (source === "ETF") {
    const required = ["SYMBOL", "SECURITYNAME", "DATEOFLISTING", "MARKETLOT", "ISINNUMBER", "FACEVALUE"];
    for (const header of required) {
      if (!indexes.has(header)) {
        throw new SecurityMasterError("MALFORMED_SOURCE", `ETF NSE CSV is missing ${header}.`);
      }
    }
    const readEtf = (row: string[], header: string) => (row[indexes.get(header) as number] ?? "").trim();
    return records.slice(1).map((record, index) => {
      const symbol = readEtf(record, "SYMBOL").toUpperCase();
      const name = readEtf(record, "SECURITYNAME").replace(/\s+/g, " ").trim();
      const isin = readEtf(record, "ISINNUMBER").toUpperCase();
      if (!symbol || !name || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
        throw new SecurityMasterError(
          "MALFORMED_SOURCE",
          `ETF NSE CSV row ${index + 2} requires symbol, security name, and a valid ISIN.`,
        );
      }
      return {
        securityId: isin,
        isin,
        symbol,
        name,
        series: "EQ",
        dateOfListing: isoListingDate(readEtf(record, "DATEOFLISTING")),
        paidUpValue: null,
        marketLot: optionalNumber(readEtf(record, "MARKETLOT"), "market lot"),
        faceValue: optionalNumber(readEtf(record, "FACEVALUE"), "face value"),
        assetType: "ETF",
        source,
      } satisfies NseSourceRow;
    });
  }
  for (const header of REQUIRED_HEADERS) {
    if (source === "SME" && header === "MARKET LOT") continue;
    if (!indexes.has(header)) {
      throw new SecurityMasterError("MALFORMED_SOURCE", `${source} NSE CSV is missing ${header}.`);
    }
  }

  const read = (row: string[], header: (typeof REQUIRED_HEADERS)[number]) =>
    (row[indexes.get(header) as number] ?? "").trim();

  const dataRecords = records.slice(1).filter((record) => {
    const noteOnly = (record[0] ?? "").trim().toUpperCase().startsWith("NOTE")
      && record.slice(1).every((value) => value.trim() === "");
    return !noteOnly;
  });

  return dataRecords.map((record, index) => {
    const symbol = read(record, "SYMBOL").toUpperCase();
    const name = read(record, "NAME OF COMPANY").replace(/\s+/g, " ").trim();
    const series = read(record, "SERIES").toUpperCase();
    const isin = read(record, "ISIN NUMBER").toUpperCase();
    if (!symbol || !name || !series || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
      throw new SecurityMasterError(
        "MALFORMED_SOURCE",
        `${source} NSE CSV row ${index + 2} requires symbol, name, series, and a valid ISIN.`,
      );
    }
    return {
      securityId: isin,
      isin,
      symbol,
      name,
      series,
      dateOfListing: isoListingDate(read(record, "DATE OF LISTING")),
      paidUpValue: optionalNumber(read(record, "PAID UP VALUE"), "paid-up value"),
      marketLot: optionalNumber(read(record, "MARKET LOT"), "market lot"),
      faceValue: optionalNumber(read(record, "FACE VALUE"), "face value"),
      assetType: source === "REIT" ? "REIT" : source === "INVIT" ? "INVIT" : "EQUITY",
      source,
    } satisfies NseSourceRow;
  });
}

function syncIdFor(input: SecurityMasterSyncInput): string {
  const hash = createHash("sha256");
  hash.update(input.observedAt.toISOString());
  for (const source of input.sources) hash.update(`${source.kind}|${source.url}|${source.content}`);
  return `nse_sync_${Math.floor(input.observedAt.getTime() / 1000)}_${hash.digest("hex").slice(0, 12)}`;
}

function sourceManifest(sources: readonly NseSecurityMasterSource[]): string {
  return JSON.stringify(
    sources.map((source) => ({
      kind: source.kind,
      url: source.url,
      sha256: createHash("sha256").update(source.content).digest("hex"),
      bytes: Buffer.byteLength(source.content, "utf8"),
    })),
  );
}

function sameListing(
  current: typeof schema.nseListingVersions.$inferSelect,
  incoming: NseSourceRow,
): boolean {
  return (
    current.symbol === incoming.symbol &&
    current.name === incoming.name &&
    current.series === incoming.series &&
    current.assetType === incoming.assetType &&
    current.listingStatus === "LISTED" &&
    current.dateOfListing === incoming.dateOfListing &&
    current.paidUpValue === incoming.paidUpValue &&
    current.marketLot === incoming.marketLot &&
    current.faceValue === incoming.faceValue
  );
}

function listingValues(row: NseSourceRow, syncId: string, effectiveFrom: Date) {
  return {
    isin: row.isin,
    exchange: "XNSE",
    symbol: row.symbol,
    name: row.name,
    series: row.series,
    assetType: row.assetType,
    listingStatus: "LISTED",
    dateOfListing: row.dateOfListing,
    paidUpValue: row.paidUpValue,
    marketLot: row.marketLot,
    faceValue: row.faceValue,
    effectiveFrom,
    effectiveTo: null,
    sourceSyncId: syncId,
  };
}

export function applyNseSecurityMasterSync(input: SecurityMasterSyncInput): SecurityMasterSyncResult {
  if (!Number.isFinite(input.observedAt.getTime()) || input.sources.length === 0) {
    throw new SecurityMasterError("MALFORMED_SOURCE", "A valid observation time and source are required.");
  }

  const db = getDb();
  const syncId = syncIdFor(input);
  const existingAttempt = db
    .select()
    .from(schema.securityMasterSyncs)
    .where(eq(schema.securityMasterSyncs.id, syncId))
    .get();
  if (existingAttempt?.status === "SUCCEEDED") {
    const rows = input.sources.flatMap((source) => parseNseSecurityCsv(source.content, source.kind));
    return {
      ok: true,
      syncId,
      totalRows: rows.length,
      mainRows: rows.filter((row) => row.source === "MAIN").length,
      smeRows: rows.filter((row) => row.source === "SME").length,
      etfRows: rows.filter((row) => row.source === "ETF").length,
      reitRows: rows.filter((row) => row.source === "REIT").length,
      invitRows: rows.filter((row) => row.source === "INVIT").length,
    };
  }
  if (existingAttempt?.status === "FAILED") {
    return {
      ok: false,
      syncId,
      errorCode: (existingAttempt.errorCode as SecurityMasterErrorCode | null) ?? "MALFORMED_SOURCE",
      message: existingAttempt.errorMessage ?? "The previous identical sync attempt failed.",
    };
  }
  const now = new Date();
  db.insert(schema.securityMasterSyncs)
    .values({
      id: syncId,
      observedAt: input.observedAt,
      startedAt: now,
      status: "STARTED",
      sourceManifest: sourceManifest(input.sources),
      actor: input.actor,
    })
    .onConflictDoNothing()
    .run();

  try {
    const rows = input.sources.flatMap((source) => parseNseSecurityCsv(source.content, source.kind));
    const minimumRows = input.minimumRows ?? 1_000;
    if (rows.length < minimumRows) {
      throw new SecurityMasterError(
        "MALFORMED_SOURCE",
        `NSE security master returned ${rows.length} rows; minimum accepted is ${minimumRows}.`,
      );
    }

    const unique = new Map<string, NseSourceRow>();
    for (const row of rows) {
      if (unique.has(row.isin)) {
        throw new SecurityMasterError("DUPLICATE_SECURITY", `NSE security master repeats ISIN ${row.isin}.`);
      }
      unique.set(row.isin, row);
    }

    const latestSuccess = db
      .select()
      .from(schema.securityMasterSyncs)
      .where(eq(schema.securityMasterSyncs.status, "SUCCEEDED"))
      .all()
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0];
    const maxDropFraction = input.maxDropFraction ?? 0.2;
    if (latestSuccess && input.observedAt.getTime() <= latestSuccess.observedAt.getTime()) {
      throw new SecurityMasterError(
        "NON_MONOTONIC_OBSERVATION",
        `NSE observation ${input.observedAt.toISOString()} is not later than ` +
          `${latestSuccess.observedAt.toISOString()}.`,
      );
    }
    if (
      latestSuccess &&
      latestSuccess.totalRows > 0 &&
      rows.length < latestSuccess.totalRows * (1 - maxDropFraction)
    ) {
      throw new SecurityMasterError(
        "IMPLAUSIBLE_ROW_DROP",
        `NSE security master fell from ${latestSuccess.totalRows} to ${rows.length} rows.`,
      );
    }

    const mainRows = rows.filter((row) => row.source === "MAIN").length;
    const smeRows = rows.filter((row) => row.source === "SME").length;
    const etfRows = rows.filter((row) => row.source === "ETF").length;
    const reitRows = rows.filter((row) => row.source === "REIT").length;
    const invitRows = rows.filter((row) => row.source === "INVIT").length;
    const nameOwners = new Map<string, string>();
    const ambiguousNames = new Set<string>();
    for (const row of rows) {
      const name = row.name.toUpperCase();
      const owner = nameOwners.get(name);
      if (owner && owner !== row.isin) ambiguousNames.add(name);
      else nameOwners.set(name, row.isin);
    }

    db.transaction((tx) => {
      const current = tx
        .select()
        .from(schema.nseListingVersions)
        .where(isNull(schema.nseListingVersions.effectiveTo))
        .all();
      const currentByIsin = new Map(current.map((row) => [row.isin, row]));

      for (const row of rows) {
        tx.insert(schema.nseSecurities)
          .values({
            isin: row.isin,
            firstObservedAt: input.observedAt,
            lastObservedAt: input.observedAt,
          })
          .onConflictDoUpdate({
            target: schema.nseSecurities.isin,
            set: { lastObservedAt: input.observedAt },
          })
          .run();

        const existing = currentByIsin.get(row.isin);
        if (!existing) {
          tx.insert(schema.nseListingVersions).values(listingValues(row, syncId, input.observedAt)).run();
        } else if (!sameListing(existing, row)) {
          tx.update(schema.nseListingVersions)
            .set({ effectiveTo: input.observedAt })
            .where(eq(schema.nseListingVersions.id, existing.id))
            .run();
          tx.insert(schema.nseListingVersions).values(listingValues(row, syncId, input.observedAt)).run();
        }

        for (const [aliasType, alias] of [
          ["SYMBOL", row.symbol],
          ["NAME", row.name.toUpperCase()],
          ["PROVIDER_SYMBOL", `${row.symbol}.NS`],
        ] as const) {
          if (aliasType === "NAME" && ambiguousNames.has(alias)) continue;
          const recorded = tx
            .select()
            .from(schema.nseSecurityAliases)
            .where(
              and(
                eq(schema.nseSecurityAliases.isin, row.isin),
                eq(schema.nseSecurityAliases.exchange, "XNSE"),
                eq(schema.nseSecurityAliases.aliasType, aliasType),
                eq(schema.nseSecurityAliases.alias, alias),
              ),
            )
            .get();
          if (recorded) {
            tx.update(schema.nseSecurityAliases)
              .set({ lastObservedAt: input.observedAt, sourceSyncId: syncId })
              .where(eq(schema.nseSecurityAliases.id, recorded.id))
              .run();
          } else {
            tx.insert(schema.nseSecurityAliases)
              .values({
                isin: row.isin,
                exchange: "XNSE",
                aliasType,
                alias,
                firstObservedAt: input.observedAt,
                lastObservedAt: input.observedAt,
                sourceSyncId: syncId,
              })
              .onConflictDoNothing()
              .run();
          }
        }
      }

      const observedIsins = new Set(rows.map((row) => row.isin));
      for (const existing of current) {
        if (observedIsins.has(existing.isin) || existing.listingStatus === "INACTIVE") continue;
        tx.update(schema.nseListingVersions)
          .set({ effectiveTo: input.observedAt })
          .where(eq(schema.nseListingVersions.id, existing.id))
          .run();
        tx.insert(schema.nseListingVersions)
          .values({
            ...existing,
            id: undefined,
            listingStatus: "INACTIVE",
            effectiveFrom: input.observedAt,
            effectiveTo: null,
            sourceSyncId: syncId,
          })
          .run();
      }

      tx.update(schema.securityMasterSyncs)
        .set({
          status: "SUCCEEDED",
          completedAt: new Date(),
          mainRowCount: mainRows,
          smeRowCount: smeRows,
          totalRows: rows.length,
          errorCode: null,
          errorMessage: null,
        })
        .where(eq(schema.securityMasterSyncs.id, syncId))
        .run();
    });

    return { ok: true, syncId, totalRows: rows.length, mainRows, smeRows, etfRows, reitRows, invitRows };
  } catch (error) {
    const known = error instanceof SecurityMasterError
      ? error
      : new SecurityMasterError("MALFORMED_SOURCE", error instanceof Error ? error.message : String(error));
    db.update(schema.securityMasterSyncs)
      .set({
        status: "FAILED",
        completedAt: new Date(),
        errorCode: known.code,
        errorMessage: known.message,
      })
      .where(eq(schema.securityMasterSyncs.id, syncId))
      .run();
    return { ok: false, syncId, errorCode: known.code, message: known.message };
  }
}

export function recordNseSecurityMasterFailure(input: {
  observedAt: Date;
  actor: string;
  sourceUrls: readonly string[];
  message: string;
}): Extract<SecurityMasterSyncResult, { ok: false }> {
  const hash = createHash("sha256")
    .update(`${input.observedAt.toISOString()}|${input.sourceUrls.join("|")}|${input.message}`)
    .digest("hex")
    .slice(0, 12);
  const syncId = `nse_sync_${Math.floor(input.observedAt.getTime() / 1000)}_${hash}`;
  const completedAt = new Date();
  getDb()
    .insert(schema.securityMasterSyncs)
    .values({
      id: syncId,
      observedAt: input.observedAt,
      startedAt: completedAt,
      completedAt,
      status: "FAILED",
      sourceManifest: JSON.stringify(input.sourceUrls.map((url) => ({ url, fetched: false }))),
      errorCode: "SOURCE_FETCH_FAILED",
      errorMessage: input.message,
      actor: input.actor,
    })
    .onConflictDoNothing()
    .run();
  return { ok: false, syncId, errorCode: "SOURCE_FETCH_FAILED", message: input.message };
}

type ListingJoin = {
  listing: typeof schema.nseListingVersions.$inferSelect;
  security: typeof schema.nseSecurities.$inferSelect;
  mapping: typeof schema.nseProviderMappings.$inferSelect | null;
};

function joinedListings(): ListingJoin[] {
  const db = getDb();
  const mappings = db.select().from(schema.nseProviderMappings).all();
  const preferredMappings = new Map<string, typeof schema.nseProviderMappings.$inferSelect>();
  for (const mapping of mappings) {
    const current = preferredMappings.get(mapping.isin);
    if (!current || mapping.provider === "YAHOO") preferredMappings.set(mapping.isin, mapping);
  }
  return db
    .select({ listing: schema.nseListingVersions, security: schema.nseSecurities })
    .from(schema.nseListingVersions)
    .innerJoin(schema.nseSecurities, eq(schema.nseListingVersions.isin, schema.nseSecurities.isin))
    .all()
    .map((row) => ({ ...row, mapping: preferredMappings.get(row.security.isin) ?? null }));
}

function asInstrument(row: ListingJoin): SecurityMasterInstrument {
  const assetType = row.listing.assetType as NseAssetType;
  return {
    id: `IN:XNSE:${row.listing.symbol}`,
    market: "IN",
    exchange: "XNSE",
    symbol: row.listing.symbol,
    providerSymbol: row.mapping?.providerSymbol ?? `${row.listing.symbol}.NS`,
    name: row.listing.name,
    currency: "INR",
    timezone: "Asia/Kolkata",
    assetType,
    securityId: row.security.isin,
    isin: row.security.isin,
    series: row.listing.series,
    listingStatus: row.listing.listingStatus as ListingStatus,
    dataAvailability: (row.mapping?.availability as DataAvailability | undefined) ?? "UNKNOWN",
    effectiveFrom: row.listing.effectiveFrom.toISOString(),
    effectiveTo: row.listing.effectiveTo?.toISOString() ?? null,
  };
}

function sorted(rows: ListingJoin[]): SecurityMasterInstrument[] {
  return rows
    .map(asInstrument)
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.series.localeCompare(b.series) || a.isin.localeCompare(b.isin));
}

function matchesInstrumentSearch(instrument: SecurityMasterInstrument, query: string): boolean {
  if (!query) return true;
  const values = [
    instrument.id,
    instrument.symbol,
    instrument.name.toUpperCase(),
    instrument.isin,
    instrument.providerSymbol,
  ];
  if (values.some((value) => value.includes(query))) return true;

  const compactQuery = query.replace(/[^A-Z0-9]/g, "");
  if (compactQuery && values.some((value) => value.replace(/[^A-Z0-9]/g, "").includes(compactQuery))) {
    return true;
  }

  const queryTokens = query.split(/[^A-Z0-9]+/).filter(Boolean);
  const candidateTokens = values.flatMap((value) => value.split(/[^A-Z0-9]+/).filter(Boolean));
  return queryTokens.length > 1 && queryTokens.every(
    (token) => candidateTokens.some((candidate) => candidate.startsWith(token)),
  );
}

export function searchCurrentNseInstruments(
  query: string,
  options: { series?: string; limit?: number; offset?: number } = {},
): NseInstrumentSearch {
  const normalized = query.trim().toUpperCase().slice(0, 80);
  const series = options.series?.trim().toUpperCase();
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  const offset = Math.max(0, options.offset ?? 0);
  const current = sorted(
    joinedListings().filter(
      (row) => row.listing.effectiveTo === null && row.listing.listingStatus === "LISTED",
    ),
  ).filter(
    (instrument) =>
      (!series || instrument.series === series) &&
      matchesInstrumentSearch(instrument, normalized),
  );
  return { items: current.slice(offset, offset + limit), total: current.length, limit, offset };
}

export function listCurrentNseInstruments(): SecurityMasterInstrument[] {
  return sorted(
    joinedListings().filter(
      (row) => row.listing.effectiveTo === null && row.listing.listingStatus === "LISTED",
    ),
  );
}

export function listNseInstrumentsAsOf(asOf: Date): SecurityMasterInstrument[] {
  if (!Number.isFinite(asOf.getTime())) {
    throw new SecurityMasterError("NOT_YET_OBSERVED", "A valid as-of date is required.");
  }
  const successes = getDb()
    .select()
    .from(schema.securityMasterSyncs)
    .where(eq(schema.securityMasterSyncs.status, "SUCCEEDED"))
    .all();
  if (successes.length === 0) {
    throw new SecurityMasterError("MASTER_UNAVAILABLE", "No verified NSE security master has been ingested.");
  }
  const earliest = Math.min(...successes.map((row) => row.observedAt.getTime()));
  if (asOf.getTime() < earliest) {
    throw new SecurityMasterError(
      "NOT_YET_OBSERVED",
      `The NSE security archive begins ${new Date(earliest).toISOString()}, after ${asOf.toISOString()}.`,
    );
  }

  return sorted(
    joinedListings().filter(
      (row) =>
        row.listing.effectiveFrom.getTime() <= asOf.getTime() &&
        (row.listing.effectiveTo === null || row.listing.effectiveTo.getTime() > asOf.getTime()) &&
        row.listing.listingStatus === "LISTED",
    ),
  );
}

export function findNseInstrument(identity: string): SecurityMasterInstrument | null {
  const normalized = identity.trim().toUpperCase();
  const current = listCurrentNseInstruments();
  const direct = current.find(
    (instrument) =>
      instrument.id === normalized ||
      instrument.symbol === normalized ||
      instrument.providerSymbol === normalized ||
      instrument.isin === normalized,
  );
  if (direct) return direct;

  const aliases = getDb()
    .select()
    .from(schema.nseSecurityAliases)
    .where(eq(schema.nseSecurityAliases.alias, normalized.replace(/^IN:XNSE:/, "")))
    .all()
    .filter((alias) => alias.aliasType !== "NAME")
    .sort((a, b) => b.lastObservedAt.getTime() - a.lastObservedAt.getTime());
  for (const alias of aliases) {
    const instrument = current.find((candidate) => candidate.isin === alias.isin);
    if (instrument) return instrument;
  }
  return null;
}

export function setNseProviderMapping(input: {
  provider: string;
  isin: string;
  providerInstrumentId?: string | null;
  providerSymbol?: string | null;
  availability: DataAvailability;
  verifiedAt?: Date | null;
  source?: string | null;
}): void {
  const db = getDb();
  const provider = input.provider.trim().toUpperCase();
  const isin = input.isin.trim().toUpperCase();
  const security = db.select().from(schema.nseSecurities).where(eq(schema.nseSecurities.isin, isin)).get();
  if (!security) {
    throw new SecurityMasterError("MASTER_UNAVAILABLE", `Cannot map unknown NSE ISIN ${isin}.`);
  }
  const existing = db
    .select()
    .from(schema.nseProviderMappings)
    .where(
      and(
        eq(schema.nseProviderMappings.provider, provider),
        eq(schema.nseProviderMappings.isin, isin),
      ),
    )
    .get();
  const values = {
    providerInstrumentId: input.providerInstrumentId ?? null,
    providerSymbol: input.providerSymbol?.trim().toUpperCase() ?? null,
    availability: input.availability,
    verifiedAt: input.verifiedAt ?? null,
    source: input.source ?? null,
  };
  if (existing) {
    db.update(schema.nseProviderMappings)
      .set(values)
      .where(
        and(
          eq(schema.nseProviderMappings.provider, provider),
          eq(schema.nseProviderMappings.isin, isin),
        ),
      )
      .run();
  } else {
    db.insert(schema.nseProviderMappings).values({ provider, isin, ...values }).run();
  }
}

export function securityMasterStatus(now = new Date()) {
  const attempts = getDb()
    .select()
    .from(schema.securityMasterSyncs)
    .all()
    .sort(
      (a, b) =>
        b.observedAt.getTime() - a.observedAt.getTime() || b.startedAt.getTime() - a.startedAt.getTime(),
    );
  const lastAttempt = attempts[0];
  const current = attempts.find((attempt) => attempt.status === "SUCCEEDED");
  if (!current) {
    return {
      state: "UNAVAILABLE" as const,
      currentSyncId: null,
      lastAttemptId: lastAttempt?.id ?? null,
      observedAt: null,
      totalRows: 0,
      sourceKinds: [] as NseSourceKind[],
      missingSourceKinds: [...REQUIRED_NSE_SOURCE_KINDS],
    };
  }
  let sourceKinds: NseSourceKind[] = [];
  try {
    const manifest = JSON.parse(current.sourceManifest) as Array<{ kind?: string }>;
    sourceKinds = REQUIRED_NSE_SOURCE_KINDS.filter((kind) =>
      manifest.some((source) => source.kind === kind),
    );
  } catch {
    sourceKinds = [];
  }
  const missingSourceKinds = REQUIRED_NSE_SOURCE_KINDS.filter((kind) => !sourceKinds.includes(kind));
  const stale = now.getTime() - current.observedAt.getTime() > 36 * 60 * 60 * 1_000;
  const state = lastAttempt?.status === "FAILED" && lastAttempt.id !== current.id
    ? "FAILED_LAST_ATTEMPT"
    : stale
      ? "STALE"
      : missingSourceKinds.length > 0
        ? "INCOMPLETE"
      : "CURRENT";
  return {
    state,
    currentSyncId: current.id,
    lastAttemptId: lastAttempt?.id ?? current.id,
    observedAt: current.observedAt.toISOString(),
    totalRows: current.totalRows,
    sourceKinds,
    missingSourceKinds,
  };
}
