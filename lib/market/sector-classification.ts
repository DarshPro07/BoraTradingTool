import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import SECTOR_MAP from "./data/nse-sector-map.json";

/**
 * NSE sector classification — ingested, identity-verified, effective-dated.
 *
 * ## Why this exists
 *
 * The pre-registered trial-activation gate requires that a family's ready set spans several
 * sectors, so that no single sector's regime can carry a result. That criterion sat at
 * UNMEASURABLE because this deployment held no industry map at all: the security-master CSVs
 * carry series, ISIN and face value, but nothing about what a company does.
 *
 * ## Where the data comes from, and what it actually is
 *
 * NSE publishes index constituent files that carry an `Industry` column beside the ISIN — probed
 * from this machine on 2026-08-16 (see `docs/external/nse-sector-classification.md`).
 *
 * **The column's NAME is misleading, and the distinction is kept explicitly.** Its values are not
 * NSE's *Industry* level (of which there are 59). An earlier revision of this module asserted
 * they were the *Sector* level from cardinality alone — 22 values, 22 official sectors — which
 * was an inference dressed as a fact. It has since been VERIFIED: NSE Indices' published
 * "Industry Classification Structure" (March 2022) was fetched and parsed, and its 22 sector
 * codes and labels match the 22 distinct source values BIJECTIVELY — 22/22, nothing unmatched in
 * either direction. `lib/market/data/nse-sector-map.json` is that proof, checked in.
 *
 * So each row stores BOTH: the raw label exactly as the file gave it (with the field name it came
 * from), and the normalized sector plus its official NSE sector code, with `normalizationBasis`
 * recording which is which. A label that ever fails to map is stored RAW with the normalized
 * levels NULL rather than being forced into the taxonomy. Industry and Basic Industry are absent
 * from this source and stay NULL.
 *
 * Coverage is partial and honestly so: the union of the probed index lists classified 745 of the
 * 2,122 main-board equities (35.1%). Index membership is the investable universe, which is also
 * where family-ready instruments concentrate — but an unclassified instrument contributes no
 * sector to any count, and is never assigned one by guesswork.
 *
 * ## Identity
 *
 * Matched by **ISIN** against the security master — the strongest key available — and the symbol
 * is compared as a second signal. A row whose ISIN is unknown to the master is NEVER written: a
 * classification attached to an instrument this system cannot canonically identify is worse than
 * no classification. Company NAME is never used for matching, and sector is never inferred from
 * a name.
 *
 * ## Effective-dating
 *
 * NSE reviews classifications annually and reclassifies after mergers and demergers, so a new
 * observation closes the previous row's window rather than overwriting it. What an experiment was
 * judged under stays recoverable.
 */

export const NSE_SECTOR_SOURCES = [
  {
    id: "nifty-total-market",
    url: "https://nsearchives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv",
    note: "NIFTY Total Market constituents — the broadest single list probed (750 rows)",
  },
  {
    id: "nifty-microcap-250",
    url: "https://nsearchives.nseindia.com/content/indices/ind_niftymicrocap250_list.csv",
    note: "NIFTY Microcap 250 — extends coverage below the total-market cut",
  },
  {
    id: "nifty-500",
    url: "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv",
    note: "NIFTY 500 — overlaps the above; kept for redundancy if one file changes shape",
  },
] as const;

export type IdentityVerification = "ISIN_AND_SYMBOL_MATCHED" | "ISIN_MATCHED_SYMBOL_DIFFERS";

/** The column these files carry. Named "Industry"; its values are the SECTOR level (verified). */
export const RAW_FIELD = "Industry";

/**
 * Map a raw source label onto NSE's official taxonomy, or refuse.
 *
 * The map is a checked-in artifact derived from NSE Indices' published classification structure
 * (March 2022) and verified bijective against the source's 22 labels. A label absent from it
 * returns null and is stored raw with normalized levels NULL — the source may add a sector one
 * day, and inventing a mapping for it would be exactly the inference this function replaces.
 */
export function normalizeSectorLabel(rawLabel: string): { sectorCode: string; sector: string } | null {
  const entry = (SECTOR_MAP as Record<string, { sectorCode: string; sector: string }>)[rawLabel.trim()];
  return entry ?? null;
}

