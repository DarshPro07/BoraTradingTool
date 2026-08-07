import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "./migrate";
import { databasePath } from "./index";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabase(): Database.Database {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-migration-"));
  temporaryDirectories.push(directory);
  return new Database(path.join(directory, "test.db"));
}

function tableNames(sqlite: Database.Database): string[] {
  return sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => (row as { name: string }).name);
}

describe("migrateDatabase", () => {
  it("refuses fixture mode against the owner's default database", () => {
    vi.stubEnv("MARKETPULSE_TEST_MODE", "1");
    vi.stubEnv("MARKETPULSE_DB_PATH", "");
    expect(() => databasePath()).toThrow(/isolated database/i);

    const isolated = path.join(os.tmpdir(), "marketpulse-fixture-only.db");
    vi.stubEnv("MARKETPULSE_DB_PATH", isolated);
    expect(databasePath()).toBe(path.resolve(isolated));
  });

  it("creates the complete fresh schema and can run twice", () => {
    const sqlite = temporaryDatabase();
    migrateDatabase(sqlite);
    migrateDatabase(sqlite);

    expect(tableNames(sqlite)).toEqual(
      expect.arrayContaining([
        "instruments",
        "paper_accounts",
        "paper_orders",
        "paper_positions",
        "paper_ledger",
        "ai_runs",
        "knowledge_sources",
        "knowledge_claims",
        "research_hypotheses",
        "strategy_specs",
        "trials",
        "forward_outcomes",
        "evolution_proposals",
        "audit_events",
        "learning_state",
      ]),
    );
    // Every .sql file in drizzle/ must be registered and applied. Asserting against the
    // directory rather than a literal keeps this honest as migrations are added.
    const migrationFiles = fs
      .readdirSync(path.join(process.cwd(), "drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const versions = sqlite
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => (row as { version: string }).version);
    expect(versions).toEqual(migrationFiles);
    expect(sqlite.prepare("SELECT currency, cash FROM paper_accounts ORDER BY currency").all()).toEqual([
      { currency: "INR", cash: 10_000_000 },
      { currency: "USD", cash: 100_000 },
    ]);
    sqlite.close();
  });

  it("quarantines a legacy paper_positions table and creates the canonical schema", () => {
    const sqlite = temporaryDatabase();
    sqlite.exec(`
      CREATE TABLE paper_account (id INTEGER PRIMARY KEY, cash REAL NOT NULL);
      CREATE TABLE paper_positions (ticker TEXT PRIMARY KEY, quantity REAL NOT NULL);
      INSERT INTO paper_account (id, cash) VALUES (1, 1234.56);
      INSERT INTO paper_positions (ticker, quantity) VALUES ('AAPL', 2);
    `);

    migrateDatabase(sqlite);

    expect(sqlite.prepare("SELECT cash FROM paper_account WHERE id = 1").get()).toEqual({ cash: 1234.56 });
    expect(sqlite.prepare("SELECT quantity FROM legacy_paper_positions WHERE ticker = 'AAPL'").get()).toEqual({ quantity: 2 });
    const columns = sqlite.prepare("PRAGMA table_info(paper_positions)").all().map((row) => (row as { name: string }).name);
    expect(columns).toEqual(expect.arrayContaining(["instrument_id", "average_cost", "realized_pnl", "updated_at"]));
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM paper_positions").get()).toEqual({ count: 0 });
    sqlite.close();
  });

  it("adds missing compatibility columns to an older agent_config", () => {
    const sqlite = temporaryDatabase();
    sqlite.exec(`
      CREATE TABLE agent_config (
        id INTEGER PRIMARY KEY, mode TEXT NOT NULL, broker TEXT NOT NULL, halt INTEGER NOT NULL,
        poll_minutes INTEGER NOT NULL, max_position_pct REAL NOT NULL, watchlist_only INTEGER NOT NULL,
        daily_trade_cap INTEGER NOT NULL, active_strategy_id INTEGER, telegram_bot_token TEXT,
        telegram_chat_id TEXT, telegram_last_offset INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
    `);
    migrateDatabase(sqlite);
    const columns = sqlite.prepare("PRAGMA table_info(agent_config)").all().map((row) => (row as { name: string }).name);
    expect(columns).toEqual(expect.arrayContaining(["robinhood_connected_at", "robinhood_account"]));
    sqlite.close();
  });

  it("uses a collision-safe name when a legacy quarantine table already exists", () => {
    const sqlite = temporaryDatabase();
    sqlite.exec(`
      CREATE TABLE paper_positions (ticker TEXT PRIMARY KEY, quantity REAL NOT NULL);
      CREATE TABLE legacy_paper_positions (ticker TEXT PRIMARY KEY, quantity REAL NOT NULL);
      INSERT INTO paper_positions VALUES ('AAPL', 2);
      INSERT INTO legacy_paper_positions VALUES ('MSFT', 3);
    `);
    migrateDatabase(sqlite);
    expect(sqlite.prepare("SELECT quantity FROM legacy_paper_positions_2 WHERE ticker = 'AAPL'").get()).toEqual({ quantity: 2 });
    const columns = sqlite.prepare("PRAGMA table_info(paper_positions)").all().map((row) => (row as { name: string }).name);
    expect(columns).toContain("instrument_id");
    sqlite.close();
  });

  it("backfills lifecycle state when upgrading a populated 0003 database", () => {
    const sqlite = temporaryDatabase();
    sqlite.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations(version, applied_at) VALUES
        ('0000_existing_baseline.sql', 0), ('0001_multi_market_paper_ai.sql', 0),
        ('0002_knowledge_memory.sql', 0), ('0003_research_jobs.sql', 0);
      CREATE TABLE knowledge_sources (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, content_hash TEXT NOT NULL,
        status TEXT NOT NULL, rejection_reason TEXT, ingested_at INTEGER NOT NULL
      );
      CREATE TABLE ai_runs (id INTEGER PRIMARY KEY);
      CREATE TABLE paper_orders (id INTEGER PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT INTO knowledge_sources(id, kind, title, content_hash, status, ingested_at)
        VALUES ('src_legacy', 'web', 'Legacy', 'abc', 'archived', 100);
      INSERT INTO paper_orders(id, status, created_at) VALUES (1, 'OPEN', 1000);
    `);
    migrateDatabase(sqlite);
    expect(sqlite.prepare("SELECT status, rejection_reason FROM knowledge_sources").get()).toEqual({
      status: "discovered",
      rejection_reason: "Legacy metadata-only source; re-ingest content before citation.",
    });
    expect(sqlite.prepare("SELECT expires_at FROM paper_orders WHERE id = 1").get()).toEqual({ expires_at: 87_400 });
    sqlite.close();
  });

  it("backfills server-issued evidence and retires stored Telegram credentials", () => {
    const sqlite = temporaryDatabase();
    const generatedAt = "2026-08-06T12:00:00.000Z";
    const items = [{ id: "quote", label: "Quote", value: { price: 100 }, quality: "LIVE", sourceId: "fixture" }];
    const snapshotHash = createHash("sha256")
      .update(JSON.stringify({ instrument: "US:XNAS:AAPL", generatedAt, items }))
      .digest("hex");
    const evidence = JSON.stringify({
      instrument: {
        id: "US:XNAS:AAPL", market: "US", exchange: "XNAS", symbol: "AAPL", providerSymbol: "AAPL",
        name: "Apple", currency: "USD", timezone: "America/New_York", assetType: "EQUITY",
      },
      generatedAt,
      snapshotHash,
      items,
    });
    sqlite.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations(version, applied_at) VALUES
        ('0000_existing_baseline.sql', 0), ('0001_multi_market_paper_ai.sql', 0),
        ('0002_knowledge_memory.sql', 0), ('0003_research_jobs.sql', 0),
        ('0004_evidence_and_paper_lifecycle.sql', 0), ('0005_evidence_snapshots.sql', 0);
      CREATE TABLE evidence_snapshots (
        snapshot_hash TEXT PRIMARY KEY, instrument_id TEXT NOT NULL, evidence_json TEXT NOT NULL,
        generated_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE ai_runs (
        id INTEGER PRIMARY KEY, instrument_id TEXT NOT NULL, snapshot_hash TEXT NOT NULL, evidence_json TEXT
      );
      CREATE TABLE agent_config (
        id INTEGER PRIMARY KEY, telegram_bot_token TEXT, telegram_chat_id TEXT,
        robinhood_connected_at INTEGER, robinhood_account TEXT
      );
      CREATE TABLE paper_orders (
        id INTEGER PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL,
        expires_at INTEGER, resolved_at INTEGER
      );
      INSERT INTO agent_config VALUES (1, 'legacy-secret', '123', NULL, NULL);
    `);
    sqlite.prepare("INSERT INTO ai_runs VALUES (1, ?, ?, ?)").run("US:XNAS:AAPL", snapshotHash, evidence);
    migrateDatabase(sqlite);

    expect(sqlite.prepare("SELECT snapshot_hash, instrument_id FROM evidence_snapshots").get()).toEqual({
      snapshot_hash: snapshotHash,
      instrument_id: "US:XNAS:AAPL",
    });
    expect(sqlite.prepare("SELECT telegram_bot_token, telegram_chat_id FROM agent_config").get()).toEqual({
      telegram_bot_token: null,
      telegram_chat_id: null,
    });
    const orderColumns = sqlite.prepare("PRAGMA table_info(paper_orders)").all().map((row) => (row as { name: string }).name);
    expect(orderColumns).toEqual(expect.arrayContaining(["quote_provider", "quote_source_id", "quote_quality", "simulated_fixture"]));
    sqlite.close();
  });

  it("contains no destructive SQL", () => {
    // Targets destructive statements specifically. A `BEFORE DELETE` trigger contains the
    // word DELETE but exists to prevent deletion, so a bare \bDELETE\b match is wrong here.
    const destructive = /\bDROP\s+(TABLE|INDEX|VIEW|TRIGGER|COLUMN)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i;
    const files = fs
      .readdirSync(path.join(process.cwd(), "drizzle"))
      .filter((name) => name.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const sql = fs.readFileSync(path.join(process.cwd(), "drizzle", file), "utf8");
      expect(sql, `${file} contains destructive SQL`).not.toMatch(destructive);
    }
  });

  it("enforces append-only history with database triggers", () => {
    const sqlite = temporaryDatabase();
    migrateDatabase(sqlite);
    const now = Math.floor(Date.now() / 1000);

    sqlite
      .prepare(
        `INSERT INTO strategy_specs (id, name, version, dsl, dsl_hash, status, created_by, created_at)
         VALUES ('stg_x', 'test', 1, '{}', 'h', 'draft', 'test', ?)`,
      )
      .run(now);
    sqlite
      .prepare(
        `INSERT INTO trials (strategy_spec_id, kind, verdict, actor, started_at)
         VALUES ('stg_x', 'replay', 'fail', 'test', ?)`,
      )
      .run(now);

    expect(() => sqlite.prepare("DELETE FROM trials WHERE strategy_spec_id = 'stg_x'").run()).toThrow(
      /append-only/i,
    );
    expect(() => sqlite.prepare("UPDATE trials SET verdict = 'pass' WHERE strategy_spec_id = 'stg_x'").run()).toThrow(
      /immutable/i,
    );

    sqlite
      .prepare(
        `INSERT INTO audit_events (actor, action, decision, created_at) VALUES ('test', 'probe', 'allowed', ?)`,
      )
      .run(now);
    expect(() => sqlite.prepare("DELETE FROM audit_events").run()).toThrow(/append-only/i);
    expect(() => sqlite.prepare("UPDATE audit_events SET decision = 'denied'").run()).toThrow(/immutable/i);

    sqlite.close();
  });
});
