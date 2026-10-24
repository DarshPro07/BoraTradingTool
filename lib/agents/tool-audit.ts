/**
 * GV-7: which tools an unattended Codex run actually called, read from its own session log.
 *
 * Codex's `-s read-only` sandbox covers its shell and files, not MCP tools, and the router could
 * not narrow Codex's tools the way `--allowedTools` narrows Claude's. The 2026-10-23 audit of the
 * session logs found 4 of 5 scheduled runs calling tools outside their job's list, one of them a
 * write (`marketpulse_record_source`, daily-review, 2026-10-21). This makes that visible per run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Tool calls in one rollout (JSONL), in the job files' names: `marketpulse_*`, `memory_*` (mem0),
 * `<server>__<tool>` for any other MCP server, `shell:<name>` for a shell tool. A tool that only
 * appears in a listing (an `ALL_TOOLS` dump in a tool's output) is not a call.
 */
export function codexCalls(jsonl: string): string[] {
  const used = new Set<string>();
  const name = (raw: string) => raw.replace(/^marketpulse__/, "").replace(/^mem0__/, "");
  for (const line of jsonl.split("\n")) {
    let event: { payload?: { type?: string; name?: string; input?: string } };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const p = event.payload ?? {};
    // Code mode: an `exec` cell's JavaScript calls `tools.mcp__<server>__<tool>(...)`.
    if (p.type === "custom_tool_call") for (const m of String(p.input ?? "").matchAll(/tools\.mcp__([A-Za-z0-9_]+?__[A-Za-z0-9_]+)\s*\(/g)) used.add(name(m[1]!));
    if (p.type === "function_call" && p.name?.startsWith("mcp__")) used.add(name(p.name.slice(5)));
    if (p.type === "function_call" && /shell|exec_command|apply_patch/.test(p.name ?? "")) used.add(`shell:${p.name}`);
    if (p.type === "local_shell_call") used.add("shell:local_shell");
    if (p.type === "web_search_call") used.add("web_search");
  }
  return [...used].sort();
}

/**
 * The calls of the session a run started at `since` in `cwd`: the earliest rollout created at or
 * after it whose session ran in that folder (an interactive Codex session elsewhere is not this
 * run), in the day folders of `since` and of now (a run may cross midnight). Null when none is
 * found: unknown, never "no tools".
 * ponytail: runs are sequential in the agents task; two concurrent Codex runs in one folder would
 * need the session id from `codex exec --json` instead.
 */
export function codexToolsUsed(since: Date, cwd: string, home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")): string[] | null {
  const dayDir = (d: Date) => path.join(home, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
  const folder = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const sessionCwd = (text: string) => {
    try {
      return folder(String(JSON.parse(text.split("\n", 1)[0]!).payload?.cwd ?? ""));
    } catch {
      return "";
    }
  };
  const match = [...new Set([dayDir(since), dayDir(new Date())])]
    .flatMap((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => path.join(dir, f)) : []))
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ f, born: fs.statSync(f).birthtimeMs }))
    .filter((c) => c.born >= since.getTime() - 2_000)
    .sort((a, b) => a.born - b.born)
    .map((c) => fs.readFileSync(c.f, "utf8"))
    .find((text) => sessionCwd(text) === folder(cwd));
  return match === undefined ? null : codexCalls(match);
}

/**
 * SEC-6 for Codex: the `-c` overrides that narrow an unattended run to its job's tools. The canary
 * on 2026-10-23 showed the lane otherwise loads every server and plugin in the user's config.toml:
 * docker, node_repl, cua_repl, and 243 ChatGPT app tools (Gmail, Google, vidIQ, Canva) via
 * `codex_apps`. With these overrides the run listed only the job's MarketPulse tools.
 * Every other `[mcp_servers.X]` and `[plugins."X"]` in the config is switched off by name.
 * ponytail: reads table headers only, the form `codex mcp add` writes and the only one in the
 * config today. A server declared as a dotted key, an inline table or under [profiles.*] would stay
 * on; GV-7's `outsideAllowlist` is the backstop that shows it. Parse the TOML if that ever appears.
 */
export function codexLockdownArgs(tools: readonly string[], configToml: string): string[] {
  const keep: Record<string, string[]> = {
    marketpulse: tools.filter((t) => t.startsWith("marketpulse_")),
    mem0: tools.filter((t) => t.startsWith("memory_")),
  };
  const servers = [...configToml.matchAll(/^\[mcp_servers\.("?)([^\]."]+)\1\]\s*$/gm)].map((m) => m[2]!);
  const plugins = [...configToml.matchAll(/^\[plugins\."([^"]+)"\]\s*$/gm)].map((m) => m[1]!);
  return [
    "-c", "features.apps=false",
    ...servers.flatMap((s) => (s in keep ? ["-c", `mcp_servers.${s}.enabled_tools=${JSON.stringify(keep[s])}`] : ["-c", `mcp_servers.${s}.enabled=false`])),
    ...plugins.flatMap((p) => ["-c", `plugins."${p}".enabled=false`]),
  ];
}
