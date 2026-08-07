import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { getLearningMode } from "@/lib/governance/runtime";
import { createOwnerSession } from "@/lib/security/request";
import { PATCH } from "./route";

const AGENT_TOKEN = "a".repeat(64);
const OWNER_TOKEN = "o".repeat(64);
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-learning-route-"));
  vi.stubEnv("MARKETPULSE_DB_PATH", path.join(directory, "learning.db"));
  vi.stubEnv("MARKETPULSE_AGENT_TOKEN", AGENT_TOKEN);
  vi.stubEnv("MARKETPULSE_OWNER_TOKEN", OWNER_TOKEN);
  closeDbForTests();
});

afterEach(() => {
  closeDbForTests();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

function patchRequest(headers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3000/api/learning", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ mode: "evolving" }),
  });
}

describe("PATCH /api/learning", () => {
  it("does not let an agent token change owner-controlled learning mode", async () => {
    const response = await PATCH(patchRequest({ authorization: `Bearer ${AGENT_TOKEN}` }));
    expect(response.status).toBe(403);
    expect(getLearningMode()).toBe("off");
  });

  it("accepts an authenticated owner session", async () => {
    const session = createOwnerSession(OWNER_TOKEN, process.env)!;
    const response = await PATCH(
      patchRequest({
        origin: "http://127.0.0.1:3000",
        "x-marketpulse-csrf": "1",
        cookie: `marketpulse_owner_session=${session}`,
      }),
    );
    expect(response.status).toBe(200);
    expect(getLearningMode()).toBe("evolving");
  });
});
