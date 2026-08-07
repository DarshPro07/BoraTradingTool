import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  AUTONOMOUS_PERMITTED,
  AUTONOMOUS_PROHIBITED,
  auditToolSet,
  classifyAction,
  evaluateAutonomousAction,
  isAutonomousActor,
  type Actor,
  type LearningMode,
} from "./policy";
import { authorizeWrite, checkProtectedPath, normalizePath, resolveOwner } from "./paths";

const ALL_ACTORS: Actor[] = ["owner", "claude_interactive", "autonomous_worker", "research_agent"];
const ALL_MODES: LearningMode[] = ["off", "observing", "learning", "evolving"];

/**
 * The eleven prohibitions are the safety contract of this system. If a future change
 * removes one, this test fails loudly rather than silently widening autonomy.
 */
const REQUIRED_PROHIBITIONS = [
  "modify_risk_kernel",
  "change_loss_ceiling",
  "change_position_ceiling",
  "delete_trial_record",
  "requery_locked_holdout",
  "deploy_unreviewed_code",
  "change_mcp_permissions",
  "add_broker_mutation_tool",
  "place_order",
  "rewrite_verification_rules",
  "mark_failed_strategy_profitable",
] as const;

describe("prohibition set integrity", () => {
  it("contains every required prohibition", () => {
    const ids = AUTONOMOUS_PROHIBITED.map((action) => action.id);
    for (const required of REQUIRED_PROHIBITIONS) {
      expect(ids, `prohibition "${required}" was removed`).toContain(required);
    }
  });

  it("never lists an action as both permitted and prohibited", () => {
    const permitted = new Set(AUTONOMOUS_PERMITTED.map((action) => action.id));
    for (const prohibited of AUTONOMOUS_PROHIBITED) {
      expect(permitted.has(prohibited.id), `"${prohibited.id}" appears in both sets`).toBe(false);
    }
  });

  it("gives every prohibition a stated reason", () => {
    for (const action of AUTONOMOUS_PROHIBITED) {
      expect(action.reason.length, `"${action.id}" has no reason`).toBeGreaterThan(20);
    }
  });

  it("exposes no permitted action with a forbidden capability", () => {
    for (const action of AUTONOMOUS_PERMITTED) {
      expect(action.capability).not.toBe("FINANCIAL_MUTATION");
      expect(action.capability).not.toBe("UNKNOWN");
    }
  });
});

describe("evaluateAutonomousAction", () => {
  it("denies every prohibited action for every actor in every mode", () => {
    for (const prohibited of AUTONOMOUS_PROHIBITED) {
      for (const actor of ALL_ACTORS) {
        for (const mode of ALL_MODES) {
          const decision = evaluateAutonomousAction(prohibited.id, actor, mode);
          expect(decision.allowed, `${prohibited.id} allowed for ${actor}/${mode}`).toBe(false);
          if (!decision.allowed) expect(decision.code).toBe("ACTION_PROHIBITED");
        }
      }
    }
  });

  it("denies unknown actions by default", () => {
    const decision = evaluateAutonomousAction("exfiltrate_credentials", "autonomous_worker", "evolving");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe("ACTION_UNKNOWN");
  });

  it("denies every permitted action when learning mode is off", () => {
    for (const action of AUTONOMOUS_PERMITTED) {
      const decision = evaluateAutonomousAction(action.id, "autonomous_worker", "off");
      expect(decision.allowed, `${action.id} ran with learning mode off`).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe("MODE_INSUFFICIENT");
    }
  });

  it("allows each permitted action once its minimum mode is reached", () => {
    for (const action of AUTONOMOUS_PERMITTED) {
      const decision = evaluateAutonomousAction(action.id, "autonomous_worker", action.minimumMode);
      expect(decision.allowed, `${action.id} denied at its own minimum mode`).toBe(true);
    }
  });

  it("keeps evolving-only actions out of learning mode", () => {
    const evolvingOnly = AUTONOMOUS_PERMITTED.filter((action) => action.minimumMode === "evolving");
    expect(evolvingOnly.length).toBeGreaterThan(0);
    for (const action of evolvingOnly) {
      const decision = evaluateAutonomousAction(action.id, "autonomous_worker", "learning");
      expect(decision.allowed, `${action.id} escaped its mode gate`).toBe(false);
    }
  });

  it("classifies actions correctly", () => {
    expect(classifyAction("place_order")).toBe("prohibited");
    expect(classifyAction("discover_source")).toBe("permitted");
    expect(classifyAction("something_invented")).toBe("unknown");
  });

  it("recognises autonomous actors", () => {
    expect(isAutonomousActor("autonomous_worker")).toBe(true);
    expect(isAutonomousActor("research_agent")).toBe(true);
    expect(isAutonomousActor("owner")).toBe(false);
  });
});

describe("auditToolSet", () => {
  it("rejects financial mutation tools for non-owner actors", () => {
    const result = auditToolSet(
      [
        { name: "research.snapshot", capability: "READ" },
        { name: "broker.placeOrder", capability: "FINANCIAL_MUTATION" },
      ],
      "research_agent",
    );
    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.name)).toContain("broker.placeOrder");
  });

  it("rejects unclassified tools", () => {
    const result = auditToolSet([{ name: "mystery.tool", capability: "UNKNOWN" }], "autonomous_worker");
    expect(result.passed).toBe(false);
  });

  it("rejects external-write tools for non-owner actors", () => {
    const result = auditToolSet(
      [{ name: "publish.research", capability: "EXTERNAL_WRITE" }],
      "research_agent",
    );
    expect(result.passed).toBe(false);
  });

  it("passes a read-only tool set", () => {
    const result = auditToolSet(
      [
        { name: "research.snapshot", capability: "READ" },
        { name: "memory.recordLesson", capability: "WRITE_LOCAL" },
      ],
      "research_agent",
    );
    expect(result.passed).toBe(true);
  });
});

