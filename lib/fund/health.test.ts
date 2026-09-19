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
});
