import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The hooks are the last line of enforcement and run outside the application, so they are
 * tested as the subprocesses they actually are rather than by importing their logic.
 */
function runHook(hook: string, payload: unknown): { denied: boolean; reason: string } {
  const output = execFileSync(process.execPath, [path.join(".claude", "hooks", hook)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: process.cwd(),
  }).trim();

  if (!output) return { denied: false, reason: "" };
  const parsed = JSON.parse(output) as {
    hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
  };
  return {
    denied: parsed.hookSpecificOutput?.permissionDecision === "deny",
    reason: parsed.hookSpecificOutput?.permissionDecisionReason ?? "",
  };
}

function write(file_path: string, content = "placeholder") {
  return { tool_name: "Write", tool_input: { file_path, content } };
}

describe("guard-writes hook", () => {
  it("blocks the governance policy from amending itself", () => {
    const result = runHook("guard-writes.mjs", write("E:/BoraTradingTool/lib/governance/policy.ts"));
    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/cannot amend itself/);
  });

  it("blocks the risk kernel, security boundary, hooks and MCP config", () => {
    for (const target of [
      "lib/paper/risk.ts",
      "lib/security/request.ts",
      ".claude/hooks/guard-writes.mjs",
      ".mcp.json",
      "mcp/server.ts",
      "dist/mcp/server.mjs",
      "esbuild.mcp.mjs",
      ".github/workflows/ci.yml",
      "app/api/owner/session/route.ts",
      "app/api/agent/config/route.ts",
      "app/api/paper/orders/route.ts",
      "lib/paper/repository.ts",
      "lib/ai/evidence-store.ts",
      "lib/analyst/service.ts",
      "lib/learning/evolution.ts",
      "lib/knowledge/repository.ts",
      "lib/db/migrate.ts",
      "package.json",
      ".git/config",
      ".gitattributes",
      "node_modules/example/index.js",
      ".next/server/app.js",
      ".backups/marketpulse.db",
      ".tmp/runtime.sqlite",
      "marketpulse.db-wal",
      ".env.local",
    ]) {
      expect(runHook("guard-writes.mjs", write(target)).denied, target).toBe(true);
    }
  }, 15_000);

  it("blocks writes into the Python quant core owned by the other agent", () => {
    const result = runHook("guard-writes.mjs", write("E:/Trading_BOT/src/risk/kernel.py"));
    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/OpenCode agent/);
  });

  it("allows the shared bridge directory", () => {
    expect(runHook("guard-writes.mjs", write("E:/Trading_BOT/runtime/bridge/requests/9.json")).denied).toBe(false);
  });

  it("blocks editing an applied migration but allows adding one", () => {
    expect(runHook("guard-writes.mjs", write("drizzle/0001_multi_market_paper_ai.sql")).denied).toBe(true);
    expect(runHook("guard-writes.mjs", write("drizzle/0099_future_migration.sql")).denied).toBe(false);
  });

  it("allows ordinary product files", () => {
    for (const target of ["lib/market/service.ts", "app/dashboard/page.tsx", "components/system/Panel.tsx"]) {
      expect(runHook("guard-writes.mjs", write(target)).denied, target).toBe(false);
    }
  });

  it("canonicalizes traversal before checking protected and foreign paths", () => {
    for (const target of [
      "lib/market/../governance/policy.ts",
      "app/../lib/security/request.ts",
      "E:/Trading_BOT/runtime/bridge/../../src/risk/kernel.py",
    ]) {
      expect(runHook("guard-writes.mjs", write(target)).denied, target).toBe(true);
    }
  });

  it("allows read-only verification commands and denies everything else", () => {
    for (const command of [
      "git status --short",
      "git diff HEAD",
      "npm run check",
      "npx vitest run lib/governance",
      "npx tsc --noEmit",
    ]) {
      expect(runHook("guard-writes.mjs", { tool_name: "Bash", tool_input: { command } }).denied, command).toBe(false);
    }

    for (const command of [
      "Set-Content -LiteralPath lib/governance/policy.ts -Value x",
      "git push origin main",
      "git commit -m x",
      "npm install some-package",
      "rm -rf lib",
      "node scripts/anything.mjs",
    ]) {
      expect(runHook("guard-writes.mjs", { tool_name: "Bash", tool_input: { command } }).denied, command).toBe(true);
    }
  });

  it("denies chaining, so an allowed prefix cannot smuggle a second command", () => {
    for (const command of [
      "npm run check && rm -rf .",
      "git status; git push",
      "npm run test | tee /tmp/x",
      "git status $(rm -rf .)",
    ]) {
      expect(runHook("guard-writes.mjs", { tool_name: "Bash", tool_input: { command } }).denied, command).toBe(true);
    }
  });

  it("fails closed for malformed write-tool payloads", () => {
    expect(runHook("guard-writes.mjs", { tool_name: "Write", tool_input: {} }).denied).toBe(true);
  });

  it("ignores tools that do not write files", () => {
    expect(runHook("guard-writes.mjs", { tool_name: "Read", tool_input: { file_path: ".mcp.json" } }).denied).toBe(
      false,
    );
  });
});

describe("block-secrets hook", () => {
  const secrets: [string, string][] = [
    ["Anthropic key", 'const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";'],
    ["OpenAI key", 'const key = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD";'],
    ["AWS access key", "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLX"],
    ["GitHub token", "gh_token = ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["Telegram token", "BOT=7123456789:AAEhBOweik6ad9r_QXqLLqBcLuHYPtmFDaa"],
    ["private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIB"],
  ];

  it.each(secrets)("blocks a %s", (_name, content) => {
    const result = runHook("block-secrets.mjs", write("lib/leak.ts", content));
    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/SECURITY/);
  });

  it("allows environment variable references", () => {
    expect(runHook("block-secrets.mjs", write("lib/ok.ts", "const k = process.env.ANTHROPIC_API_KEY;")).denied).toBe(
      false,
    );
  });

  it("allows documented placeholders", () => {
    expect(runHook("block-secrets.mjs", write(".env.example", "ANTHROPIC_API_KEY=your-api-key-here")).denied).toBe(
      false,
    );
  });

  it("checks Edit replacements as well as whole-file writes", () => {
    const result = runHook("block-secrets.mjs", {
      tool_name: "Edit",
      tool_input: {
        file_path: "lib/x.ts",
        old_string: "const key = '';",
        new_string: 'const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";',
      },
    });
    expect(result.denied).toBe(true);
  });

  it("checks every nested MultiEdit replacement", () => {
    const result = runHook("block-secrets.mjs", {
      tool_name: "MultiEdit",
      tool_input: {
        file_path: "lib/x.ts",
        edits: [
          { old_string: "safe", new_string: "still safe" },
          { old_string: "empty", new_string: 'const key = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD";' },
        ],
      },
    });
    expect(result.denied).toBe(true);
  });
});
