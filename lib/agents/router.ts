/**
 * The model router: run an agent job on the cheapest available model, headless, on the owner's own
 * subscriptions and free models — and step around any model whose quota is spent until it resets.
 *
 * Owner, 2026-09-19: use Claude Max, ChatGPT Plus (Codex), Gemini Pro and free tools like OpenCode;
 * "no caps but optimised: same output, less cost"; when Codex's weekly limit is reached, carry on
 * elsewhere and come back when it resets. PRD: docs/plans/fund-os/02-product.md.
 *
 * Every CLI is started from its real entry point with `shell: false`, so a prompt is passed as one
 * argument and never re-parsed by a shell. Every run lands in `agent_runs`; every rest in
 * `audit_events` (append-only), so "why did Codex stop being used?" always has an answer.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export type Tier = "routine" | "standard" | "deep";

export interface ModelSpec {
  id: string;
  provider: "opencode" | "antigravity" | "codex" | "claude";
  /** Executable and argument prefix; the prompt is appended as the final argument. */
  command: string;
  args: string[];
  /** Rest applied when a quota error names no reset time. */
  defaultRestMs: number;
  /**
   * Where the CLI runs. Non-Claude CLIs run in an empty work folder OUTSIDE the repository, so no
   * tool of theirs can edit the code even by accident; their MCP servers are registered globally.
   * Claude runs in the repo (its MCP servers come from the project `.mcp.json`) and is confined to
   * MCP and web tools by --allowedTools.
   */
  cwd?: string;
}

const NODE = process.execPath;
const NPM = "D:/npm-global/node_modules";
const MCP_TOOLS = ["mcp__marketpulse__*", "mcp__mem0__*", "WebSearch", "WebFetch"];
const HOUR = 3_600_000;
export const AGENT_WORKDIR = "D:/marketpulse-agents/work";

export const MODELS: Record<string, ModelSpec> = {
  // Free: routine reading and summarising.
  "opencode-free": {
    id: "opencode-free", provider: "opencode",
        // The read-only "plan" agent: MCP tools yes, file edits and shell no.
    command: `${NPM}/opencode-ai/bin/opencode.exe`, args: ["run", "--agent", "plan", "-m", "opencode/nemotron-3-ultra-free"],
    defaultRestMs: HOUR / 2, cwd: AGENT_WORKDIR,
  },
  // Gemini Pro now runs through Antigravity: Gemini CLI login redirects individual accounts to it
  // (owner, 2026-09-19; agy replaced Gemini CLI on 2026-06-18). Terminal sandbox on.
  "antigravity": {
    id: "antigravity", provider: "antigravity",
    // Safe by default: plan mode, terminal sandbox, NO auto-approval. Research jobs read untrusted
    // text (arXiv), so an auto-approving agent could be steered into commands; agy has no per-tool
    // allowlist flag. If plan mode also blocks MCP writes, the job fails and the router rests agy.
    command: "C:/Users/marke/AppData/Local/agy/bin/agy.exe", args: ["--sandbox", "--mode", "plan", "--disable-slash-commands", "-p"],
    defaultRestMs: HOUR, cwd: AGENT_WORKDIR,
  },
  "codex": {
    id: "codex", provider: "codex",
    // Read-only sandbox, no approval prompts: it may read and call MCP tools, never edit the repo.
    command: NODE, args: [`${NPM}/@openai/codex/bin/codex.js`, "exec", "--skip-git-repo-check", "-s", "read-only", "-c", 'approval_policy="never"'],
    // A weekly limit rarely prints a precise reset; re-probe every 6h rather than wait a week blind.
    defaultRestMs: 6 * HOUR, cwd: AGENT_WORKDIR,
  },
  "claude-haiku": {
    id: "claude-haiku", provider: "claude",
    command: "C:/Users/marke/.local/bin/claude.exe", args: ["--model", "haiku", "--allowedTools", ...MCP_TOOLS, "-p"],
    defaultRestMs: HOUR,
  },
  "claude-sonnet": {
    id: "claude-sonnet", provider: "claude",
    command: "C:/Users/marke/.local/bin/claude.exe", args: ["--model", "sonnet", "--allowedTools", ...MCP_TOOLS, "-p"],
    defaultRestMs: HOUR,
  },
  "claude-opus": {
    id: "claude-opus", provider: "claude",
    command: "C:/Users/marke/.local/bin/claude.exe", args: ["--model", "opus", "--allowedTools", ...MCP_TOOLS, "-p"],
    defaultRestMs: HOUR,
  },
};

/** Cheapest first. A job names its tier; the router walks the list past any model at rest. */
export const TIERS: Record<Tier, string[]> = {
  routine: ["opencode-free", "antigravity", "claude-haiku", "codex"],
  standard: ["antigravity", "codex", "claude-sonnet", "opencode-free"],
  deep: ["claude-opus", "codex", "antigravity", "claude-sonnet"],
};

const QUOTA = /usage limit|rate[ -]?limit|quota|RESOURCE_EXHAUSTED|too many requests|\b429\b|limit (?:reached|exceeded)|out of credits/i;

/**
 * When a quota error says when it lifts, believe it; otherwise rest for the model's default.
 * Understands "try again in 3 days 4 hours", "resets in 45 minutes" and "resets at 3pm" / "at 17:40".
 */
