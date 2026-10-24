import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import type { LedgerMeta } from "./bundle";
import { importCloudLedger } from "./pull";
import { buildSlimLedger } from "./seed";
import { setLedgerWriter } from "./writer";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-ledger-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const file = (name: string) => path.join(dir, `${name}-${++n}.db`);

/** A laptop database: clock rows and research rows, a book, two tickers' bars, a secret in the config. */
function laptop(): string {
  const target = file("laptop");
  const { sqlite } = openDatabase(target);
  sqlite.prepare(
    "INSERT INTO instruments (id, market, exchange, symbol, provider_symbol, name, currency, timezone, asset_type, updated_at) VALUES ('IN:XNSE:RELIANCE', 'IN', 'XNSE', 'RELIANCE', 'RELIANCE.NS', 'Reliance', 'INR', 'Asia/Kolkata', 'EQUITY', 1)",
  ).run();
  sqlite.prepare(
    "INSERT INTO paper_orders (instrument_id, side, quantity, order_type, status, quote_price, fill_price, currency, idempotency_key, created_at, product) VALUES ('IN:XNSE:RELIANCE', 'BUY', 3, 'MARKET', 'FILLED', 100, 100, 'INR', 'orb-1', 1, 'INTRADAY')",
  ).run();
  const audit = sqlite.prepare("INSERT INTO audit_events (actor, action, decision, subject, detail, created_at) VALUES ('t', ?, 'allowed', ?, '{}', 1)");
  audit.run("learning_cycle", "research-1");
  audit.run("intraday_decision", "IN1:d1");
  audit.run("fund_nav", "FN1:nav1");
  const bar = sqlite.prepare("INSERT INTO price_candles (ticker, resolution, time, open, high, low, close) VALUES (?, 'D', 1, 1, 1, 1, 1)");
  bar.run("IN:XNSE:NIFTYBEES");
  bar.run("IN:XNSE:RELIANCE");
  sqlite.prepare("UPDATE agent_config SET telegram_bot_token = 'not-for-the-cloud'").run();
  sqlite.prepare("UPDATE paper_accounts SET cash = 24960.83 WHERE currency = 'INR'").run();
  sqlite.close();
  return target;
}

const meta = (seedMaxAuditId: number, epoch = 1): LedgerMeta => ({
  epoch, writtenAt: new Date(epoch).toISOString(), writer: "cloud", seedMaxAuditId, seededAt: "", lastDataOkAt: null, final: true, runId: null,
});

describe("the slim ledger the cloud clock starts from (docs/plans/cloud-clock)", () => {
  it("carries the clock's rows with their ids, FN1's bars, the books, and no secret", () => {
    const source = laptop();
    const slim = file("slim");
    const { counts, maxAuditId } = buildSlimLedger(source, slim);
    const db = new Database(slim, { readonly: true });
    const src = new Database(source, { readonly: true });
    const ids = (d: Database.Database) => d.prepare("SELECT id, action FROM audit_events WHERE action IN ('intraday_decision', 'fund_nav') ORDER BY id").all();
    expect(ids(db), "same ids: IN1 and the fund read their ledgers in id order").toEqual(ids(src));
    expect(db.prepare("SELECT count(*) AS n FROM audit_events WHERE action = 'learning_cycle'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT ticker FROM price_candles").all()).toEqual([{ ticker: "IN:XNSE:NIFTYBEES" }]);
    expect(db.prepare("SELECT telegram_bot_token FROM agent_config").get()).toEqual({ telegram_bot_token: null });
    expect(db.prepare("SELECT cash FROM paper_accounts WHERE currency = 'INR'").get()).toEqual({ cash: 24960.83 });
    expect(counts.paper_orders).toBe(1);
    expect(maxAuditId).toBe((db.prepare("SELECT max(id) AS id FROM audit_events").get() as { id: number }).id);
    expect(fs.existsSync(`${slim}-wal`), "one file to seal").toBe(false);
    db.close();
    src.close();
  });

  it("never overwrites an existing file", () => {
    const target = file("exists");
    fs.writeFileSync(target, "");
    expect(() => buildSlimLedger(laptop(), target)).toThrow(/already exists/);
  });
});

