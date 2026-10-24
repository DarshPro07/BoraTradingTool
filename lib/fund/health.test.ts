import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { fundOsHealth } from "./health";

describe("fundOsHealth — reads what each layer writes, not a badge", () => {
  useTemporaryDatabase();
  const NOW = new Date("2026-09-21T06:30:00Z"); // Monday 12:00 IST, a session

  it("fails every layer on an empty store: nothing ran, so nothing is healthy", () => {
    const byName = Object.fromEntries(fundOsHealth(NOW).map((c) => [c.name, c.ok]));
    expect(byName).toMatchObject({ cycle: false, agents: false, intraday: false, data: false });
  });

  it("passes the cycle and agent checks once recent work is on record", () => {
    const db = getDb();
    db.insert(schema.auditEvents).values({ actor: "t", action: "learning_cycle", decision: "allowed", createdAt: new Date(NOW.getTime() - 10 * 60_000) }).run();
    db.insert(schema.agentRuns).values({ id: "r", capability: "research-papers", provider: "opencode", model: "opencode-free", status: "SUCCEEDED", trigger: "SCHEDULED", startedAt: new Date(NOW.getTime() - 60 * 60_000), completedAt: NOW }).run();
    const byName = Object.fromEntries(fundOsHealth(NOW).map((c) => [c.name, c.ok]));
    expect(byName.cycle).toBe(true);
    expect(byName.agents).toBe(true);
  });

  it("EC-13: IN1 must be flat after the close; a carried position is a failure, not a quiet state", () => {
    const db = getDb();
    const row = (side: "BUY" | "SELL") => ({
      actor: "intraday", action: "intraday_execution", decision: "allowed", subject: `IN1:t:${side}`, createdAt: NOW,
      detail: JSON.stringify({ hash: "h", day: "2026-09-21", instrumentId: "IN:XNSE:RELIANCE", side, reason: side === "BUY" ? "ENTRY" : "EOD", status: "FILLED", quantity: 3, fillPrice: 100, fees: 1, cashDelta: 0, refusal: null, at: NOW.toISOString() }),
    });
    db.insert(schema.auditEvents).values(row("BUY")).run();
    const afterClose = new Date("2026-09-21T10:15:00Z"); // 15:45 IST
    const flat = (at: Date) => fundOsHealth(at).find((c) => c.name === "intraday-flat");
    expect(flat(NOW), "in session a held position is normal").toBeUndefined();
    expect(flat(afterClose)?.ok).toBe(false);
    db.insert(schema.auditEvents).values(row("SELL")).run();
    expect(flat(afterClose)?.ok).toBe(true);
  });
});