export function restUntil(output: string, spec: ModelSpec, now = new Date()): Date | null {
  if (!QUOTA.test(output)) return null;
  const span = /(?:in|after)\s+((?:\d+\s*(?:days?|d|hours?|h|hrs?|minutes?|mins?|m)\b[\s,and]*)+)/i.exec(output);
  if (span) {
    let ms = 0;
    for (const [, n, unit] of span[1]!.matchAll(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\b/gi)) {
      const u = unit!.toLowerCase();
      ms += Number(n) * (u.startsWith("d") ? 24 * HOUR : u.startsWith("h") ? HOUR : 60_000);
    }
    if (ms > 0) return new Date(now.getTime() + ms);
  }
  const at = /(?:resets?|again)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(output);
  if (at) {
    let hour = Number(at[1]) % 12;
    if (at[3]?.toLowerCase() === "pm") hour += 12;
    else if (!at[3]) hour = Number(at[1]);
    const next = new Date(now);
    next.setHours(hour, Number(at[2] ?? 0), 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  return new Date(now.getTime() + spec.defaultRestMs);
}

const REST_ACTION = "agent_model_rest";

/** Models currently resting, from the append-only log (latest row per model wins). */
export function restingModels(now = new Date()): Map<string, Date> {
  const resting = new Map<string, Date>();
  const seen = new Set<string>();
  for (const row of getDb().select().from(schema.auditEvents).where(eq(schema.auditEvents.action, REST_ACTION)).orderBy(desc(schema.auditEvents.id)).all()) {
    const model = row.subject ?? "";
    if (seen.has(model)) continue;
    seen.add(model);
    const until = new Date(JSON.parse(row.detail ?? "{}").until ?? 0);
    if (until > now) resting.set(model, until);
  }
  return resting;
}

export function pickModel(tier: Tier, resting: ReadonlyMap<string, Date>, preferred?: readonly string[]): string | null {
  return [...(preferred ?? []), ...TIERS[tier]].find((id) => MODELS[id] && !resting.has(id)) ?? null;
}

export interface RunResult {
  status: "SUCCEEDED" | "FAILED" | "RATE_LIMITED" | "TIMED_OUT";
  output: string;
  model: string;
  durationMs: number;
}

/** Run one prompt on one model, headless, from the repository root (so its MCP config applies). */
export function runModel(spec: ModelSpec, prompt: string, timeoutMs: number, cwd = process.cwd()): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    // stdin closed: several CLIs read piped stdin to EOF before starting, and an open pipe that never
    // ends hung OpenCode for the full 12-minute timeout with no output (smoke test, 2026-09-19).
    const workdir = spec.cwd ?? cwd;
    fs.mkdirSync(workdir, { recursive: true });
    const child = spawn(spec.command, [...spec.args, prompt], { cwd: workdir, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout!.on("data", (chunk) => (output += chunk));
    child.stderr!.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      // A CLI spawns its own children; kill the whole tree or they outlive the run.
      if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGKILL");
      resolve({ status: "TIMED_OUT", output, model: spec.id, durationMs: Date.now() - started });
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: "FAILED", output: `${output}\n${error.message}`, model: spec.id, durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Some CLIs print a limit notice and still exit 0; a SHORT output matching is that notice, a
      // long one is an answer that merely mentions rate limits.
      const limited = QUOTA.test(output) && (code !== 0 || output.trim().length < 400);
      resolve({ status: limited ? "RATE_LIMITED" : code === 0 ? "SUCCEEDED" : "FAILED", output, model: spec.id, durationMs: Date.now() - started });
    });
  });
}

/**
 * Run a job on the best available model, falling back down its tier. A model that is rate-limited
 * rests until its reset; one that fails or times out (not logged in, crashed) rests an hour — so a
 * broken CLI cannot stall a layer. At most one attempt per model per call; every attempt recorded.
 */
export async function routeJob(
  job: { id: string; tier: Tier; prompt: string; timeoutMs: number; preferred?: string[] },
  run: typeof runModel = runModel,
): Promise<RunResult | null> {
  const tried = new Set<string>();
  let last: RunResult | null = null;
  for (;;) {
    const resting = restingModels();
    for (const id of tried) resting.set(id, new Date(8.64e15));
    const id = pickModel(job.tier, resting, job.preferred);
    if (!id) return last;
    tried.add(id);
    const spec = MODELS[id]!;
    const startedAt = new Date();
    // Each model is told who it is: a free model once filed its memories as "claude" (2026-09-19).
    const identity = `You are the "${id}" model running MarketPulse job "${job.id}". Use agent="${id}" in memory_remember.

`;
    last = await run(spec, identity + job.prompt, job.timeoutMs);
    recordRun(job.id, spec, last, startedAt);
    if (last.status === "SUCCEEDED") return last;
    const until =
      last.status === "RATE_LIMITED"
        ? restUntil(last.output, spec) ?? new Date(Date.now() + spec.defaultRestMs)
        : new Date(Date.now() + HOUR);
    getDb().insert(schema.auditEvents).values({
      actor: "agent-router", action: REST_ACTION, decision: "limited", subject: id,
      detail: JSON.stringify({ until: until.toISOString(), status: last.status, job: job.id, excerpt: last.output.slice(-300) }),
      createdAt: new Date(),
    }).run();
  }
}

function recordRun(jobId: string, spec: ModelSpec, result: RunResult, startedAt: Date): void {
  getDb().insert(schema.agentRuns).values({
    id: randomUUID(),
    capability: jobId,
    provider: spec.provider,
    model: spec.id,
    status: result.status,
    trigger: "SCHEDULED",
    agentId: jobId,
    // The tail is what matters (the answer, or the error); the full transcript is not kept.
    envelope: JSON.stringify({ durationMs: result.durationMs, outputTail: result.output.slice(-2000) }),
    refusalCode: result.status === "SUCCEEDED" ? null : result.status,
    startedAt,
    completedAt: new Date(),
  }).run();
}
