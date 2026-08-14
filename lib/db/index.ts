import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { backupDefaultDatabase, migrateDatabase } from "./migrate";

let database: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqliteConnection: Database.Database | null = null;

export function databasePath(): string {
  const configured = process.env.MARKETPULSE_DB_PATH?.trim();
  const resolved = path.resolve(/* turbopackIgnore: true */ process.cwd(), configured || "marketpulse.db");
  const defaultPath = path.resolve(process.cwd(), "marketpulse.db");
  // `VITEST` is set by the runner itself, so this cannot be forgotten. `MARKETPULSE_TEST_MODE`
  // alone could be, and was: nothing set it, so the guard never fired and `run-log.test.ts` wrote
  // fixture cycles named "older" and "newer" straight into the owner's database, where they
  // surfaced in the live terminal beside real runs.
  //
  // That damage is permanent. `audit_events` carries a BEFORE DELETE trigger — the log is
  // append-only, so a test write into it can never be taken back, only hidden at read time. A
  // guard that fails loudly at the first `getDb()` is the only place this is actually fixable.
  const isTestProcess = process.env.MARKETPULSE_TEST_MODE === "1" || process.env.VITEST !== undefined;
  if (isTestProcess && resolved === defaultPath) {
    throw new Error(
      "A test process tried to open the production database. Point MARKETPULSE_DB_PATH at an isolated database " +
        "file — call useTemporaryDatabase() from lib/db/testing.ts at the top of the test file.",
    );
  }
  return resolved;
}

export function openDatabase(filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const sourceExisted = existsSync(filePath);
  const sqlite = new Database(filePath);
  backupDefaultDatabase(sqlite, filePath, sourceExisted);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  migrateDatabase(sqlite);
  seedDefaults(sqlite);
  return { db: drizzle(sqlite, { schema }), sqlite };
}

export function getDb() {
  if (!database) {
    const opened = openDatabase(databasePath());
    database = opened.db;
    sqliteConnection = opened.sqlite;
  }
  return database;
}

export function closeDatabase(): void {
  sqliteConnection?.close();
  sqliteConnection = null;
  database = null;
}

/**
 * Historical name, kept because the test suite calls it in many places.
 *
 * It is no longer test-only: `scripts/cycle-entry.ts` closes the handle so a scheduled process
 * does not leave a `-wal` and `-shm` pair behind every fifteen minutes. A production script
 * calling something named `forTests` reads as a mistake, so that path uses `closeDatabase`.
 */
export const closeDbForTests = closeDatabase;

const DEFAULT_STRATEGY_PROMPT = `You are a medium-risk research analyst evaluating cash equities.

Goals:
- Protect capital and prefer liquid, high-quality names.
- Require technical evidence plus fundamentals or a catalyst before proposing a paper order.
- Treat missing, stale, or conflicting evidence as a reason to abstain.
- Keep every paper position within the configured maximum allocation.
- State invalidation conditions and downside risks clearly.

This strategy is decision support. It cannot authorize or place a broker order.`;

function seedDefaults(sqlite: Database.Database): void {
  const now = Math.floor(Date.now() / 1000);
  seedTestSecurityMaster(sqlite, now);
  const count = sqlite.prepare("SELECT COUNT(*) AS count FROM strategies").get() as { count: number };
  if (count.count === 0) {
    const result = sqlite
      .prepare(
        `INSERT INTO strategies
          (name, prompt, risk_profile, max_position_pct, is_default, created_at)
         VALUES (?, ?, 'medium', 15, 1, ?)`,
      )
      .run("Default - Medium Risk", DEFAULT_STRATEGY_PROMPT, now);
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO agent_config
          (id, mode, broker, halt, updated_at, active_strategy_id)
         VALUES (1, 'off', 'real', 1, ?, ?)`,
      )
      .run(now, result.lastInsertRowid);
  }
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO agent_config
        (id, mode, broker, halt, updated_at)
       VALUES (1, 'off', 'real', 1, ?)`,
    )
    .run(now);
}

