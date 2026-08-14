import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { chat, listModels } from "./openai-compatible";
import type { HttpProviderConfig } from "./contract";

/**
 * Wire-contract proof against a LOCAL FIXTURE server speaking the OpenAI-compatible format.
 * Real HTTP, fixture upstream — deliberately never presented as live-provider evidence. What it
 * pins: the request carries EXACTLY the assigned model (the binding invariant, asserted at the
 * wire), executed-model verification is honest (RESPONSE_REPORTED vs REQUEST_BOUND_ONLY), and
 * every failure normalizes into the provider-status vocabulary instead of a generic throw.
 */

let server: http.Server;
let baseUrl = "";
const seenRequests: { path: string; authorization: string | undefined; body: Record<string, unknown> }[] = [];

/** Scenario switch: the fixture behaves according to the REQUESTED model id. */
function scenarioFor(model: string | undefined): string {
  return model?.split(":")[0] ?? "echo";
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
      seenRequests.push({ path: req.url ?? "", authorization: req.headers.authorization, body });

      if (req.url === "/v1/models") {
        if (req.headers.authorization !== "Bearer good-key") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "bad key" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "fixture-small" }, { id: "fixture-large" }, { id: 42 }] }));
        return;
      }

      if (req.url === "/v1/chat/completions") {
        const scenario = scenarioFor(body.model as string | undefined);
        if (scenario === "auth401") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "revoked" } }));
          return;
        }
        if (scenario === "limited") {
          res.writeHead(429, { "content-type": "application/json", "retry-after": "17" });
          res.end(JSON.stringify({ error: { message: "slow down" } }));
          return;
        }
        if (scenario === "broken") {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "upstream exploded" } }));
          return;
        }
        if (scenario === "hang") {
          return; // never respond — the transport's timeout must fire
        }
        if (scenario === "notjson") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("<html>definitely not json</html>");
          return;
        }
        if (scenario === "anonymous") {
          // Valid answer that does NOT name its model — the REQUEST_BOUND_ONLY case.
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: "anonymous answer" } }],
              usage: { prompt_tokens: 11, completion_tokens: 3 },
            }),
          );
          return;
        }
        // echo: names its model and reports usage — the fully-verifiable case.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: body.model,
            choices: [{ message: { content: `ran ${String(body.model)}` } }],
            usage: { prompt_tokens: 21, completion_tokens: 7 },
          }),
        );
        return;
      }

      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => {
  server.close();
});

function config(apiKey: string | null = "good-key"): HttpProviderConfig {
  return { providerId: "openai-api", baseUrl, apiKey };
}

describe("openai-compatible wire contract", () => {
  it("lists models, dropping non-string ids rather than inventing them", async () => {
    const listed = await listModels(config());
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.modelIds).toEqual(["fixture-small", "fixture-large"]);
  });

  it("carries EXACTLY the assigned model on the wire and reports the echo as RESPONSE_REPORTED", async () => {
    const result = await chat(config(), {
      model: "echo:assigned-model-7",
      systemPrompt: "sys",
      prompt: "hello",
      timeoutMs: 4_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.executedModel).toBe("echo:assigned-model-7");
    expect(result.verification).toBe("RESPONSE_REPORTED");
    expect(result.usage).toEqual({ inputTokens: 21, outputTokens: 7 });

    // The binding invariant, asserted AT THE WIRE: the request body named the assigned id.
    const wire = seenRequests.find((entry) => entry.path === "/v1/chat/completions" && (entry.body.model as string)?.startsWith("echo:"));
    expect(wire?.body.model).toBe("echo:assigned-model-7");
    expect(wire?.authorization).toBe("Bearer good-key");
  });

  it("a wire that does not name its model is REQUEST_BOUND_ONLY, never dressed up", async () => {
    const result = await chat(config(), { model: "anonymous:m", systemPrompt: "s", prompt: "p", timeoutMs: 4_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.executedModel).toBeNull();
    expect(result.verification).toBe("REQUEST_BOUND_ONLY");
  });

  it("401 normalizes to UNAUTHENTICATED — a stated auth state, not a generic failure", async () => {
    const result = await chat(config(), { model: "auth401:m", systemPrompt: "s", prompt: "p", timeoutMs: 4_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNAUTHENTICATED");

    const listedWithBadKey = await listModels(config("bad-key"));
    expect(listedWithBadKey.ok).toBe(false);
    if (!listedWithBadKey.ok) expect(listedWithBadKey.code).toBe("UNAUTHENTICATED");
  });

  it("429 normalizes to QUOTA_EXHAUSTED and carries the wire's own retry-after", async () => {
    const result = await chat(config(), { model: "limited:m", systemPrompt: "s", prompt: "p", timeoutMs: 4_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("QUOTA_EXHAUSTED");
      expect(result.retryAfterSeconds).toBe(17);
    }
  });

  it("5xx is UNAVAILABLE; non-JSON is BAD_RESPONSE; a hang is TIMEOUT; a dead port is UNAVAILABLE", async () => {
    const broken = await chat(config(), { model: "broken:m", systemPrompt: "s", prompt: "p", timeoutMs: 4_000 });
    expect(!broken.ok && broken.code).toBe("UNAVAILABLE");

    const notJson = await chat(config(), { model: "notjson:m", systemPrompt: "s", prompt: "p", timeoutMs: 4_000 });
    expect(!notJson.ok && notJson.code).toBe("BAD_RESPONSE");

    const hang = await chat(config(), { model: "hang:m", systemPrompt: "s", prompt: "p", timeoutMs: 700 });
    expect(!hang.ok && hang.code).toBe("TIMEOUT");

    const dead = await chat(
      { providerId: "openai-api", baseUrl: "http://127.0.0.1:9/v1", apiKey: "k" },
      { model: "echo:m", systemPrompt: "s", prompt: "p", timeoutMs: 1_500 },
    );
    expect(!dead.ok && dead.code).toBe("UNAVAILABLE");
  });
});
