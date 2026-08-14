import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { detectProviders, runAgent } from "./gateway";
import type { RuntimeProfile } from "./routing";

// runAgent publishes brain events, and the event bus persists them — isolate the database.
useTemporaryDatabase();

/**
 * Detection v2 + wire dispatch, against a fixture upstream (real HTTP, fixture provider — never
 * presented as live-provider evidence). What is pinned:
 *
 *   - the detection LADDER: no credential → UNAUTHENTICATED with the fix in the reason (auth
 *     required is a stated state, not a failure); credential rejected → UNAUTHENTICATED with the
 *     wire's words; local endpoint not running → NOT_DETECTED with the start hint; answering →
 *     READY with DISCOVERED models under neutral priors;
 *   - the dispatch: an OPENAI_CHAT provider is actually EXECUTABLE through runAgent, the request
 *     binds exactly the assigned model, and the result carries binding provenance;
 *   - the refusal: an HTTP wire with no bound model refuses rather than inventing an id.
 */

let server: http.Server;
let fixtureBase = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      if (req.url === "/v1/models") {
        if (req.headers.authorization && req.headers.authorization !== "Bearer good-key") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "key rejected by fixture" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "fixture-small" }, { id: "fixture-large" }] }));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        const body = JSON.parse(raw) as { model?: string };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: body.model,
            choices: [{ message: { content: `fixture ran ${String(body.model)}` } }],
            usage: { prompt_tokens: 19, completion_tokens: 9 },
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fixtureBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  process.env.MARKETPULSE_VLLM_BASE_URL = fixtureBase;
  process.env.MARKETPULSE_LMSTUDIO_BASE_URL = "http://127.0.0.1:9/v1"; // dead port — "not running"
  process.env.MARKETPULSE_NIM_BASE_URL = fixtureBase;
  process.env.NVIDIA_API_KEY = "wrong-key";
  delete process.env.OPENROUTER_API_KEY;
});

afterAll(() => {
  server.close();
  delete process.env.MARKETPULSE_VLLM_BASE_URL;
  delete process.env.MARKETPULSE_LMSTUDIO_BASE_URL;
  delete process.env.MARKETPULSE_NIM_BASE_URL;
  delete process.env.NVIDIA_API_KEY;
});

describe("wire-driven detection ladder", () => {
  it("states each provider's truth: READY with discovered models, UNAUTHENTICATED, not-running", async () => {
    const detected = await detectProviders();
    const byId = new Map(detected.map((entry) => [entry.id, entry]));

    // Local fixture answering → READY, models DISCOVERED (never authored here).
    const vllm = byId.get("vllm-local");
    expect(vllm?.status).toBe("READY");
    expect(vllm?.models.map((model) => model.modelId)).toEqual(["fixture-small", "fixture-large"]);
    expect(vllm?.models[0]?.relativeQuality, "discovered models carry neutral priors").toBe("BASIC");

    // API provider with NO key → the stated auth-required state, with the fix in the reason.
    const openrouter = byId.get("openrouter");
    expect(openrouter?.status).toBe("UNAUTHENTICATED");
    expect(openrouter?.reason).toMatch(/OPENROUTER_API_KEY/);

    // API provider whose key the wire REJECTED → UNAUTHENTICATED with the wire's words.
    const nim = byId.get("nvidia-nim");
    expect(nim?.status).toBe("UNAUTHENTICATED");
    expect(nim?.reason).toMatch(/rejected/i);

    // Local endpoint not answering → NOT_DETECTED with the start hint, never a generic failure.
    const lmstudio = byId.get("lmstudio");
    expect(lmstudio?.status).toBe("NOT_DETECTED");
    expect(lmstudio?.reason).toMatch(/Not running/i);

    // No-adapter providers still say so.
    expect(byId.get("codex")?.status).toBe("NOT_DETECTED");
    expect(byId.get("codex")?.reason).toMatch(/No adapter/i);
  });
});

describe("wire dispatch through runAgent", () => {
  const profile: RuntimeProfile = {
    bootId: "boot_test",
    name: "CUSTOM",
    budget: {
      dailyApiBudget: 0,
      monthlyApiBudget: 0,
      maxCostPerJob: 0,
      maxParallelAgents: 1,
      maxDeepResearchJobsPerHour: 1,
      subscriptionFirst: false,
      fallbackAllowed: true,
      hardBudgetStop: true,
    },
    routing: {
      DETERMINISTIC: [],
      TIME_SERIES: [],
      CHEAP: ["vllm-local"],
      FAST: ["vllm-local"],
      RESEARCH: ["vllm-local"],
      DEEP_REASONING: ["vllm-local"],
      CODING: ["vllm-local"],
      INDEPENDENT_REVIEW: ["vllm-local"],
    },
    askOnRestart: false,
    selectedAt: new Date().toISOString(),
  };

  it("executes an OPENAI_CHAT provider with the bound model on the wire and provenance in the result", async () => {
    const detected = await detectProviders();
    const result = await runAgent({
      capability: "CHEAP",
      prompt: "say something",
      systemPrompt: "you are a fixture",
      profile,
      detected,
      model: "fixture-large",
      timeoutMs: 5_000,
    });
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
    if (!result.ok) return;
    expect(result.provider).toBe("vllm-local");
    expect(result.model).toBe("fixture-large");
    expect(result.modelVerification).toBe("RESPONSE_REPORTED");
    expect(result.text).toBe("fixture ran fixture-large");
    expect(result.tokens).toBe(28);
    expect(result.cost, "chat wires report tokens, not money — cost is never fabricated").toBeNull();
  });

  it("refuses an HTTP wire without a bound model rather than inventing an id", async () => {
    const detected = await detectProviders();
    const result = await runAgent({
      capability: "CHEAP",
      prompt: "p",
      systemPrompt: "s",
      profile,
      detected,
      model: null,
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AGENT_FAILED");
      expect(result.message).toMatch(/concrete bound model/i);
    }
  });
});
