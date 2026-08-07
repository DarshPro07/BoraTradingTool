export type TreeOwner = "claude" | "opencode" | "shared" | "unowned";

export interface ProtectedPathRule {
  readonly pattern: string;
  readonly reason: string;
  /**
   * "always" forbids any write. "modification" forbids editing a file that already
   * exists but permits creating a new one — used for append-only directories such as
   * applied migrations, where the correct action is to add a file, not edit one.
   */
  readonly appliesTo?: "always" | "modification";
}

/**
 * Paths an autonomous actor may never modify, expressed relative to the
 * BoraTradingTool repository root. Matched by prefix or by `*` suffix.
 */
export const PROTECTED_PATHS: readonly ProtectedPathRule[] = Object.freeze([
  { pattern: "lib/governance/*", reason: "The governance policy cannot amend itself." },
  { pattern: "lib/security/*", reason: "The request trust boundary changes only under human review." },
  { pattern: "lib/trading/capabilities.ts", reason: "The disabled execution boundary is owner-set." },
  { pattern: "lib/paper/risk.ts", reason: "Risk sizing is part of the risk kernel." },
  { pattern: "lib/quantcore/contract.ts", reason: "The quant-core contract is frozen and shared with another agent." },
  { pattern: ".claude/hooks/*", reason: "Hooks enforce the policy and cannot be edited by the thing they constrain." },
  { pattern: ".claude/settings.json", reason: "Tool permissions are owner-set." },
  { pattern: ".mcp.json", reason: "MCP server permissions are owner-set." },
  { pattern: "mcp/*", reason: "MCP tools and their policy tests change the agent capability boundary." },
  { pattern: "dist/mcp/*", reason: "The generated MCP runtime is part of the capability boundary." },
  { pattern: "esbuild.mcp.mjs", reason: "The MCP build entry point is owner-reviewed." },
  { pattern: ".github/workflows/*", reason: "CI enforcement is owner-reviewed." },
  { pattern: "app/api/owner/*", reason: "Owner authentication routes are owner-reviewed." },
  { pattern: "app/api/learning/*", reason: "Learning-mode authority is owner-reviewed." },
  { pattern: "app/api/proposals/*", reason: "Proposal approval authority is owner-reviewed." },
  { pattern: "app/api/agent/config/*", reason: "Paper-risk policy routes are owner-reviewed." },
  { pattern: "app/api/agent/strategies/*", reason: "Strategy risk limits are owner-reviewed." },
  { pattern: "app/api/paper/orders/*", reason: "Paper-order authorization is owner-reviewed." },
  { pattern: "lib/paper/engine.ts", reason: "Paper-order enforcement is part of the risk kernel." },
  { pattern: "lib/paper/repository.ts", reason: "Transactional paper-risk enforcement is owner-reviewed." },
  { pattern: "lib/ai/evidence.ts", reason: "Evidence hashing and citation rules are owner-reviewed." },
  { pattern: "lib/ai/evidence-store.ts", reason: "Server-issued evidence snapshots are owner-reviewed." },
  { pattern: "lib/analyst/schema.ts", reason: "Directional evidence requirements are owner-reviewed." },
  { pattern: "lib/analyst/service.ts", reason: "Analysis provenance enforcement is owner-reviewed." },
  { pattern: "lib/learning/evolution.ts", reason: "Proposal evidence and approval gates are owner-reviewed." },
  { pattern: "lib/knowledge/repository.ts", reason: "Archived source integrity is owner-reviewed." },
  { pattern: "lib/db/migrate.ts", reason: "Migration integrity and compatibility logic are owner-reviewed." },
  { pattern: "package.json", reason: "Verification and build scripts are owner-reviewed." },
  { pattern: "vitest.config.ts", reason: "Test selection is owner-reviewed." },
  { pattern: "playwright.config.ts", reason: "Browser verification configuration is owner-reviewed." },
  { pattern: ".git/config", reason: "Git helpers can execute commands and are owner-controlled." },
  { pattern: ".git/*", reason: "Git runtime state and hooks are owner-controlled." },
  { pattern: ".gitattributes", reason: "Git filters and diff drivers are owner-controlled." },
  { pattern: "node_modules/*", reason: "Runtime dependencies cannot be patched by an autonomous agent." },
  { pattern: ".next/*", reason: "Generated application runtime cannot be patched directly." },
  { pattern: ".backups/*", reason: "Database backups may contain owner data or retired credentials." },
  { pattern: ".tmp/*", reason: "Runtime databases and test state are not agent-writable." },
  { pattern: "marketpulse.db", reason: "The owner database is not agent-writable." },
  { pattern: "marketpulse.db-wal", reason: "The owner database WAL is not agent-writable." },
  { pattern: "marketpulse.db-shm", reason: "The owner database shared-memory file is not agent-writable." },
  {
    pattern: "drizzle/*",
    reason: "Applied migrations are immutable; add a new migration instead.",
    appliesTo: "modification",
  },
  { pattern: ".env", reason: "Credentials are never read or written by an agent." },
  { pattern: ".env.local", reason: "Credentials are never read or written by an agent." },
]);

