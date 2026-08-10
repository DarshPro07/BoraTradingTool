import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { getAgentConfig } from "@/lib/trading/config";
import { createOwnerSession } from "@/lib/security/request";
import { PATCH } from "./route";

const AGENT_TOKEN = "a".repeat(64);
const OWNER_TOKEN = "o".repeat(64);
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-config-route-"));
  vi.stubEnv("MARKETPULSE_DB_PATH", path.join(directory, "config.db"));
  vi.stubEnv("MARKETPULSE_AGENT_TOKEN", AGENT_TOKEN);
  vi.stubEnv("MARKETPULSE_OWNER_TOKEN", OWNER_TOKEN);
  closeDbForTests();
});

afterEach(() => {
  closeDbForTests();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

function request(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3000/api/agent/config", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ maxPositionPct: 100, dailyTradeCap: 1000, watchlistOnly: false }),
  });
}

describe("PATCH /api/agent/config", () => {
  it("does not let an agent token relax paper-risk limits", async () => {
    const before = getAgentConfig();
    const response = await PATCH(request({ authorization: `Bearer ${AGENT_TOKEN}` }));
    expect(response.status).toBe(403);
    expect(getAgentConfig()).toMatchObject({
      maxPositionPct: before.maxPositionPct,
      dailyTradeCap: before.dailyTradeCap,
      watchlistOnly: before.watchlistOnly,
    });
  });

  it("allows an authenticated owner session to update paper-risk limits", async () => {
    const session = createOwnerSession(OWNER_TOKEN, process.env)!;
    const response = await PATCH(request({
      origin: "http://127.0.0.1:3000",
      "x-marketpulse-csrf": "1",
      cookie: `marketpulse_owner_session=${session}`,
    }));
    expect(response.status).toBe(200);
    expect(getAgentConfig()).toMatchObject({ maxPositionPct: 100, dailyTradeCap: 1000, watchlistOnly: false });
  });

  it("does not let an unauthenticated local request relax paper-risk limits", async () => {
    const before = getAgentConfig();
    const response = await PATCH(request({
      origin: "http://127.0.0.1:3000",
      "x-marketpulse-csrf": "1",
    }));
    expect(response.status).toBe(401);
    expect(getAgentConfig()).toMatchObject({
      maxPositionPct: before.maxPositionPct,
      dailyTradeCap: before.dailyTradeCap,
      watchlistOnly: before.watchlistOnly,
    });
  });
});
