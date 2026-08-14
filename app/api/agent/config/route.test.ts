import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { getAgentConfig } from "@/lib/trading/config";
import { createLocalSession } from "@/lib/security/request";
import { PATCH } from "./route";

const AGENT_TOKEN = "a".repeat(64);
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-config-route-"));
  vi.stubEnv("MARKETPULSE_DB_PATH", path.join(directory, "config.db"));
  vi.stubEnv("MARKETPULSE_AGENT_TOKEN", AGENT_TOKEN);
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

  it("allows a local browser session to update paper-risk limits without owner-token unlock", async () => {
    const response = await PATCH(request({
      origin: "http://127.0.0.1:3000",
      "x-marketpulse-mutation": "1",
      cookie: `marketpulse_local_session=${createLocalSession()}`,
    }));
    expect(response.status).toBe(200);
    expect(getAgentConfig()).toMatchObject({ maxPositionPct: 100, dailyTradeCap: 1000, watchlistOnly: false });
  });

  it("does not let an unauthenticated local request relax paper-risk limits", async () => {
    const before = getAgentConfig();
    const response = await PATCH(request({
      origin: "http://127.0.0.1:3000",
      "x-marketpulse-mutation": "1",
    }));
    expect(response.status).toBe(401);
    expect(getAgentConfig()).toMatchObject({
      maxPositionPct: before.maxPositionPct,
      dailyTradeCap: before.dailyTradeCap,
      watchlistOnly: before.watchlistOnly,
    });
  });
});
