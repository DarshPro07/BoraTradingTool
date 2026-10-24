import { describe, expect, it, vi } from "vitest";
import { databasePath, getDb } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { ORB_CONTRACT, runIntradayPass, type IntradayDeps } from "@/lib/intraday/orb";
import { setLedgerWriter } from "./writer";

describe("one writer: a database the cloud clock owns refuses the clock's writes (docs/plans/cloud-clock)", () => {
  useTemporaryDatabase();
  const audit = (action: string) =>
    getDb().$client.prepare("INSERT INTO audit_events (actor, action, decision, created_at) VALUES ('t', ?, 'allowed', 1)").run(action);

  it("refuses the paper books and the clock's audit rows, and nothing else", () => {
    setLedgerWriter(databasePath(), "cloud"); // before the first getDb(): the guard is installed on open
    expect(() => getDb().$client.prepare("UPDATE paper_accounts SET cash = cash").run()).toThrow(/LEDGER_OWNED_BY_CLOUD: paper_accounts/);
    expect(() => audit("intraday_decision")).toThrow(/LEDGER_OWNED_BY_CLOUD: audit_events/);
    expect(() => audit("learning_cycle"), "research keeps writing").not.toThrow();
  });

  it("stops IN1 itself, whichever path calls it", async () => {
    setLedgerWriter(databasePath(), "cloud");
    const deps: IntradayDeps = {
      firstCandle: async () => ({ open: 100, high: 103, low: 99, close: 102 }),
      lastPrice: async () => 101,
      sessionOpen: () => true,
      book: () => ({ startingCash: 25_000, cash: 25_000, capPct: 15 }),
      place: async () => {
        throw new Error("no order may be attempted");
      },
    };
    const result = await runIntradayPass(deps, new Date("2026-09-21T09:21:00+05:30"));
    expect(result.filter((r) => r.action.startsWith("failed: LEDGER_OWNED_BY_CLOUD"))).toHaveLength(ORB_CONTRACT.universe.length);
  });

  it("follows a cutover and a promote on a connection that was already open (the Next server, an MCP server)", () => {
    // Review 2026-10-24: the guard was installed only when a connection opened, so a long-lived
    // server that opened before the cutover kept writing the ledger.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect(() => audit("intraday_decision")).not.toThrow();
      setLedgerWriter(databasePath(), "cloud");
      vi.setSystemTime(Date.now() + 1_500);
      expect(() => audit("intraday_decision")).toThrow(/LEDGER_OWNED_BY_CLOUD/);
      setLedgerWriter(databasePath(), "local");
      vi.setSystemTime(Date.now() + 1_500);
      expect(() => audit("intraday_decision")).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a database this machine owns alone", () => {
    expect(() => getDb().$client.prepare("UPDATE paper_accounts SET cash = cash").run()).not.toThrow();
    expect(() => audit("intraday_decision")).not.toThrow();
  });
});
