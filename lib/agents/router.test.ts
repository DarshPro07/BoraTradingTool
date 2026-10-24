import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { overdueBy, parseJob } from "./jobs";
import { MODELS, pickModel, restingModels, restUntil, routeJob, runModel, TIERS, type RunResult } from "./router";
import { codexLockdownArgs } from "./tool-audit";

const NOW = new Date("2026-09-19T12:00:00Z");

describe("restUntil — believe a stated reset, otherwise the model's default", () => {
  it("reads 'try again in 3 days 4 hours'", () => {
    const until = restUntil("You've hit your usage limit. Try again in 3 days 4 hours.", MODELS.codex!, NOW)!;
    expect(until.getTime() - NOW.getTime()).toBe((3 * 24 + 4) * 3_600_000);
  });
  it("falls back to the default rest when no time is named", () => {
    const until = restUntil("429 RESOURCE_EXHAUSTED", MODELS.antigravity!, NOW)!;
    expect(until.getTime() - NOW.getTime()).toBe(MODELS.antigravity!.defaultRestMs);
  });
  it("is null for output that is not a quota error", () => {
    expect(restUntil("Recorded 2 sources and 1 hypothesis.", MODELS.codex!, NOW)).toBeNull();
  });
});

describe("pickModel", () => {
  it("takes the cheapest available model in the tier, skipping any at rest", () => {
    expect(pickModel("routine", new Map())).toBe("claude-haiku");
    expect(pickModel("routine", new Map([["claude-haiku", NOW]]))).toBe("codex");
    expect(pickModel("standard", new Map(), ["codex"])).toBe("codex");
  });
});

describe("routeJob — never stalls on one broken or exhausted model", () => {
  useTemporaryDatabase();

  it("falls back past a rate-limited and a failing model, records every attempt and rest", async () => {
    const outcomes: Record<string, RunResult["status"]> = { "claude-opus": "RATE_LIMITED", codex: "FAILED", "claude-sonnet": "SUCCEEDED" };
    const result = await routeJob(
      { id: "t-job", tier: "deep", prompt: "p", timeoutMs: 1_000 },
      async (spec) => ({ status: outcomes[spec.id] ?? "FAILED", output: outcomes[spec.id] === "RATE_LIMITED" ? "usage limit reached, try again in 2 hours" : "", model: spec.id, durationMs: 1 }),
    );
    expect(result?.model).toBe("claude-sonnet");
    expect(getDb().select().from(schema.agentRuns).all().map((r) => r.status)).toEqual(["RATE_LIMITED", "FAILED", "SUCCEEDED"]);
    const resting = restingModels();
    expect([...resting.keys()].sort()).toEqual(["claude-opus", "codex"]);
    expect(resting.get("claude-opus")!.getTime() - Date.now()).toBeGreaterThan(1.9 * 3_600_000);
  });
});

describe("jobs", () => {
  useTemporaryDatabase();
  const job = parseJob("---\nid: j1\nlayer: L1\ntier: routine\ncadenceMinutes: 120\n---\nDo the thing.");

  it("parses frontmatter and prompt", () => {
    expect(job).toMatchObject({ id: "j1", tier: "routine", cadenceMs: 7_200_000, prompt: "Do the thing." });
  });

  it("is due when never run, not due right after a success, due again past its cadence", () => {
    expect(overdueBy(job, NOW.getTime())).not.toBeNull();
    getDb().insert(schema.agentRuns).values({
      id: "r1", capability: "j1", provider: "gemini", model: "gemini", status: "SUCCEEDED", trigger: "SCHEDULED",
      startedAt: NOW, completedAt: NOW,
    }).run();
    expect(overdueBy(job, NOW.getTime() + 60_000)).toBeNull();
    expect(overdueBy(job, NOW.getTime() + 121 * 60_000)).not.toBeNull();
  });
});

describe("runModel — a CLI that reads stdin must not hang", () => {
  it("closes stdin, so a program waiting for end-of-input still finishes", async () => {
    // Smoke test 2026-09-19: OpenCode waited on an open stdin pipe for the full 12-minute timeout.
    const { runModel } = await import("./router");
    const waitsForEof = { ...MODELS["opencode-free"]!, command: process.execPath, args: ["-e", "process.stdin.resume();process.stdin.on('end',()=>console.log('started'))", "--"] };
    const result = await runModel(waitsForEof, "prompt", 5_000);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.output).toMatch(/started/);
  });
});

