import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { emit } from "@/lib/brain/event-bus";
import {
  PROVIDER_IDS,
  descriptorFor,
  type CatalogModel,
  type DetectedProvider,
  type ProviderId,
} from "./providers";
import { DETERMINISTIC_ENGINE, route, type Capability, type RuntimeProfile } from "./routing";

/**
 * The Agent Gateway (owner architecture 2026-08-10 21:55; DECISIONS 22:00).
 *
 *   Browser → Next.js API → **this module** → agent process
 *
 * The browser never executes an agent binary and never holds a credential. Two mechanisms were
 * explicitly separated in DECISIONS and only one is permitted here:
 *
 *   PROHIBITED — lifting a Pro/Max OAuth token into the app's own HTTP client, which would make
 *   MarketPulse an unauthorised API client under the 2026-02-19 consumer terms.
 *
 *   ADOPTED — spawning the Claude Code binary the owner is licensed to use, in its documented
 *   headless mode, on the owner's own machine. Claude Code stays the authorised client and owns
 *   its credential; this process only sees stdin and stdout. Conditional on MarketPulse remaining
 *   local, single-owner and undistributed — if that ever changes, the Console-API-key adapter
 *   replaces this one and nothing above the gateway has to change.
 *
 * Everything above this module asks for a CAPABILITY. No caller names a vendor, so swapping the
 * adapter is configuration.
 */

/**
 * Find the CLI without requiring the owner to configure anything.
 *
 * The native installer puts Claude Code in ~/.local/bin, which Git Bash adds to ITS shell PATH —
 * so `claude --version` works in a terminal while the Next.js server process, started by Windows,
 * cannot see it at all. That asymmetry is why the first live run failed with ENOENT despite a
 * working CLI two feet away. Order: explicit override, then PATH, then the installer's documented
 * location derived from the user's own home directory (never a hardcoded absolute path).
 */
function resolveClaudeBin(): string {
  const override = process.env.MARKETPULSE_CLAUDE_BIN?.trim();
  if (override) return override;

  const bare = process.platform === "win32" ? "claude.exe" : "claude";
  const installed = join(homedir(), ".local", "bin", bare);
  return existsSync(installed) ? installed : bare;
}

const CLAUDE_BIN = resolveClaudeBin();

/**
 * An ALIAS, not a model id — the CLI resolves it to whatever that tier currently is, so the app
 * benefits from a newer model without a source change. The id that actually ran is DISCOVERED
 * from the run's own usage report (see `pickModelId`) and that is what gets recorded as
 * provenance. providers.ts forbids model-id literals; an alias is a routing knob.
 */
const CLAUDE_MODEL_ALIAS = process.env.MARKETPULSE_CLAUDE_MODEL ?? "sonnet";

const DEFAULT_TIMEOUT_MS = 240_000;

export interface AgentRunRequest {
  capability: Capability;
  /** The user/task message. Passed on stdin, so no shell escaping is involved. */
  prompt: string;
  /** Replaces the CLI's default system prompt — this is an API call, not a coding session. */
  systemPrompt: string;
  profile: RuntimeProfile;
  detected: readonly DetectedProvider[];
  timeoutMs?: number;
}

export interface AgentRunSuccess {
  ok: true;
  provider: ProviderId;
  /** The model that actually served the call, as reported by the run. Never assumed. */
  model: string;
  text: string;
  runId: string;
  sessionId: string | null;
  tokens: number | null;
  /** As reported by the provider, in the provider's own currency. Never converted here. */
  cost: number | null;
  costCurrency: "USD" | "INR" | null;
  startedAt: string;
  completedAt: string;
  /** Non-null only when the provider that ran is not the one first requested. */
  fallbackReason: string | null;
  /**
   * Latency attribution, straight from the provider's own report.
   *
   * A research call was measured at 9.5–11 minutes end to end, and nothing recorded WHERE those
   * minutes went — the CLI payload carries `duration_api_ms` and `num_turns` and both were being
   * discarded. Without them "the model is slow" and "we are slow around the model" are
   * indistinguishable, and a trivial `claude -p` call on this machine returns in 5.6s total
   * (`duration_api_ms` 2980), so the difference is worth attributing rather than assuming.
   *
   * `apiDurationMs` is time the provider spent in the API. `wallDurationMs` is what we observed
   * around the subprocess. The gap between them is OUR overhead: process spawn, stdin write,
   * stdout drain, JSON parse. `turns` exposes an agent loop that ran more times than expected.
   */
  apiDurationMs: number | null;
  wallDurationMs: number;
  turns: number | null;
}

export interface AgentRunFailure {
  ok: false;
  code:
    | "PROVIDER_UNAVAILABLE"
    | "BUDGET_EXHAUSTED"
    | "ADAPTER_MISSING"
    | "AGENT_FAILED"
    | "AGENT_TIMEOUT"
    | "UNPARSEABLE_RESULT";
  message: string;
  attempted: { provider: ProviderId; reason: string }[];
}