export interface SectorIngestReport {
  ok: boolean;
  code: "INGESTED" | "TABLE_NOT_REGISTERED" | "SOURCE_UNAVAILABLE" | "NO_ROWS";
  message: string;
  fetched: number;
  matched: number;
  symbolMismatches: number;
  unmatched: number;
  inserted: number;
  unchanged: number;
  superseded: number;
  sectors: number;
  /** Labels the published taxonomy did not contain — stored raw, never forced into it. */
  unmapped: number;
}

export function sectorClassificationReady(): boolean {
  try {
    getDb().select().from(schema.sectorClassifications).limit(1).all();
    return true;
  } catch {
    return false;
  }
}

/** Minimal CSV row parser — these files are simple, but names contain commas inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const split = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = !quoted;
      } else if (character === "," && !quoted) {
        cells.push(cell);
        cell = "";
      } else cell += character;
    }
    cells.push(cell);
    return cells.map((value) => value.trim().replace(/^﻿/, ""));
  };
  const header = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ""]));
  });
}

export type SectorFetcher = (url: string) => Promise<string>;

const defaultFetcher: SectorFetcher = async (url) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
};

/**
 * Fetch, verify and persist. Idempotent: an unchanged classification is left exactly as it is,
 * so re-running does not churn effective windows.
 */
