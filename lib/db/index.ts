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
  if (process.env.MARKETPULSE_TEST_MODE === "1" && resolved === defaultPath) {
    throw new Error("MARKETPULSE_TEST_MODE requires an explicit isolated database path.");
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

export { schema };