export type AgentRunResult = AgentRunSuccess | AgentRunFailure;

/**
 * Probe what this machine can actually serve right now.
 *
 * Only claude-code is probed for real, because it is the only adapter that exists. Every other
 * provider reports NOT_DETECTED with the reason — an unimplemented adapter must never look like
 * an unavailable one, and neither may quietly disappear from the list.
 */
export async function detectProviders(now = new Date()): Promise<DetectedProvider[]> {
  const detectedAt = now.toISOString();
  const claude = await probeClaudeCode(detectedAt);

  const others = PROVIDER_IDS.filter((id) => id !== "claude-code").map<DetectedProvider>((id) => ({
    id,
    status: "NOT_DETECTED",
    reason: `No adapter is implemented for ${descriptorFor(id).displayName} yet. ${descriptorFor(id).enableHint}`,
    models: [],
    quota: null,
    detectedAt,
  }));

  return [claude, ...others];
}

async function probeClaudeCode(detectedAt: string): Promise<DetectedProvider> {
  const probe = await execCapture(CLAUDE_BIN, ["--version"], "", 20_000);

  if (!probe.ok) {
    return {
      id: "claude-code",
      status: "NOT_DETECTED",
      reason: `Claude Code CLI did not respond to --version: ${probe.message}`,
      models: [],
      quota: null,
      detectedAt,
    };
  }

  // Version string only — the CLI does not enumerate models, so the catalog stays empty until a
  // run reports what it used. Inventing a model list here is exactly the fabrication the registry
  // exists to prevent.
  return {
    id: "claude-code",
    status: "READY",
    reason: `Claude Code CLI present (${probe.stdout.trim() || "version not reported"}), authenticated by the CLI itself.`,
    models: [] as CatalogModel[],
    quota: null,
    detectedAt,
  };
}

/**
 * Run one capability through whichever provider the profile routes it to.
 *
 * The route decision and the run are deliberately separate: `route()` decides and records WHY,
 * this function only executes what it was handed. A refusal from either stage carries the full
 * attempt trail rather than a fallback nobody can see.
 */
export async function runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
  const decision = route(request.capability, request.detected, request.profile);

  if (!decision.ok) {
    return { ok: false, code: decision.code, message: decision.message, attempted: decision.attempted };
  }
  if (decision.resolved === DETERMINISTIC_ENGINE) {
    return {
      ok: false,
      code: "ADAPTER_MISSING",
      message:
        "DETERMINISTIC work is answered by the quant core, not by an agent. Routing arithmetic " +
        "through a language model is refused by design.",
      attempted: [],
    };
  }
  if (decision.resolved !== "claude-code") {
    return {
      ok: false,
      code: "ADAPTER_MISSING",
      message: `${decision.resolved} was routed for ${request.capability} but no adapter is implemented for it yet. The work is refused rather than silently served by a different provider.`,
      attempted: [{ provider: decision.resolved, reason: "adapter not implemented" }],
    };
  }

  emit({ kind: "MODEL_SELECTED", provider: decision.resolved, model: CLAUDE_MODEL_ALIAS, capability: request.capability, reason: decision.fallbackReason ?? "primary" });
  emit({ kind: "AGENT_STARTED", agentId: `agt_${randomUUID().replace(/-/g, "").slice(0, 12)}`, capability: request.capability, provider: decision.resolved });

  const result = await runClaudeCode(request, decision.fallbackReason);

  if (result.ok) {
    emit({ kind: "AGENT_COMPLETED", agentId: result.runId, result: "success", tokens: result.tokens, cost: result.cost });
    emit({ kind: "MODEL_CALL_COMPLETED", provider: result.provider, model: result.model, tokens: result.tokens ?? 0, latencyMs: new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime(), cost: result.cost });
  } else {
    emit({ kind: "AGENT_FAILED", agentId: "agent_failed", error: result.message });
    emit({ kind: "MODEL_CALL_FAILED", provider: decision.resolved, model: CLAUDE_MODEL_ALIAS, error: result.message });
  }

  return result;
}