describe("path protection", () => {
  it("protects the governance policy from itself", () => {
    expect(checkProtectedPath("lib/governance/policy.ts").protected).toBe(true);
    expect(checkProtectedPath("E:/BoraTradingTool/lib/governance/paths.ts").protected).toBe(true);
    expect(checkProtectedPath("E:\\BoraTradingTool\\lib\\governance\\policy.ts").protected).toBe(true);
  });

  it("protects security, risk, hooks, MCP code, CI, migrations and credentials", () => {
    for (const path of [
      "lib/security/request.ts",
      "lib/trading/capabilities.ts",
      "lib/paper/risk.ts",
      ".claude/hooks/pre-edit.mjs",
      ".mcp.json",
      "mcp/server.ts",
      "mcp/server.integration.test.ts",
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
      "drizzle/0001_multi_market_paper_ai.sql",
      ".env.local",
    ]) {
      expect(checkProtectedPath(path).protected, `${path} is unprotected`).toBe(true);
    }
  });

  it("blocks editing an applied migration but allows adding a new one", () => {
    expect(checkProtectedPath("drizzle/0001_multi_market_paper_ai.sql").protected).toBe(true);
    expect(checkProtectedPath("drizzle/0002_knowledge_memory.sql", { isNewFile: true }).protected).toBe(
      false,
    );
  });

  it("keeps always-protected paths blocked even for new files", () => {
    expect(checkProtectedPath("lib/governance/new-rule.ts", { isNewFile: true }).protected).toBe(true);
    expect(checkProtectedPath(".claude/hooks/new-hook.mjs", { isNewFile: true }).protected).toBe(true);
  });

  it("leaves ordinary product files writable", () => {
    expect(checkProtectedPath("lib/market/service.ts").protected).toBe(false);
    expect(checkProtectedPath("app/dashboard/page.tsx").protected).toBe(false);
    expect(checkProtectedPath("lib/governance-not/example.ts").protected).toBe(false);
  });

  it("canonicalizes traversal before applying protected-path rules", () => {
    for (const candidate of [
      "lib/market/../governance/policy.ts",
      "app/../lib/security/request.ts",
      "E:/BoraTradingTool/app/../mcp/server.ts",
      "E:/Trading_BOT/runtime/bridge/../../src/risk/kernel.py",
    ]) {
      expect(checkProtectedPath(candidate).protected, `${candidate} bypassed protection`).toBe(true);
    }
  });
});

describe("tree ownership", () => {
  it("assigns each repository to its agent", () => {
    expect(resolveOwner("E:/BoraTradingTool/lib/market/service.ts")).toBe("claude");
    expect(resolveOwner("E:\\Trading_BOT\\src\\risk\\kernel.py")).toBe("opencode");
    expect(resolveOwner("E:/Trading_BOT/runtime/bridge/claims/claude.json")).toBe("shared");
    expect(resolveOwner("C:/Windows/System32/drivers/etc/hosts")).toBe("unowned");
  });

  it("blocks Claude from writing the Python quant core", () => {
    const decision = authorizeWrite("E:/Trading_BOT/src/scanner/factory.py", "claude");
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("FOREIGN_TREE");
  });

  it("allows Claude to write the shared bridge", () => {
    expect(authorizeWrite("E:/Trading_BOT/runtime/bridge/requests/001.json", "claude").allowed).toBe(true);
  });

  it("blocks writes outside every known tree", () => {
    expect(authorizeWrite("C:/Users/marke/.ssh/id_rsa", "claude").allowed).toBe(false);
  });

  it("blocks protected paths even inside the owned tree", () => {
    const decision = authorizeWrite("E:/BoraTradingTool/lib/governance/policy.ts", "claude");
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("PROTECTED_PATH");
  });

  it("normalises Windows and POSIX separators identically", () => {
    expect(normalizePath("E:\\BoraTradingTool\\lib")).toBe(normalizePath("e:/BoraTradingTool/lib/"));
  });
});

/**
 * Repository-wide guard, mirroring `tests/test_no_broker.py` in the Python quant core.
 * No source file may reference a broker order-mutation call.
 */
describe("no broker mutation in source", () => {
  const FORBIDDEN = [
    "place_equity_order",
    "placeEquityOrder",
    "place_crypto_order",
    "submit_order",
    "submitOrder",
    "force_close",
    "forceClose",
    "cancel_equity_order",
  ];

  const SCAN_ROOTS = ["lib", "app", "mcp", "components"];
  const SCAN_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js"];
  const repoRoot = process.cwd();

  function collectSourceFiles(dir: string, found: string[] = []): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return found;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        collectSourceFiles(full, found);
      } else if (SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
        found.push(full);
      }
    }
    return found;
  }

  it("finds source files to scan", () => {
    const files = SCAN_ROOTS.flatMap((root) => collectSourceFiles(join(repoRoot, root)));
    expect(files.length).toBeGreaterThan(20);
  });

  it("contains no broker order-mutation call anywhere in source", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of collectSourceFiles(join(repoRoot, root))) {
        if (file.endsWith(`governance${sep}policy.test.ts`)) continue;
        const contents = readFileSync(file, "utf8");
        for (const identifier of FORBIDDEN) {
          if (contents.includes(identifier)) {
            offenders.push(`${relative(repoRoot, file)} → ${identifier}`);
          }
        }
      }
    }
    expect(offenders, `broker mutation reached source:\n${offenders.join("\n")}`).toEqual([]);
  });
});