describe("the laptop mirrors the cloud's ledger", () => {
  function cutover() {
    const source = laptop();
    const slim = file("slim");
    const { maxAuditId } = buildSlimLedger(source, slim);
    const before = file("before"); // the ledger as the cloud got it: a copy that later goes "backwards"
    fs.copyFileSync(slim, before);
    setLedgerWriter(source, "cloud");
    // The cloud trades and decides; the laptop keeps researching.
    const cloud = openDatabase(slim).sqlite;
    cloud.prepare(
      "INSERT INTO paper_orders (instrument_id, side, quantity, order_type, status, quote_price, fill_price, currency, idempotency_key, created_at, product) VALUES ('IN:XNSE:RELIANCE', 'SELL', 3, 'MARKET', 'FILLED', 104, 104, 'INR', 'orb-2', 2, 'INTRADAY')",
    ).run();
    cloud.prepare("UPDATE paper_accounts SET cash = 24972.83 WHERE currency = 'INR'").run();
    cloud.prepare("INSERT INTO audit_events (actor, action, decision, subject, detail, created_at) VALUES ('intraday', 'intraday_execution', 'allowed', 'IN1:x1', '{}', 2)").run();
    cloud.close();
    const main = openDatabase(source).sqlite; // cloud-owned: the guard is on
    main.prepare("INSERT INTO audit_events (actor, action, decision, subject, detail, created_at) VALUES ('t', 'learning_cycle', 'allowed', 'research-2', '{}', 2)").run();
    return { source, slim, before, main, maxAuditId };
  }

  it("takes the cloud's books and its new clock rows once, keeps its own rows, and keeps the guard", () => {
    const { source, slim, main, maxAuditId } = cutover();
    const first = importCloudLedger(main, source, slim, meta(maxAuditId));
    expect(first.auditRows).toBe(1);
    expect(main.prepare("SELECT count(*) AS n FROM paper_orders").get()).toEqual({ n: 2 });
    expect(main.prepare("SELECT cash FROM paper_accounts WHERE currency = 'INR'").get()).toEqual({ cash: 24972.83 });
    expect(main.prepare("SELECT count(*) AS n FROM audit_events WHERE subject = 'research-2'").get(), "this machine's own research row survives").toEqual({ n: 1 });

    const second = importCloudLedger(main, source, slim, meta(maxAuditId, 2));
    expect(second.auditRows, "nothing imported twice").toBe(0);
    expect(main.prepare("SELECT count(*) AS n FROM audit_events WHERE subject = 'IN1:x1'").get()).toEqual({ n: 1 });
    expect(main.prepare("SELECT count(*) AS n FROM audit_events WHERE action = 'cloud_ledger_imported'").get()).toEqual({ n: 2 });
    const again = importCloudLedger(main, source, slim, meta(maxAuditId, 2));
    expect(again.auditRows, "the same bundle twice (a manual pull landing on a cycle) imports nothing").toBe(0);
    expect(main.prepare("SELECT count(*) AS n FROM audit_events WHERE action = 'cloud_ledger_imported'").get()).toEqual({ n: 2 });
    expect(() => main.prepare("UPDATE paper_accounts SET cash = 0").run(), "the guard is back").toThrow(/LEDGER_OWNED_BY_CLOUD/);
    main.close();
  });

  it("refuses a cloud ledger that went backwards, and keeps its own copy", () => {
    // Review 2026-10-24: the mirror replaced its books with whatever the newest bundle held, so a
    // rolled-back cloud ledger would have rolled the laptop's copy back too.
    const { source, slim, before, main, maxAuditId } = cutover();
    importCloudLedger(main, source, slim, meta(maxAuditId));
    expect(() => importCloudLedger(main, source, before, meta(maxAuditId, 3))).toThrow(/went backwards/);
    expect(main.prepare("SELECT count(*) AS n FROM paper_orders").get(), "the books are untouched").toEqual({ n: 2 });
    main.close();
  });

  it("refuses to import into a database that writes its own ledger", () => {
    const { source, slim, main, maxAuditId } = cutover();
    setLedgerWriter(source, "local");
    expect(() => importCloudLedger(main, source, slim, meta(maxAuditId))).toThrow(/import refused/);
    main.close();
  });
});