function seedTestSecurityMaster(sqlite: Database.Database, now: number): void {
  if (process.env.MARKETPULSE_TEST_MODE !== "1") return;
  const existing = sqlite.prepare("SELECT COUNT(*) AS count FROM security_master_syncs").get() as { count: number };
  if (existing.count > 0) return;

  const successId = `nse_test_success_${now}`;
  const failedId = `nse_test_failed_${now}`;
  const observedAt = now - 3_600;

  /**
   * The 30-security ACCEPTANCE UNIVERSE (e2e/nse-30-stock-matrix + -stage2), plus two synthetic
   * series/availability rows. The first three ISINs are the real ones this fixture always carried;
   * the rest are SYNTHETIC fixture identities (deterministic INE9nnT01xxx range, same convention as
   * SMALLSME below) — this whole master is TEST_MODE-gated, seeded only into an EMPTY database, and
   * every row carries TEST_FIXTURE/playwright-fixture provenance, so nothing here can masquerade as
   * exchange truth. Without the full universe, Stage-2 breadth ingestion capped out at 3 of 30
   * (INSTRUMENT_UNKNOWN for the rest), which turned the acceptance matrix into a refusal sweep.
   */
  const acceptanceSymbols = [
    ["HDFCBANK", "HDFC Bank Limited"], ["INFY", "Infosys Limited"],
    ["ICICIBANK", "ICICI Bank Limited"], ["HINDUNILVR", "Hindustan Unilever Limited"],
    ["SBIN", "State Bank of India"], ["BHARTIARTL", "Bharti Airtel Limited"],
    ["ITC", "ITC Limited"], ["LT", "Larsen & Toubro Limited"],
    ["TATAMOTORS", "Tata Motors Limited"], ["SUNPHARMA", "Sun Pharmaceutical Industries Limited"],
    ["TATASTEEL", "Tata Steel Limited"], ["WIPRO", "Wipro Limited"],
    ["ASIANPAINT", "Asian Paints Limited"], ["MARUTI", "Maruti Suzuki India Limited"],
    ["TITAN", "Titan Company Limited"], ["BAJFINANCE", "Bajaj Finance Limited"],
    ["HCLTECH", "HCL Technologies Limited"], ["POWERGRID", "Power Grid Corporation of India Limited"],
    ["JYOTHYLAB", "Jyothy Labs Limited"], ["CHAMBLFERT", "Chambal Fertilisers and Chemicals Limited"],
    ["GAIL", "GAIL (India) Limited"], ["SIEMENS", "Siemens Limited"],
    ["AMBUJACEM", "Ambuja Cements Limited"], ["BERGEPAINT", "Berger Paints India Limited"],
    ["DABUR", "Dabur India Limited"], ["COLPAL", "Colgate Palmolive (India) Limited"],
    ["MCDOWELL-N", "United Spirits Limited"],
  ] as const;
  const listings = [
    ["INE002A01018", "RELIANCE", "Reliance Industries Limited", "EQ", "AVAILABLE"],
    ["INE467B01029", "TCS", "Tata Consultancy Services Limited", "EQ", "AVAILABLE"],
    ["INE495P01020", "BECTORFOOD", "Mrs. Bectors Food Specialities Limited", "EQ", "AVAILABLE"],
    ...acceptanceSymbols.map(([symbol, name], index): readonly [string, string, string, string, string] => [
      `INE9${String(index + 100)}T01018`, symbol, `${name} (fixture identity)`, "EQ", "AVAILABLE",
    ]),
    ["INE040A01034", "BANKBE", "Bank Surveillance Fixture Limited", "BE", "AVAILABLE"],
    ["INE999Z01012", "SMALLSME", "Small SME Fixture Limited", "SM", "UNAVAILABLE"],
  ] as const;

  // Row counts are COMPUTED from the fixture, so extending the universe cannot desynchronize the
  // sync record from the rows it claims to describe. SM-series rows are the SME count.
  const smeRows = listings.filter(([, , , series]) => series === "SM").length;
  sqlite
    .prepare(`
      INSERT INTO security_master_syncs
        (id, observed_at, started_at, completed_at, status, source_manifest,
         main_row_count, sme_row_count, total_rows, actor)
      VALUES (?, ?, ?, ?, 'SUCCEEDED', ?, ?, ?, ?, 'playwright-fixture')
    `)
    .run(
      successId, observedAt, observedAt, observedAt,
      JSON.stringify([{ kind: "TEST_FIXTURE" }]),
      listings.length - smeRows, smeRows, listings.length,
    );

  const insertSecurity = sqlite.prepare(
    "INSERT INTO nse_securities (isin, first_observed_at, last_observed_at) VALUES (?, ?, ?)",
  );
  const insertListing = sqlite.prepare(`
    INSERT INTO nse_listing_versions
      (isin, exchange, symbol, name, series, asset_type, listing_status, date_of_listing,
       paid_up_value, market_lot, face_value, effective_from, source_sync_id)
    VALUES (?, 'XNSE', ?, ?, ?, 'EQUITY', 'LISTED', '2020-01-01', 10, 1, 10, ?, ?)
  `);
  const insertMapping = sqlite.prepare(`
    INSERT INTO nse_provider_mappings
      (provider, isin, provider_symbol, availability, verified_at, source)
    VALUES ('TEST_FIXTURE', ?, ?, ?, ?, 'playwright fixture')
  `);
  for (const [isin, symbol, name, series, availability] of listings) {
    insertSecurity.run(isin, observedAt, observedAt);
    insertListing.run(isin, symbol, name, series, observedAt, successId);
    insertMapping.run(isin, `${symbol}.NS`, availability, observedAt);
  }

  sqlite
    .prepare(`
      INSERT INTO security_master_syncs
        (id, observed_at, started_at, completed_at, status, source_manifest,
         total_rows, error_code, error_message, actor)
      VALUES (?, ?, ?, ?, 'FAILED', ?, 0, 'MALFORMED_SOURCE',
              'Fixture failed attempt; last-good master retained.', 'playwright-fixture')
    `)
    .run(failedId, now, now, now, JSON.stringify([{ kind: "TEST_FIXTURE_FAILURE" }]));
}

export { schema };