async function runClaudeCode(
  request: AgentRunRequest,
  fallbackReason: string | null,
): Promise<AgentRunResult> {
  const startedAt = new Date().toISOString();
  const wallStart = Date.now();

  const args = [
    "-p",
    "--output-format",
    "json",
    "--model",
    CLAUDE_MODEL_ALIAS,
    // The four flags below strip this call back to a plain model call: no project settings, no
    // CLAUDE.md, no skills, no MCP servers, no tools. Measured 2026-08-10: context overhead falls
    // from ~70k to ~24k cached tokens ($0.42 → $0.15 per call). It is also a correctness control —
    // a research run must not inherit this repository's instructions and start reasoning about
    // MarketPulse's own source code instead of the instrument.
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--allowed-tools",
    "",
    "--system-prompt",
    request.systemPrompt,
  ];

  const run = await execCapture(
    CLAUDE_BIN,
    args,
    request.prompt,
    request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const completedAt = new Date().toISOString();

  if (!run.ok) {
    return {
      ok: false,
      code: run.timedOut ? "AGENT_TIMEOUT" : "AGENT_FAILED",
      message: run.message,
      attempted: [{ provider: "claude-code", reason: run.message }],
    };
  }

  let payload: ClaudeCliResult;
  try {
    payload = JSON.parse(run.stdout) as ClaudeCliResult;
  } catch {
    return {
      ok: false,
      code: "UNPARSEABLE_RESULT",
      message: `Claude Code returned output that is not JSON (${run.stdout.slice(0, 200)}).`,
      attempted: [{ provider: "claude-code", reason: "non-JSON stdout" }],
    };
  }

  if (payload.is_error || typeof payload.result !== "string") {
    return {
      ok: false,
      code: "AGENT_FAILED",
      message: `Claude Code reported an error: ${payload.subtype ?? "unknown"} ${payload.api_error_status ?? ""}`.trim(),
      attempted: [{ provider: "claude-code", reason: payload.subtype ?? "error" }],
    };
  }

  const wallDurationMs = Date.now() - wallStart;
  const apiDurationMs = typeof payload.duration_api_ms === "number" ? payload.duration_api_ms : null;

  // Logged unconditionally: a run nobody timed is a run nobody can make faster. The three numbers
  // together say whether the provider or this process owns the latency.
  console.log(
    `[gateway] claude-code wall=${wallDurationMs}ms api=${apiDurationMs ?? "?"}ms ` +
      `cli=${payload.duration_ms ?? "?"}ms turns=${payload.num_turns ?? "?"} ` +
      `tokens=${totalTokens(payload) ?? "?"}`,
  );

  return {
    ok: true,
    provider: "claude-code",
    model: pickModelId(payload),
    text: payload.result,
    runId: `agr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    sessionId: payload.session_id ?? null,
    tokens: totalTokens(payload),
    cost: typeof payload.total_cost_usd === "number" ? payload.total_cost_usd : null,
    costCurrency: typeof payload.total_cost_usd === "number" ? "USD" : null,
    startedAt,
    completedAt,
    fallbackReason,
    apiDurationMs,
    wallDurationMs,
    turns: typeof payload.num_turns === "number" ? payload.num_turns : null,
  };
}

interface ClaudeCliResult {
  is_error?: boolean;
  subtype?: string;
  api_error_status?: string | null;
  result?: unknown;
  session_id?: string;
  total_cost_usd?: number;
  /** Time the provider reports spending in the API. Was discarded; see AgentRunSuccess. */
  duration_api_ms?: number;
  /** Total time the CLI reports for the run, including its own orchestration. */
  duration_ms?: number;
  /** Agent-loop iterations. More than one on a single-shot research call is a finding. */
  num_turns?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  modelUsage?: Record<string, { outputTokens?: number }>;
}

/**
 * Which model to record when a run touched more than one.
 *
 * A headless run can delegate small internal steps to a cheaper model, so `modelUsage` often has
 * several keys. The one that produced the most output is the one that produced the answer, and
 * that is the honest attribution. Empty usage reports "unreported" rather than guessing.
 */
export function pickModelId(payload: {
  modelUsage?: Record<string, { outputTokens?: number }>;
}): string {
  const entries = Object.entries(payload.modelUsage ?? {});
  if (entries.length === 0) return "unreported";
  return entries.sort((left, right) => (right[1]?.outputTokens ?? 0) - (left[1]?.outputTokens ?? 0))[0][0];
}

function totalTokens(payload: ClaudeCliResult): number | null {
  const input = payload.usage?.input_tokens;
  const output = payload.usage?.output_tokens;
  if (typeof input !== "number" && typeof output !== "number") return null;
  return (input ?? 0) + (output ?? 0);
}

interface CaptureOk {
  ok: true;
  stdout: string;
}
interface CaptureFail {
  ok: false;
  message: string;
  timedOut: boolean;
}

/** Spawn without a shell: the prompt travels on stdin, so no argument can ever be escaped wrong. */
function execCapture(
  bin: string,
  args: readonly string[],
  stdin: string,
  timeoutMs: number,
): Promise<CaptureOk | CaptureFail> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, [...args], { shell: false, windowsHide: true });
    } catch (caught) {
      resolve({ ok: false, message: `Could not start ${bin}: ${String(caught)}`, timedOut: false });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: CaptureOk | CaptureFail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, message: `${bin} exceeded ${timeoutMs}ms and was terminated.`, timedOut: true });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish({ ok: false, message: `Could not start ${bin}: ${error.message}`, timedOut: false });
    });
    child.on("close", (code) => {
      if (code === 0) finish({ ok: true, stdout });
      else finish({ ok: false, message: `${bin} exited ${code}: ${stderr.slice(0, 400) || "no stderr"}`, timedOut: false });
    });

    child.stdin?.end(stdin);
  });
}
