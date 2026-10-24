/**
 * Mirror the cloud clock's ledger into this database while the cloud owns it (docs/plans/cloud-clock).
 *
 * The paper books are replaced with the cloud's, which is a superset of what this machine had at
 * cutover, because nothing here writes them since. Audit rows the cloud wrote after the cutover are
 * appended once, in the cloud's order, and the import is recorded as its own audit row: that row is
 * also where the next import starts. The reports, the MCP server and `/fund` read the result
 * unchanged, and a promote back to this machine starts from it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { databasePath, getDb } from "@/lib/db";
import { ledgerKey, openBundle, type LedgerMeta } from "./bundle";
import { DEFAULT_REPO, downloadAsset, getStateRelease, latestStateAsset, type GitHub } from "./release";
import { sharedColumns } from "./seed";
import { installCloudGuard, LEDGER_TABLES, ledgerOwnedByCloud, removeCloudGuard } from "./writer";

export const IMPORT_ACTION = "cloud_ledger_imported";

interface ImportRecord {
  epoch: number;
  cloudAuditThrough: number;
  auditRows: number;
  /** The cutover this bundle descends from; absent in records written before 2026-10-25. */
  seededAt?: string;
}

export function lastImport(sqlite: Database.Database): ImportRecord | null {
  const row = sqlite
    .prepare("SELECT detail FROM audit_events WHERE decision IN ('allowed') AND action = ? ORDER BY id DESC LIMIT 1")
    .get(IMPORT_ACTION) as { detail: string } | undefined;
  return row ? (JSON.parse(row.detail) as ImportRecord) : null;
}

export function importCloudLedger(sqlite: Database.Database, databaseFile: string, slimFile: string, meta: LedgerMeta): ImportRecord {
  // On a database that writes its own ledger this would overwrite that machine's own record.
  if (!ledgerOwnedByCloud(databaseFile)) throw new Error("this database writes its own ledger: import refused");
  removeCloudGuard(sqlite);
  let attached = false;
  try {
    sqlite.prepare("ATTACH DATABASE ? AS cloud").run(slimFile);
    attached = true;
    // IMMEDIATE, and the last import read inside it: a second importer (a manual pull landing on a
    // scheduled cycle) waits for the first, then sees its record. audit_events is append-only, so a
    // row imported twice could never be taken back.
    return sqlite.transaction((): ImportRecord => {
      const previous = lastImport(sqlite);
      if (previous && previous.epoch >= meta.epoch) return { ...previous, auditRows: 0 };
      // Same cutover, but fewer clock rows than already imported: the cloud's ledger went backwards
      // (a deleted release, a bad save). Its books would roll this copy back too (review 2026-10-24).
      const cloudMax = (sqlite.prepare("SELECT coalesce(max(id), 0) AS id FROM cloud.audit_events").get() as { id: number }).id;
      if (previous?.seededAt === meta.seededAt && cloudMax < previous.cloudAuditThrough) {
        throw new Error(`the cloud ledger went backwards (clock rows through ${cloudMax}, imported through ${previous.cloudAuditThrough}): import refused, this copy kept`);
      }
      const after = Math.max(meta.seedMaxAuditId, previous?.cloudAuditThrough ?? 0);
      const instruments = sharedColumns(sqlite, "instruments", "cloud").join(", ");
      sqlite.exec(`INSERT OR IGNORE INTO main.instruments (${instruments}) SELECT ${instruments} FROM cloud.instruments`);
      for (const table of [...LEDGER_TABLES].reverse()) sqlite.exec(`DELETE FROM main."${table}"`);
      for (const table of LEDGER_TABLES) {
        const columns = sharedColumns(sqlite, table, "cloud").join(", ");
        sqlite.exec(`INSERT INTO main."${table}" (${columns}) SELECT ${columns} FROM cloud."${table}"`);
      }
      // New ids here: this machine has written its own audit rows since the cutover.
      const columns = sharedColumns(sqlite, "audit_events", "cloud", ["id"]).join(", ");
      const auditRows = sqlite.prepare(`INSERT INTO main.audit_events (${columns}) SELECT ${columns} FROM cloud.audit_events WHERE id > ? ORDER BY id`).run(after).changes;
      const record: ImportRecord = { epoch: meta.epoch, cloudAuditThrough: Math.max(after, cloudMax), auditRows, seededAt: meta.seededAt };
      sqlite
        .prepare("INSERT INTO audit_events (actor, action, decision, subject, detail, created_at) VALUES ('ledger-import', ?, 'allowed', ?, ?, ?)")
        .run(IMPORT_ACTION, `cloud:${meta.epoch}`, JSON.stringify({ ...record, writtenAt: meta.writtenAt }), Math.floor(Date.now() / 1000));
      return record;
    }).immediate();
  } finally {
    if (attached) sqlite.exec("DETACH DATABASE cloud");
    installCloudGuard(sqlite);
  }
}

/** The laptop's half: fetch the newest sealed bundle from the public release and import it. */
export async function pullCloudLedger(gh: GitHub = { repo: process.env.LEDGER_REPO ?? DEFAULT_REPO }, databaseFile = databasePath()): Promise<string> {
  if (!ledgerOwnedByCloud(databaseFile)) return "this machine owns the ledger: nothing to pull";
  const key = ledgerKey();
  if (!key) throw new Error("LEDGER_KEY is not in .env.local");
  const latest = latestStateAsset(await getStateRelease(gh));
  if (!latest) return "no cloud ledger published yet";
  const sqlite = getDb().$client;
  if (latest.epoch <= (lastImport(sqlite)?.epoch ?? 0)) return `up to date (${new Date(latest.epoch).toISOString()})`;
  const bundle = openBundle(await downloadAsset(gh, latest.asset), key);
  const slimFile = path.join(os.tmpdir(), `marketpulse-cloud-${latest.epoch}.db`);
  fs.writeFileSync(slimFile, bundle.files["marketpulse.db"]!);
  try {
    const record = importCloudLedger(sqlite, databaseFile, slimFile, bundle.meta);
    return `imported the cloud ledger of ${bundle.meta.writtenAt}: ${record.auditRows} new audit row(s)`;
  } finally {
    fs.rmSync(slimFile, { force: true });
  }
}