describe("review findings: tool scope and quota false positives", () => {
  it("maps a job's tools to exact Claude tool names — no marketpulse wildcard", async () => {
    const { claudeToolNames } = await import("./router");
    const names = claudeToolNames(["marketpulse_record_source", "memory_recall", "WebFetch"]);
    expect(names).toEqual(["mcp__marketpulse__marketpulse_record_source", "mcp__mem0__memory_recall", "WebFetch"]);
    expect(names.some((n) => n.endsWith("*"))).toBe(false);
  });

  it("locks unattended Claude jobs out of the shell and file writes (SEC-1, 2026-10-23)", () => {
    // Jobs read untrusted text (arXiv). --allowedTools only pre-approves; the project's allow rules
    // (Bash(node:*), Bash(npx:*), ...) would still let an injected prompt run code without a prompt.
    for (const id of ["claude-haiku", "claude-sonnet", "claude-opus"]) {
      const args = MODELS[id]!.args;
      expect(args[args.indexOf("--tools") + 1], id).toBe("WebSearch,WebFetch");
      expect(args[args.indexOf("--disallowedTools") + 1]?.split(","), id).toEqual(
        expect.arrayContaining(["Bash", "Edit", "Write", "NotebookEdit"]),
      );
      // Canary 2026-10-23: without this the job saw ~200 user/plugin MCP tools (browser control,
      // TradingView, a paid-API runner) and the project pre-allows browser_navigate.
      expect(args, id).toContain("--strict-mcp-config");
      expect(args[args.indexOf("--mcp-config") + 1], id).toBe(".mcp.json");
    }
  });

  it("keeps uncontained lanes out of every tier until a canary proves NO_SHELL (SEC-11, 2026-10-23)", () => {
    // Canary: OpenCode's "plan" agent ran `node -v`; Antigravity is unsigned and never canaried.
    for (const tier of Object.values(TIERS)) {
      expect(tier).not.toContain("opencode-free");
      expect(tier).not.toContain("antigravity");
    }
  });

  it("does not mistake a short answer that mentions quotas for a rate limit", () => {
    expect(restUntil("Reviewed 2 papers on quota-based liquidity rules.", MODELS.codex!, NOW)).toBeNull();
    expect(restUntil("You have hit your usage limit.", MODELS.codex!, NOW)).not.toBeNull();
  });
});

describe("GV-7: a Codex run records the tools it actually called (audit, 2026-10-23)", () => {
  useTemporaryDatabase();

  it("reads calls from the session log, not tool listings, and names those outside the job's list", async () => {
    // 2026-10-21: the unattended daily-review called marketpulse_record_source, which its job does not
    // list. Codex's read-only sandbox does not cover MCP tools, and nothing recorded what it called.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      await routeJob(
        { id: "daily-review", tier: "standard", prompt: "p", timeoutMs: 1_000, tools: ["marketpulse_fund_report", "memory_remember"] },
        async (spec) => {
          const now = new Date();
          const dir = path.join(home, "sessions", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"));
          fs.mkdirSync(dir, { recursive: true });
          // An interactive Codex session that started inside the run's window, in another folder.
          fs.writeFileSync(path.join(dir, "rollout-interactive.jsonl"), [
            { type: "session_meta", payload: { cwd: "C:/Users/someone/project" } },
            { type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "await tools.mcp__marketpulse__marketpulse_record_claim({});" } },
          ].map((e) => JSON.stringify(e)).join("\n"));
          fs.writeFileSync(path.join(dir, "rollout-test.jsonl"), [
            { type: "session_meta", payload: { cwd: spec.cwd } },
            { type: "response_item", payload: { type: "local_shell_call", action: { command: ["dir"] } } },
            { type: "response_item", payload: { type: "web_search_call", action: { query: "x" } } },
            { type: "response_item", payload: { type: "custom_tool_call", name: "exec", input: "const a = await tools.mcp__marketpulse__marketpulse_fund_report({});\nawait tools.mcp__marketpulse__marketpulse_record_source({ url: 'x' });" } },
            { type: "response_item", payload: { type: "custom_tool_call_output", output: '[{"name":"mcp__marketpulse__marketpulse_record_claim"}]' } },
            { type: "response_item", payload: { type: "function_call", name: "mcp__mem0__memory_remember", arguments: "{}" } },
          ].map((e) => JSON.stringify(e)).join("\n"));
          return { status: "SUCCEEDED", output: "done", model: spec.id, durationMs: 1 };
        },
      );
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    }
    const envelope = JSON.parse(getDb().select().from(schema.agentRuns).all()[0]!.envelope!);
    expect(envelope.toolsUsed, "a listed-but-uncalled tool is not a call; another folder's session is not this run").toEqual(
      ["marketpulse_fund_report", "marketpulse_record_source", "memory_remember", "shell:local_shell", "web_search"],
    );
    expect(envelope.outsideAllowlist).toEqual(["marketpulse_record_source", "shell:local_shell", "web_search"]);
  });
});

describe("SEC-6: an unattended Codex run sees only its job's tools (canaries, 2026-10-23)", () => {
  const config = [
    "[plugins.\"browser@openai-bundled\"]", "enabled = true", "",
    "[mcp_servers.docker]", "command = \"npx\"", "",
    "[mcp_servers.node_repl]", "[mcp_servers.node_repl.env]", "X = \"1\"", "",
    "[mcp_servers.marketpulse]", "[mcp_servers.mem0]", "",
  ].join("\n");

  it("switches off ChatGPT apps, every other server and every plugin, and allowlists the rest", () => {
    const args = codexLockdownArgs(["marketpulse_fund_report", "memory_recall", "WebFetch"], config);
    const overrides = args.filter((_, i) => i % 2 === 1);
    expect(args.filter((_, i) => i % 2 === 0).every((a) => a === "-c")).toBe(true);
    expect(overrides).toEqual([
      "features.apps=false",
      "mcp_servers.docker.enabled=false",
      "mcp_servers.node_repl.enabled=false",
      'mcp_servers.marketpulse.enabled_tools=["marketpulse_fund_report"]',
      'mcp_servers.mem0.enabled_tools=["memory_recall"]',
      'plugins."browser@openai-bundled".enabled=false',
    ]);
  });

  it("runModel passes them to Codex", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    fs.writeFileSync(path.join(home, "config.toml"), config);
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = home;
    try {
      const echo = { ...MODELS.codex!, command: process.execPath, args: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "--"] }; // "--": node would read -c as --check
      const result = await runModel(echo, "prompt", 10_000, home, ["marketpulse_fund_report"]);
      expect(result.output).toContain("mcp_servers.docker.enabled=false");
      expect(result.output).toContain("features.apps=false");
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    }
  });
});
