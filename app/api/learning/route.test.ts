import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "@/lib/db";
import { getLearningMode, setLearningMode } from "@/lib/governance/runtime";
import { createLocalSession } from "@/lib/security/request";
import { PATCH } from "./route";

const AGENT_TOKEN = "a".repeat(64);
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-learning-route-"));
  vi.stubEnv("MARKETPULSE_DB_PATH", path.join(directory, "learning.db"));
  vi.stubEnv("MARKETPULSE_AGENT_TOKEN", AGENT_TOKEN);
  closeDbForTests();
  setLearningMode("off", "owner");
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

  it("accepts a local browser session without owner-token unlock", async () => {
    const response = await PATCH(
      patchRequest({
        origin: "http://127.0.0.1:3000",
        "x-marketpulse-mutation": "1",
        cookie: `marketpulse_local_session=${createLocalSession()}`,
      }),
    );
    expect(response.status).toBe(200);
    expect(getLearningMode()).toBe("evolving");
  });

  it("does not let an unauthenticated local request change learning mode", async () => {
    const response = await PATCH(
      patchRequest({
        origin: "http://127.0.0.1:3000",
        "x-marketpulse-mutation": "1",
      }),
    );
    expect(response.status).toBe(401);
    expect(getLearningMode()).toBe("off");
  });
});
