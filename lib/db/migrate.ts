import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";

const MIGRATIONS = [
  "0000_existing_baseline.sql",
  "0001_multi_market_paper_ai.sql",
  "0002_knowledge_memory.sql",
  "0003_research_jobs.sql",
  "0004_evidence_and_paper_lifecycle.sql",
  "0005_evidence_snapshots.sql",
  "0006_security_integrity.sql",
] as const;

function tableExists(sqlite: Database.Database, table: string): boolean {
  return !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function columns(sqlite: Database.Database, table: string): Set<string> {
  if (!tableExists(sqlite, table)) return new Set();
  return new Set(
    sqlite.prepare(`PRAGMA table_info(${table})`).all().map((row) => (row as { name: string }).name),
  );
}

function addColumnIfMissing(sqlite: Database.Database, table: string, column: string, definition: string): void {
  if (tableExists(sqlite, table) && !columns(sqlite, table).has(column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function prepareLegacyCompatibility(sqlite: Database.Database): void {
  const paperColumns = columns(sqlite, "paper_positions");
  if (paperColumns.has("ticker") && !paperColumns.has("instrument_id")) {
    let quarantine = "legacy_paper_positions";
    let suffix = 2;
    while (tableExists(sqlite, quarantine)) quarantine = `legacy_paper_positions_${suffix++}`;
    sqlite.exec(`ALTER TABLE paper_positions RENAME TO ${quarantine}`);
  }

  addColumnIfMissing(sqlite, "agent_config", "robinhood_connected_at", "INTEGER");
  addColumnIfMissing(sqlite, "agent_config", "robinhood_account", "TEXT");
}

function applySecurityIntegrityMigration(sqlite: Database.Database): void {
  addColumnIfMissing(sqlite, "paper_orders", "quote_provider", "TEXT");
  addColumnIfMissing(sqlite, "paper_orders", "quote_source_id", "TEXT");
  addColumnIfMissing(sqlite, "paper_orders", "quote_quality", "TEXT");
  addColumnIfMissing(sqlite, "paper_orders", "simulated_fixture", "INTEGER NOT NULL DEFAULT 0");

  const configColumns = columns(sqlite, "agent_config");
  if (configColumns.has("telegram_bot_token") && configColumns.has("telegram_chat_id")) {
    sqlite.exec("UPDATE agent_config SET telegram_bot_token = NULL, telegram_chat_id = NULL");
  }

  const runColumns = columns(sqlite, "ai_runs");
  if (
    tableExists(sqlite, "evidence_snapshots")
    && runColumns.has("instrument_id")
    && runColumns.has("snapshot_hash")
    && runColumns.has("evidence_json")
  ) {
    const rows = sqlite
      .prepare("SELECT instrument_id, snapshot_hash, evidence_json FROM ai_runs WHERE evidence_json IS NOT NULL")
      .all() as Array<{ instrument_id: string; snapshot_hash: string; evidence_json: string }>;
    const insert = sqlite.prepare(`
      INSERT OR IGNORE INTO evidence_snapshots
        (snapshot_hash, instrument_id, evidence_json, generated_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const now = Math.floor(Date.now() / 1000);
    for (const row of rows) {
      try {
        const evidence = JSON.parse(row.evidence_json) as {
          instrument?: { id?: string };
          generatedAt?: string;
          snapshotHash?: string;
          items?: unknown[];
        };
        if (
          evidence.instrument?.id !== row.instrument_id
          || evidence.snapshotHash !== row.snapshot_hash
          || typeof evidence.generatedAt !== "string"
          || !Array.isArray(evidence.items)
        ) continue;
        const expected = createHash("sha256")
          .update(JSON.stringify({ instrument: row.instrument_id, generatedAt: evidence.generatedAt, items: evidence.items }))
          .digest("hex");
        const generatedAt = Date.parse(evidence.generatedAt);
        if (expected !== row.snapshot_hash || Number.isNaN(generatedAt)) continue;
        insert.run(row.snapshot_hash, row.instrument_id, row.evidence_json, Math.floor(generatedAt / 1000), now);
      } catch {
        // Legacy malformed evidence stays unavailable rather than being trusted.
      }
    }
  }
}

function applyEvidenceLifecycleMigration(sqlite: Database.Database): void {
  addColumnIfMissing(sqlite, "knowledge_sources", "content", "TEXT");
  addColumnIfMissing(sqlite, "ai_runs", "evidence_json", "TEXT");
  addColumnIfMissing(sqlite, "paper_orders", "expires_at", "INTEGER");
  addColumnIfMissing(sqlite, "paper_orders", "resolved_at", "INTEGER");
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_paper_orders_status_expiry ON paper_orders(status, expires_at);
    UPDATE knowledge_sources
      SET status = 'discovered',
          rejection_reason = 'Legacy metadata-only source; re-ingest content before citation.'
      WHERE content IS NULL AND status = 'archived';
    UPDATE paper_orders
      SET expires_at = created_at + 86400
      WHERE status = 'OPEN' AND expires_at IS NULL;
  `);
  const resolutionTime = columns(sqlite, "paper_orders").has("filled_at")
    ? "COALESCE(filled_at, created_at)"
    : "created_at";
  sqlite.exec(`UPDATE paper_orders
    SET resolved_at = ${resolutionTime}
    WHERE status <> 'OPEN' AND resolved_at IS NULL`);
}

export function migrateDatabase(
  sqlite: Database.Database,
  migrationsDirectory = path.join(process.cwd(), "drizzle"),
): void {
  prepareLegacyCompatibility(sqlite);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  for (const version of MIGRATIONS) {
    const migrationPath = path.join(/* turbopackIgnore: true */ migrationsDirectory, version);
    const apply = sqlite.transaction(() => {
      const alreadyApplied = sqlite.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version);
      if (alreadyApplied) return;
      if (version === "0004_evidence_and_paper_lifecycle.sql") {
        applyEvidenceLifecycleMigration(sqlite);
      } else if (version === "0006_security_integrity.sql") {
        applySecurityIntegrityMigration(sqlite);
      } else {
        const sql = fs.readFileSync(/* turbopackIgnore: true */ migrationPath, "utf8");
        sqlite.exec(sql);
      }
      sqlite
        .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .run(version, Math.floor(Date.now() / 1000));
    });
    apply.immediate();
  }
}

export function backupDefaultDatabase(
  sqlite: Database.Database,
  databasePath: string,
  sourceExisted = true,
): string | null {
  const defaultPath = path.resolve(process.cwd(), "marketpulse.db");
  if (path.resolve(databasePath) !== defaultPath || !sourceExisted || !fs.existsSync(defaultPath)) return null;

  const backupDirectory = path.join(process.cwd(), ".backups");
  const migrationTag = MIGRATIONS[MIGRATIONS.length - 1].replace(/\.sql$/, "");
  const marker = path.join(backupDirectory, `.${migrationTag}-backup-complete`);
  if (fs.existsSync(marker)) return null;

  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDirectory, `marketpulse-before-${migrationTag}-${stamp}.db`);
  const quotedBackupPath = backupPath.replace(/'/g, "''");
  sqlite.exec(`VACUUM INTO '${quotedBackupPath}'`);
  const backup = new Database(backupPath, { readonly: true });
  try {
    if (backup.pragma("quick_check", { simple: true }) !== "ok") {
      throw new Error("SQLite backup failed quick_check.");
    }
  } finally {
    backup.close();
  }
  fs.writeFileSync(marker, path.basename(backupPath), { encoding: "utf8", flag: "wx" });
  return backupPath;
}
