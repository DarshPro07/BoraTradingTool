/**
 * Who writes the paper ledger: this machine, or the cloud clock (docs/plans/cloud-clock).
 *
 * Only one machine may record paper decisions and orders at a time. Two writers would record two
 * sets of decisions for the same session, and the forward evidence would be worthless. The switch
 * is a file beside the database, `<db>.writer` containing `cloud`, so an isolated test database is
 * never affected. Every connection to a database the cloud owns gets temporary triggers that refuse
 * the writes; the clock's entry points also skip cleanly, so the triggers are the backstop for any
 * path they miss (the desk, an agent, a hand-run script).
 */
import fs from "node:fs";
import type Database from "better-sqlite3";

/** The paper books the clock writes: INR (IN1, FN1, the square-off) and crypto (FC1, FC2). */
export const LEDGER_TABLES = [
  "paper_accounts",
  "paper_orders",
  "paper_positions",
  "paper_ledger",
  "crypto_paper_accounts",
  "crypto_paper_orders",
  "crypto_paper_positions",
] as const;

/** The `audit_events` actions the clock writes: IN1, the fund mandates, session coverage. */
export const CLOCK_ACTIONS = [
  "intraday_decision",
  "intraday_execution",
  "fund_decision",
  "fund_execution",
  "fund_nav",
  "fund_kill",
  "fund_decision_missed",
  "session_coverage",
] as const;

export const GUARD_ERROR = "LEDGER_OWNED_BY_CLOUD";

export const writerFile = (databaseFile: string) => `${databaseFile}.writer`;

export function ledgerOwnedByCloud(databaseFile: string): boolean {
  try {
    return fs.readFileSync(writerFile(databaseFile), "utf8").trim() === "cloud";
  } catch {
    return false;
  }
}

export function setLedgerWriter(databaseFile: string, writer: "cloud" | "local"): void {
  if (writer === "cloud") fs.writeFileSync(writerFile(databaseFile), "cloud\n", "utf8");
  else fs.rmSync(writerFile(databaseFile), { force: true });
}

const triggerNames = () => [
  ...LEDGER_TABLES.flatMap((table) => ["insert", "update", "delete"].map((op) => `cloud_guard_${table}_${op}`)),
  "cloud_guard_audit_events_insert",
];

/** Temporary triggers on this connection only: the database file itself is never changed. */
export function installCloudGuard(sqlite: Database.Database): void {
  const actions = CLOCK_ACTIONS.map((action) => `'${action}'`).join(", ");
  sqlite.exec(
    [
      ...LEDGER_TABLES.flatMap((table) =>
        ["INSERT", "UPDATE", "DELETE"].map(
          (op) =>
            `CREATE TEMP TRIGGER IF NOT EXISTS cloud_guard_${table}_${op.toLowerCase()} BEFORE ${op} ON main.${table} ` +
            `BEGIN SELECT RAISE(ABORT, '${GUARD_ERROR}: ${table}'); END;`,
        ),
      ),
      `CREATE TEMP TRIGGER IF NOT EXISTS cloud_guard_audit_events_insert BEFORE INSERT ON main.audit_events ` +
        `WHEN NEW.action IN (${actions}) BEGIN SELECT RAISE(ABORT, '${GUARD_ERROR}: audit_events'); END;`,
    ].join("\n"),
  );
}

/** For the import alone, which mirrors the cloud's ledger into this database. */
export function removeCloudGuard(sqlite: Database.Database): void {
  sqlite.exec(triggerNames().map((name) => `DROP TRIGGER IF EXISTS temp.${name};`).join("\n"));
}
