import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests, getDb, schema } from "@/lib/db";
import { setLearningMode } from "@/lib/governance/runtime";
import {
  advanceProposal,
  attachEvidence,
  createProposal,
  getProposal,
} from "@/lib/learning/evolution";
import { createLocalSession } from "@/lib/security/request";
import { POST } from "./route";

const AGENT_TOKEN = "a".repeat(64);
let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-proposal-route-"));
  vi.stubEnv("MARKETPULSE_DB_PATH", path.join(directory, "proposals.db"));
  vi.stubEnv("MARKETPULSE_AGENT_TOKEN", AGENT_TOKEN);
  closeDbForTests();
  setLearningMode("evolving", "owner");
});

afterEach(() => {
  closeDbForTests();
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

function proposal(): string {
  return createProposal({
    origin: "research",
    actionId: "improve_dashboard_page",
    title: "Add a provenance badge",
    rationale: "Operators need to distinguish current and delayed evidence.",
    touchedPaths: ["app/dashboard/page.tsx"],
  });
}

function request(body: unknown, headers: Record<string, string>): Request {
  // Merge cookies: caller can add to the base local session cookie.
  const baseCookie = `marketpulse_local_session=${localSession}`;
  const callerCookie = headers.cookie;
  const mergedCookie = callerCookie ? `${baseCookie}; ${callerCookie}` : baseCookie;
  return new Request("http://127.0.0.1:3000/api/proposals", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
      "x-marketpulse-mutation": "1",
      ...headers,
      cookie: mergedCookie,
    },
    body: JSON.stringify(body),
  });
}

// Pre-create a valid local session for tests.
const localSession = createLocalSession();

describe("POST /api/proposals", () => {
  it("records a local transition as autonomous_worker and cannot approve", async () => {
    const id = proposal();
    const localHeaders = { origin: "http://127.0.0.1:3000" };
    const pending = await POST(request({ id, status: "tests_pending", actor: "owner" }, localHeaders));
    expect(pending.status).toBe(200);
    const event = getDb().select().from(schema.auditEvents).all().find((row) => row.action === "proposal_tests_pending");
    expect(event?.actor).toBe("autonomous_worker");

    attachEvidence(id, { kind: "test", detail: "vitest run", passed: true }, "owner");
    advanceProposal(id, "tests_passed", "autonomous_worker");
    advanceProposal(id, "reviewed", "owner", { reviewer: "code_reviewer" });

    // Autonomous worker cannot approve its own proposals.
    const approved = await POST(request({ id, status: "approved", actor: "owner" }, localHeaders));
    expect(approved.status).toBe(403);
    expect(getProposal(id)?.status).toBe("reviewed");
  });

  it("does not let autonomous worker approve reviewed proposals", async () => {
    const id = proposal();
    advanceProposal(id, "tests_pending", "autonomous_worker");
    attachEvidence(id, { kind: "test", detail: "vitest run", passed: true }, "owner");
    advanceProposal(id, "tests_passed", "autonomous_worker");
    advanceProposal(id, "reviewed", "owner", { reviewer: "code_reviewer" });

    const response = await POST(
      request(
        { id, status: "approved" },
        { origin: "http://127.0.0.1:3000" },
      ),
    );
    expect(response.status).toBe(403);
    expect(getProposal(id)?.status).toBe("reviewed");
  });

  it("rejects malformed evidence at the request boundary", async () => {
    const response = await POST(
      request(
        { id: proposal(), evidence: { kind: "test", detail: 7, passed: "yes" } },
        { origin: "http://127.0.0.1:3000" },
      ),
    );
    expect(response.status).toBe(400);
  });

  it("does not accept agent-attested proposal evidence", async () => {
    const response = await POST(
      request(
        { id: proposal(), evidence: { kind: "test", detail: "self-attested", passed: true } },
        { authorization: `Bearer ${AGENT_TOKEN}` },
      ),
    );
    expect(response.status).toBe(403);
  });
});
