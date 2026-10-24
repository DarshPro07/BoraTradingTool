/**
 * The cloud clock's slim ledger: what the clock reads or writes, copied from the laptop's database
 * into a freshly migrated one. A few MB instead of 890 (docs/plans/cloud-clock).
 *
 * Built by INSERT into a new database, never by deleting from a copy: `audit_events` is
 * append-only by trigger. Ids are kept, because IN1 and the fund read their ledgers in id order.
 */
import fs from "node:fs";
import type Database from "better-sqlite3";
import { openDatabase } from "@/lib/db";
import { CLOCK_ACTIONS } from "./writer";

const CLOCK_ROWS = `action IN (${CLOCK_ACTIONS.map((action) => `'${action}'`).join(", ")})`;

/** In dependency order: each table comes after every table it references. */
export const SLIM_TABLES: readonly { table: string; where?: string }[] = [
  // The NSE security master: FN1's daily ingest refuses an instrument it does not list.
  { table: "security_master_syncs" },
  { table: "nse_securities" },
  { table: "nse_listing_versions" },
  { table: "nse_security_aliases" },
  { table: "nse_provider_mappings" },
  { table: "corporate_actions" },
  { table: "sector_classifications" },
  { table: "instruments" },
  { table: "user_watchlist" },
  { table: "strategies" },
  { table: "agent_config" },
  { table: "learning_state" },
  { table: "paper_accounts" },
  { table: "paper_orders" },
  { table: "paper_positions" },
  { table: "paper_ledger" },
  { table: "crypto_paper_accounts" },
  { table: "crypto_paper_orders" },
  { table: "crypto_paper_positions" },
  // FN1's stored daily bars. IN1 fetches its bars live and stores none.
  { table: "price_candles", where: "ticker = 'IN:XNSE:NIFTYBEES' AND resolution = 'D'" },
  { table: "audit_events", where: CLOCK_ROWS },
];

/** Columns both databases have, so a migration one side lacks cannot break the copy. */
export function sharedColumns(sqlite: Database.Database, table: string, other: string, exclude: readonly string[] = []): string[] {
  const names = (schema: string) => (sqlite.prepare(`PRAGMA ${schema}.table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
  const theirs = new Set(names(other));
  return names("main").filter((name) => theirs.has(name) && !exclude.includes(name)).map((name) => `"${name}"`);
}

export function buildSlimLedger(sourceFile: string, targetFile: string): { counts: Record<string, number>; maxAuditId: number } {
  if (fs.existsSync(targetFile)) throw new Error(`${targetFile} already exists`);
  const { sqlite } = openDatabase(targetFile); // migrated, with the default rows a new database gets
  try {
    sqlite.prepare("ATTACH DATABASE ? AS src").run(sourceFile);
    const counts: Record<string, number> = {};
    sqlite.transaction(() => {
      // A new database's defaults (two accounts, a strategy, the config) are replaced, not merged.
      // Children first, so no reference is left dangling.
      for (const { table, where } of [...SLIM_TABLES].reverse()) if (!where) sqlite.exec(`DELETE FROM main."${table}"`);
      for (const { table, where } of SLIM_TABLES) {
        const columns = sharedColumns(sqlite, table, "src").join(", ");
        const filter = where ? ` WHERE ${where}` : "";
        const copied = sqlite.prepare(`INSERT INTO main."${table}" (${columns}) SELECT ${columns} FROM src."${table}"${filter}`).run().changes;
        const expected = (sqlite.prepare(`SELECT count(*) AS n FROM src."${table}"${filter}`).get() as { n: number }).n;
        if (copied !== expected) throw new Error(`${table}: copied ${copied} of ${expected} rows`);
        counts[table] = copied;
      }
      // The clock never uses these, so they never leave the laptop, even encrypted.
      sqlite.exec("UPDATE main.agent_config SET telegram_bot_token = NULL, telegram_chat_id = NULL, robinhood_account = NULL, robinhood_connected_at = NULL");
    })();
    sqlite.exec("DETACH DATABASE src");
    const maxAuditId = (sqlite.prepare("SELECT coalesce(max(id), 0) AS id FROM audit_events").get() as { id: number }).id;
    // One file: no -wal beside it to forget when the database is sealed.
    sqlite.pragma("journal_mode = DELETE");
    return { counts, maxAuditId };
  } finally {
    sqlite.close();
  }
}
