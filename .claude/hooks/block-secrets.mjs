#!/usr/bin/env node
/**
 * PreToolUse guard against writing credentials into tracked files.
 *
 * Catches the common shapes of a leaked secret before the write lands, rather than after
 * it is committed. Placeholder values are allowed so documentation and examples still work.
 */

import { readFileSync } from "node:fs";

const PATTERNS = [
  { name: "Anthropic API key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI API key", regex: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: "Claude Code OAuth token", regex: /sk-ant-oat[A-Za-z0-9_-]{10,}/ },
  { name: "AWS access key id", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", regex: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  // Length after the colon varies in practice; match a range rather than an exact width,
  // so a slightly non-standard token is still caught.
  { name: "Telegram bot token", regex: /\b\d{8,12}:[A-Za-z0-9_-]{30,45}\b/ },
  { name: "Private key block", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Generic assigned secret", regex: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i },
];

/** Obvious non-secrets: examples, placeholders and env-var references. */
const ALLOWED = [
  /your[_-]?(?:api[_-]?)?key[_-]?here/i,
  /xxx+|<[^>]+>|\.\.\.|example|placeholder|redacted|dummy|fake/i,
  /process\.env\.|import\.meta\.env\.|\$\{?[A-Z_]+\}?/,
];

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  process.exit(0);
}

const toolName = payload.tool_name ?? "";
if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(toolName)) process.exit(0);

const input = payload.tool_input ?? {};
const nestedEdits = Array.isArray(input.edits) ? input.edits.map((edit) => edit?.new_string) : [];
const candidates = [input.content, input.new_string, input.new_source, ...nestedEdits].filter(
  (value) => typeof value === "string",
);
if (candidates.length === 0) process.exit(0);

for (const text of candidates) {
  for (const { name, regex } of PATTERNS) {
    const match = regex.exec(text);
    if (!match) continue;

    const line = text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 20);
    if (ALLOWED.some((allowed) => allowed.test(line))) continue;

    deny(
      `SECURITY: ${name} detected in this write. Credentials belong in .env.local, which is gitignored ` +
        `and never read by an agent. Reference it with process.env instead.`,
    );
  }
}

process.exit(0);