/**
 * Which agent owns which tree. Two agents work on this system concurrently:
 * Claude Code owns the TypeScript product surface, OpenCode/GPT-5.6 owns the
 * Python quant core. Neither writes the other's tree.
 */
export const TREE_OWNERSHIP: readonly { readonly prefix: string; readonly owner: TreeOwner }[] =
  Object.freeze([
    { prefix: "e:/trading_bot/runtime/bridge", owner: "shared" },
    { prefix: "e:/trading_bot", owner: "opencode" },
    { prefix: "e:/boratradingtool", owner: "claude" },
  ]);

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase();
}

function canonicalPath(value: string, base = process.cwd()): string {
  if (value.includes("\0")) throw new Error("Paths cannot contain NUL bytes.");
  const resolved = path.resolve(base, value);
  const missing: string[] = [];
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  const real = fs.existsSync(existing) ? fs.realpathSync.native(existing) : existing;
  return path.resolve(real, ...missing);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function matchesPattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  if (normalizedPattern.endsWith("/*")) {
    const prefix = normalizedPattern.slice(0, -1);
    return relativePath.startsWith(prefix);
  }
  return relativePath === normalizedPattern;
}

export interface ProtectionResult {
  readonly protected: boolean;
  readonly reason?: string;
}

export interface ProtectionOptions {
  readonly repoRoot?: string;
  /** True when the write creates a file that does not exist yet. */
  readonly isNewFile?: boolean;
}

/**
 * `path` may be absolute or relative to the BoraTradingTool repository root.
 */
export function checkProtectedPath(path: string, options: ProtectionOptions = {}): ProtectionResult {
  const { repoRoot = "E:/BoraTradingTool", isNewFile = false } = options;
  let root: string;
  let candidate: string;
  try {
    root = canonicalPath(repoRoot);
    candidate = canonicalPath(path, root);
  } catch {
    return { protected: true, reason: "The path is malformed and cannot be authorized." };
  }
  if (!isWithin(root, candidate)) {
    return { protected: true, reason: "The path resolves outside the BoraTradingTool repository." };
  }
  const relative = normalizePath(pathModuleRelative(root, candidate));

  for (const rule of PROTECTED_PATHS) {
    if (!matchesPattern(relative, rule.pattern)) continue;
    if (rule.appliesTo === "modification" && isNewFile) continue;
    return { protected: true, reason: rule.reason };
  }
  return { protected: false };
}

function pathModuleRelative(root: string, candidate: string): string {
  return path.relative(root, candidate);
}

export function resolveOwner(absolutePath: string): TreeOwner {
  let normalized: string;
  try {
    normalized = normalizePath(canonicalPath(absolutePath));
  } catch {
    return "unowned";
  }
  for (const entry of TREE_OWNERSHIP) {
    const prefix = normalizePath(canonicalPath(entry.prefix));
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return entry.owner;
    }
  }
  return "unowned";
}

export interface WriteAuthorization {
  readonly allowed: boolean;
  readonly code?: "FOREIGN_TREE" | "PROTECTED_PATH";
  readonly reason?: string;
}

/**
 * The check the pre-edit hook performs before an autonomous actor writes any file.
 */
export function authorizeWrite(
  absolutePath: string,
  agent: TreeOwner = "claude",
  options: ProtectionOptions = {},
): WriteAuthorization {
  const owner = resolveOwner(absolutePath);
  if (owner !== agent && owner !== "shared") {
    return {
      allowed: false,
      code: "FOREIGN_TREE",
      reason:
        owner === "unowned"
          ? `Path lies outside every known tree: ${absolutePath}`
          : `Path is owned by "${owner}" and must not be written by "${agent}".`,
    };
  }

  if (owner === "shared") return { allowed: true };

  const protection = checkProtectedPath(absolutePath, options);
  if (protection.protected) {
    return { allowed: false, code: "PROTECTED_PATH", reason: protection.reason };
  }

  return { allowed: true };
}
import fs from "node:fs";
import path from "node:path";