export async function ingestNseSectors(
  options: { fetcher?: SectorFetcher; now?: Date; actor?: string } = {},
): Promise<SectorIngestReport> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const now = options.now ?? new Date();
  const effectiveDate = now.toISOString().slice(0, 10);
  const empty = { fetched: 0, matched: 0, symbolMismatches: 0, unmatched: 0, inserted: 0, unchanged: 0, superseded: 0, sectors: 0, unmapped: 0 };

  if (!sectorClassificationReady()) {
    return {
      ok: false,
      code: "TABLE_NOT_REGISTERED",
      message:
        "sector_classifications does not exist: migration 0024 is staged but not registered. " +
        "See docs/plans/nse-qc-001/pending-migration/README.md — two owner-side steps.",
      ...empty,
    };
  }

  const db = getDb();
  // The canonical identity set: ISIN → the master's current symbol.
  const master = new Map(
    db
      .select()
      .from(schema.nseListingVersions)
      .where(isNull(schema.nseListingVersions.effectiveTo))
      .all()
      .map((listing) => [listing.isin, listing.symbol]),
  );

  // Last source wins per ISIN, but every source is fetched so a single file changing shape
  // degrades coverage rather than the whole ingest.
  const observed = new Map<string, { rawLabel: string; symbol: string; sourceId: string; url: string }>();
  let fetched = 0;
  const failures: string[] = [];
  for (const source of NSE_SECTOR_SOURCES) {
    let text: string;
    try {
      text = await fetcher(source.url);
    } catch (caught) {
      failures.push(`${source.id}: ${caught instanceof Error ? caught.message : String(caught)}`);
      continue;
    }
    for (const row of parseCsv(text)) {
      const isin = (row["ISIN Code"] ?? "").trim();
      const rawLabel = (row[RAW_FIELD] ?? "").trim();
      const symbol = (row["Symbol"] ?? "").trim();
      if (!isin || !rawLabel) continue;
      fetched += 1;
      if (!observed.has(isin)) observed.set(isin, { rawLabel, symbol, sourceId: source.id, url: source.url });
    }
  }

  if (observed.size === 0) {
    return {
      ok: false,
      code: failures.length > 0 ? "SOURCE_UNAVAILABLE" : "NO_ROWS",
      message:
        failures.length > 0
          ? `No source could supply sector classification: ${failures.join("; ")}. Nothing was written.`
          : "The sources returned no rows carrying both an ISIN and an Industry. Nothing was written.",
      ...empty,
      fetched,
    };
  }

  const current = db
    .select()
    .from(schema.sectorClassifications)
    .where(isNull(schema.sectorClassifications.effectiveTo))
    .all();
  const currentByIsin = new Map(current.map((row) => [row.isin, row]));

  const report: SectorIngestReport = {
    ok: true,
    code: "INGESTED",
    message: "",
    ...empty,
    fetched,
  };

  for (const [isin, entry] of observed) {
    const masterSymbol = master.get(isin);
    if (masterSymbol === undefined) {
      // Not in this deployment's canonical master — never written. A classification attached to
      // an instrument the system cannot identify is worse than none.
      report.unmatched += 1;
      continue;
    }
    report.matched += 1;
    const verification: IdentityVerification =
      masterSymbol.toUpperCase() === entry.symbol.toUpperCase()
        ? "ISIN_AND_SYMBOL_MATCHED"
        : "ISIN_MATCHED_SYMBOL_DIFFERS";
    if (verification === "ISIN_MATCHED_SYMBOL_DIFFERS") report.symbolMismatches += 1;

    const mapped = normalizeSectorLabel(entry.rawLabel);
    const existing = currentByIsin.get(isin);
    // Compare on the RAW label: that is what the source actually said, so a change in it is a real
    // reclassification, while a change in our INTERPRETATION is a code change with its own review.
    // Confusing the two would let a mapping edit masquerade as an exchange event.
    if (existing && existing.rawLabel === entry.rawLabel) {
      report.unchanged += 1;
      continue;
    }
    if (existing) {
      // Supersede rather than overwrite: what an earlier experiment was judged under survives.
      db.update(schema.sectorClassifications)
        .set({ effectiveTo: now })
        .where(and(eq(schema.sectorClassifications.id, existing.id), isNull(schema.sectorClassifications.effectiveTo)))
        .run();
      report.superseded += 1;
    }
    db.insert(schema.sectorClassifications)
      .values({
        isin,
        instrumentId: `IN:XNSE:${masterSymbol}`,
        symbol: masterSymbol,
        // What the file literally said, beside what it was verified to mean.
        rawLabel: entry.rawLabel,
        rawField: RAW_FIELD,
        macroSector: null,
        sectorCode: mapped?.sectorCode ?? null,
        normalizedSector: mapped?.sector ?? null,
        normalizationBasis: mapped ? "PROVEN_AGAINST_NSE_STRUCTURE" : "UNMAPPED",
        // Absent from this source; never inferred from the sector above.
        industry: null,
        basicIndustry: null,
        source: `NSE_INDEX_CONSTITUENTS:${entry.sourceId}`,
        sourceUrl: entry.url,
        sourceEffectiveDate: effectiveDate,
        fetchedAt: now,
        identityVerification: verification,
        effectiveFrom: now,
        effectiveTo: null,
      })
      .run();
    report.inserted += 1;
  }

  report.sectors = new Set(
    [...observed.values()]
      .map((entry) => normalizeSectorLabel(entry.rawLabel)?.sector)
      .filter((sector): sector is string => sector !== undefined),
  ).size;
  report.unmapped = [...observed.values()].filter(
    (entry) => normalizeSectorLabel(entry.rawLabel) === null,
  ).length;
  report.message =
    `${report.matched} of ${observed.size} classified ISIN(s) matched the security master ` +
    `(${report.inserted} written, ${report.unchanged} unchanged, ${report.superseded} superseded, ` +
    `${report.unmatched} not in the master, ${report.symbolMismatches} symbol mismatch(es)); ` +
    `${report.sectors} distinct sector(s)` +
    (failures.length > 0 ? `. Some sources failed: ${failures.join("; ")}` : ".");
  return report;
}

/** Current sector per instrument. Null when the table is absent — never an empty-map "no sectors". */
export function currentSectorByInstrument(): Map<string, string> | null {
  if (!sectorClassificationReady()) return null;
  const rows = getDb()
    .select()
    .from(schema.sectorClassifications)
    .where(isNull(schema.sectorClassifications.effectiveTo))
    .all();
  if (rows.length === 0) return null;
  const byInstrument = new Map<string, string>();
  for (const row of rows) {
    // Only VERIFIED sectors count as sector knowledge. A raw label that could not be placed in the
    // official taxonomy is data, but it is not a sector for representativeness purposes.
    if (row.normalizedSector) byInstrument.set(row.instrumentId, row.normalizedSector);
  }
  return byInstrument.size > 0 ? byInstrument : null;
}
