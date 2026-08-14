import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

/**
 * A build identity that a running server can be asked for and held to.
 *
 * The commit alone is not enough, and the reason is the defect this exists to catch. During Task 1 a
 * stale `next start` kept the port and served the previous bundle; a fix that was genuinely applied
 * looked broken. Almost all such builds happen against a DIRTY working tree, where commit-only ids
 * are identical across every rebuild — exactly when the confusion occurs. So the working tree's
 * state is folded in: two builds differ iff their sources differ.
 */
function buildIdentity(): string | null {
  const override = process.env.MARKETPULSE_GIT_COMMIT?.trim();
  if (override) return override;

  const commit = git(["rev-parse", "--short", "HEAD"])?.trim();
  if (!commit) return null;

  // `status --porcelain` carries untracked files (which `diff` does not); `diff HEAD` carries the
  // content of staged and unstaged edits. Together they pin the tree the bundle was compiled from.
  const dirt = `${git(["status", "--porcelain"]) ?? ""}${git(["diff", "HEAD"]) ?? ""}`;
  if (!dirt.trim()) return commit;
  return `${commit}-dirty.${createHash("sha256").update(dirt).digest("hex").slice(0, 8)}`;
}

const buildId = buildIdentity();
const appVersion = (JSON.parse(readFileSync("./package.json", "utf8")) as { version: string }).version;

const nextConfig: NextConfig = {
  // Local Playwright can run beside the owner's dev server without sharing Next's lock/cache.
  distDir: process.env.MARKETPULSE_NEXT_DIST_DIR?.trim() || ".next",
  // Inlined at build time so the running server can report its own identity without reading `.git`,
  // which would not exist in a deployed artifact and would describe the host rather than the bundle.
  env: {
    MARKETPULSE_BUILD_ID: buildId ?? "",
    MARKETPULSE_APP_VERSION: appVersion,
  },
  // Keeps Next's own notion of the build and ours from drifting apart.
  generateBuildId: async () => buildId ?? "unpinned",
};

export default nextConfig;
