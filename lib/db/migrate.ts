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
  "0007_rehearsal_outcomes.sql",
  // Research identity: campaign → family → identity → selection trials → holdout access.
  // Registered on owner instruction, 2026-08-09. Until this line existed the file sat in
  // `drizzle/pending/` — this array is the only thing that makes a migration real, and a `.sql`
  // file in `drizzle/` that is absent from it is applied by nothing while looking applied.
  "0008_research_identity.sql",
  // Dataset snapshots + experiment trade ledger. Registered under the owner's 2026-08-09 item-13
  // instruction ("Add explicit dataset snapshot identity... Every experiment records its dataset
  // snapshot"). Research reads snapshots from the canonical store; completed experiments reopen
  // from their ledger, never from a fresh provider window.
  "0009_dataset_snapshots.sql",
  // Slice 13b (owner directive 2026-08-09 21:09): "Every quantitative decision must be
  // reproducible from an explicit immutable experiment manifest." Additive columns only:
  // experiments.manifest, plus dataset_snapshot_id on selection_trials / holdout_access /
  // rehearsal_outcomes.
  "0010_experiment_manifest.sql",
  // Official NSE security identity and effective-dated listing history. ISIN is durable; existing
  // symbol-based instrument ids remain operational aliases so no persisted evidence is rewritten.
  "0011_nse_security_master.sql",
  // Forward evidence, shadow stage (mission workstream 1, owner directive 2026-08-09 22:51):
  // frozen challengers, immutable prospective signals, append-only outcomes — all trigger-enforced.
  "0012_forward_evidence.sql",
  // WS1b (owner directive 2026-08-10): the paper stage for forward challengers — immutable
  // execution intents, lifecycle-frozen paper orders, append-only position outcomes, accounts
  // at real validation capital.
  "0013_paper_forward.sql",
  // Fresh installs start the safe research loop without a manual button. The migration changes
  // only the untouched bootstrap row, so an owner-selected OFF state remains authoritative.
  "0014_autonomy_default.sql",
  // The AgentRun ledger: every model call MarketPulse makes, including the refused ones.
  "0015_agent_runs.sql",
  "0016_autonomous_runs.sql",
  "0017_autonomous_runs_single_live.sql",
  // Job dependencies: let one job wait for another to finish before it becomes claimable.
  // This is the missing operating-system behavior for the autonomous job chain.
  "0018_job_dependencies.sql",
  // Durable trial-budget reservations — the atomic, fenced, crash-safe gate for spending a
  // permanent statistical trial. Replaces the filesystem-lease serialization with a
  // UNIQUE(trading_date, budget_slot) reservation so concurrency, stalls and crashes cannot
  // manufacture free trials. Plain CREATE TABLE + partial unique index; applied as raw SQL.
  "0019_trial_reservations.sql",
  // Agent-run provenance: link a run to its AgentDefinition (agent_id + version, so a prompt
  // change never makes historical runs irreproducible) and the durable job that drove it (job_id).
  // Additive nullable columns; browser-triggered runs keep NULL.
  "0020_agent_run_provenance.sql",
  // Team OS: team_runs + agent_artifacts ledgers and a nullable agent_runs.team_run_id link.
  // Additive; the single-agent path writes none of them. Chief-of-Staff coordinates bounded teams
  // that exchange persisted artifacts (not chat) and preserve dissent into the TeamResult.
  "0021_team_os.sql",
  // Sealed holdout apparatus (owner architecture instruction, 2026-08-14): holdout_definitions
  // (immutable window + purge/embargo + sealed-window snapshot + PINNED decision rule + state
  // machine) and holdout_results (full economics + degradation + coded reasons; UNIQUE per
  // holdout×family). Additive only; the existing holdout_access / holdout_ledger enforcement
  // and every prior table are untouched.
  "0022_sealed_holdout.sql",
  // The bar-ingestion ledger: the request stored beside the response (window asked for, bars
  // returned, identity verdict, gap/completeness audit), append-only by trigger. Exists because
  // a provider layer once served one day for a 59-day request while every fetch still
  // "succeeded" — silent truncation is invisible unless the request is kept. Additive only: a
  // new table plus its two immutability triggers; no existing table, row or index is touched.
  "0023_bar_ingestions.sql",
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

function applyAutonomyDefaultMigration(sqlite: Database.Database): void {
  // Some legacy databases recorded 0002 as applied without containing every 0002 table. Upgrade
  // those databases without inventing state; a genuinely fresh schema always has this row.
  if (!tableExists(sqlite, "learning_state")) return;
  const changed = sqlite.prepare(`
    UPDATE learning_state
    SET mode = 'learning', updated_by = 'startup-default', updated_at = unixepoch()
    WHERE id = 1 AND mode = 'off' AND updated_at = 0
  `).run().changes;
  if (changed === 0 || !tableExists(sqlite, "audit_events")) return;
  sqlite.prepare(`
    INSERT INTO audit_events
      (actor, action, decision, subject, detail, learning_mode, created_at)
    VALUES
      ('startup-default', 'set_learning_mode', 'allowed', 'learning',
       'Fresh-install default: safe research autonomy starts automatically; financial mutation remains prohibited.',
       'learning', unixepoch())
  `).run();
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
      } else if (version === "0014_autonomy_default.sql") {
        applyAutonomyDefaultMigration(sqlite);
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
