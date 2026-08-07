import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { auditToolSet } from "@/lib/governance/policy";
import { MCP_TOOL_CAPABILITIES } from "@/lib/governance/mcp-manifest";

const serverPath = path.join(process.cwd(), "dist", "mcp", "server.mjs");

describe("MarketPulse MCP stdio server", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-mcp-"));
  const client = new Client({ name: "marketpulse-test", version: "1.0.0" });

  beforeAll(async () => {
    expect(fs.existsSync(serverPath), "Build the MCP server before running its integration test.").toBe(true);
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: {
        ...process.env,
        MARKETPULSE_DB_PATH: path.join(directory, "mcp.db"),
        MARKETPULSE_TEST_MODE: "1",
      },
      stderr: "pipe",
    }));
  }, 30_000);

  afterAll(async () => {
    await client.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("classifies every served tool and exposes no financial mutation capability", async () => {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();

    // Every served tool must be classified. An unclassified tool is UNKNOWN, which the
    // governance policy denies to every non-owner actor.
    expect(names).toEqual(Object.keys(MCP_TOOL_CAPABILITIES).sort());
    const unclassified = names.filter((name) => !(name in MCP_TOOL_CAPABILITIES));
    expect(unclassified, `unclassified tools: ${unclassified.join(", ")}`).toEqual([]);

    const audit = auditToolSet(
      names.map((name) => ({ name, capability: MCP_TOOL_CAPABILITIES[name] })),
      "research_agent",
    );
    expect(audit.violations, JSON.stringify(audit.violations)).toEqual([]);
    expect(audit.passed).toBe(true);

    // No tool may name a broker action, regardless of how it is classified.
    expect(names.join(" ")).not.toMatch(/place_order|broker|approve|fill|cancel_order|secret|shell|exec/i);

    // Read tools must declare themselves read-only; write tools must stay local and
    // non-destructive so they cannot reach outside the application database.
    for (const tool of listed.tools) {
      const capability = MCP_TOOL_CAPABILITIES[tool.name];
      if (capability === "READ") {
        expect(tool.annotations?.readOnlyHint, `${tool.name} is not marked read-only`).toBe(true);
      } else {
        expect(tool.annotations?.destructiveHint, `${tool.name} is destructive`).toBe(false);
        expect(tool.annotations?.openWorldHint, `${tool.name} reaches the open world`).toBe(false);
      }
    }
  });

  it("refuses an analysis that a directional stance cannot support", async () => {
    const response = await client.callTool({
      name: "marketpulse_record_analysis",
      arguments: {
        instrumentId: "IN:XNSE:RELIANCE",
        stance: "bullish",
        conviction: 0.9,
        summary: "It looks strong and I feel good about the setup right now.",
        debate: { bull: ["momentum"], bear: [], neutral: [] },
        evidence: [{ statement: "Momentum feels strong.", epistemicStatus: "inferred" }],
        risks: [],
        invalidation: [],
      },
    });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response.content)).toMatch(/snapshotHash|required|invalid/i);
  }, 30_000);

  it("reports quant-core resources without fabricating data", async () => {
    const response = await client.callTool({
      name: "marketpulse_quantcore",
      arguments: { resource: "universe" },
    });
    const content = response.structuredContent as { ok?: boolean; code?: string; data?: unknown };
    // Either the quant core provides it, or we get an explicit code. Never silent emptiness.
    if (content.ok === false) {
      expect(["RESOURCE_NOT_PROVIDED", "QUANT_CORE_UNAVAILABLE", "RESOURCE_MALFORMED"]).toContain(content.code);
    } else {
      expect(content.data).toBeDefined();
    }
  }, 30_000);

  it("answers US and India research tools with bounded structured output", async () => {
    const calls = [
      client.callTool({ name: "marketpulse_search_instruments", arguments: { query: "Reliance" } }),
      client.callTool({ name: "marketpulse_get_quote", arguments: { instrumentId: "US:XNAS:AAPL" } }),
      client.callTool({ name: "marketpulse_get_research_snapshot", arguments: { instrumentId: "IN:XNSE:RELIANCE", format: "concise" } }),
      client.callTool({ name: "marketpulse_compare_instruments", arguments: { instrumentIds: ["US:XNAS:AAPL", "IN:XBOM:500325"], format: "concise" } }),
      client.callTool({ name: "marketpulse_get_watchlist", arguments: { format: "concise" } }),
      client.callTool({ name: "marketpulse_get_paper_portfolio", arguments: { format: "concise" } }),
      client.callTool({ name: "marketpulse_get_risk_summary", arguments: { format: "concise" } }),
    ];
    const results = await Promise.all(calls);
    for (const response of results) {
      expect(response.isError).not.toBe(true);
      expect(JSON.stringify(response.structuredContent).length).toBeLessThanOrEqual(20_000);
    }
  }, 30_000);
});
