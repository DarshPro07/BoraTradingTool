import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import * as anthropic from "./anthropic-native";
import * as gemini from "./gemini-native";
import type { HttpProviderConfig } from "./contract";

/**
 * Native-wire contract proof (fixture upstream, real HTTP). The shared error normalization is
 * already pinned by the OpenAI-compatible suite; what each native wire adds is its own shape:
 * Anthropic's content BLOCKS + x-api-key + top-level system, Gemini's parts/usageMetadata/
 * modelVersion + URL-bound model id. Binding stays asserted at the wire.
 */

let server: http.Server;
let baseUrl = "";
const seen: { path: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
      seen.push({ path: req.url ?? "", headers: req.headers, body });

      // ── Anthropic wire ────────────────────────────────────────────────────────────────────
      if (req.url === "/anthropic/messages") {
        if (req.headers["x-api-key"] !== "good-key") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "bad key" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: body.model,
            content: [
              { type: "text", text: "first block. " },
              { type: "tool_use", id: "ignored" },
              { type: "text", text: "second block." },
            ],
            usage: { input_tokens: 33, output_tokens: 9 },
          }),
        );
        return;
      }
      if (req.url === "/anthropic/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "claude-fixture-1" }] }));
        return;
      }

      // ── Gemini wire ───────────────────────────────────────────────────────────────────────
      if (req.url?.startsWith("/gemini/models/") && req.url.includes(":generateContent")) {
        if (req.headers["x-goog-api-key"] !== "good-key") {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "forbidden" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            modelVersion: "gemini-fixture-001",
            candidates: [{ content: { parts: [{ text: "gemini " }, { text: "answer" }] } }],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 },
          }),
        );
        return;
      }
      if (req.url === "/gemini/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "models/gemini-fixture-001" }, { name: "models/gemini-fixture-mini" }] }));
        return;
      }

      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("anthropic-native wire", () => {
  const config = (key: string | null = "good-key"): HttpProviderConfig => ({
    providerId: "anthropic-api",
    baseUrl: `${baseUrl}/anthropic`,
    apiKey: key,
  });

  it("binds the model, sends system top-level, joins text blocks, reads native usage", async () => {
    const result = await anthropic.chat(config(), {
      model: "claude-fixture-1",
      systemPrompt: "the system prompt",
      prompt: "the question",
      timeoutMs: 4_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("first block. second block.");
    expect(result.executedModel).toBe("claude-fixture-1");
    expect(result.verification).toBe("RESPONSE_REPORTED");
    expect(result.usage).toEqual({ inputTokens: 33, outputTokens: 9 });

    const wire = seen.find((entry) => entry.path === "/anthropic/messages");
    expect(wire?.body.model).toBe("claude-fixture-1");
    expect(wire?.body.system).toBe("the system prompt");
    expect(wire?.body.max_tokens).toBeGreaterThan(0);
    expect(wire?.headers["anthropic-version"]).toBeDefined();
  });

  it("401 with the native auth header is UNAUTHENTICATED", async () => {
    const result = await anthropic.chat(config("wrong"), {
      model: "claude-fixture-1",
      systemPrompt: "s",
      prompt: "p",
      timeoutMs: 4_000,
    });
    expect(!result.ok && result.code).toBe("UNAUTHENTICATED");
  });

  it("lists models from the data[] shape", async () => {
    const listed = await anthropic.listModels(config());
    expect(listed.ok && listed.modelIds).toEqual(["claude-fixture-1"]);
  });
});

describe("gemini-native wire", () => {
  const config = (key: string | null = "good-key"): HttpProviderConfig => ({
    providerId: "gemini" as HttpProviderConfig["providerId"],
    baseUrl: `${baseUrl}/gemini`,
    apiKey: key,
  });

  it("binds the model IN THE URL, joins parts, reads usageMetadata and modelVersion", async () => {
    const result = await gemini.chat(config(), {
      model: "gemini-fixture-001",
      systemPrompt: "sys",
      prompt: "ask",
      timeoutMs: 4_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("gemini answer");
    expect(result.executedModel).toBe("gemini-fixture-001");
    expect(result.verification).toBe("RESPONSE_REPORTED");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5 });

    const wire = seen.find((entry) => entry.path.includes(":generateContent"));
    expect(wire?.path).toContain("/gemini/models/gemini-fixture-001:generateContent");
    expect((wire?.body.systemInstruction as { parts: { text: string }[] }).parts[0].text).toBe("sys");
  });

  it("403 with the native key header is UNAUTHENTICATED", async () => {
    const result = await gemini.chat(config("wrong"), {
      model: "gemini-fixture-001",
      systemPrompt: "s",
      prompt: "p",
      timeoutMs: 4_000,
    });
    expect(!result.ok && result.code).toBe("UNAUTHENTICATED");
  });

  it("lists models with the models/ prefix stripped to the requestable id", async () => {
    const listed = await gemini.listModels(config());
    expect(listed.ok && listed.modelIds).toEqual(["gemini-fixture-001", "gemini-fixture-mini"]);
  });
});
