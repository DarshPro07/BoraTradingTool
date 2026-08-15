import http from "node:http";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

/**
 * Provider transport families, proven THROUGH THE PRODUCT (the Local family's representative
 * proof): this spec runs a real OpenAI-compatible fixture upstream, boots the application with
 * the local-provider env pointing at it, and asserts the product's own /api/brain surface tells
 * the whole detection-ladder truth — READY with DISCOVERED models for the answering local
 * provider, UNAUTHENTICATED-with-the-fix for unconfigured API providers, and the no-adapter
 * statement for wireless ones. The CLI family's live proof is the golden suite itself; the API
 * families' wire contracts are pinned by lib/runtime/transports tests.
 */

async function freePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (typeof address === "string" || address === null) {
        probe.close();
        reject(new Error("no port"));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

interface ChildHandles {
  pid: number;
  kill: () => void;
  hasExited: () => boolean;
  stderrTail: () => string;
}

function killTree(pid: number): void {
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    else process.kill(pid, "SIGKILL");
  } catch {
    // already dead
  }
}

function spawnServer(
  dbPath: string,
  distDir: string,
  port: number,
  extraEnv: Record<string, string>,
  mode: "start" | "dev",
): ChildHandles {
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", mode, "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MARKETPULSE_DB_PATH: dbPath,
        MARKETPULSE_NEXT_DIST_DIR: distDir,
        MARKETPULSE_TEST_MODE: "1",
        QUANT_CORE_URL: "off",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    },
  );
  const stderrLines: string[] = [];
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim().length === 0) continue;
      stderrLines.push(line.slice(0, 300));
      if (stderrLines.length > 25) stderrLines.shift();
    }
  });
  return {
    pid: child.pid ?? -1,
    kill: () => killTree(child.pid ?? -1),
    hasExited: () => exited,
    stderrTail: () => stderrLines.join("\n") || "(stderr empty)",
  };
}

function waitForServer(handles: ChildHandles, port: number, timeoutMs = 240_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (handles.hasExited()) {
        reject(new Error(`server exited before ready.\n${handles.stderrTail()}`));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`server on ${port} never became ready.\n${handles.stderrTail()}`));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/system/identity`);
        if (res.ok) {
          resolve();
          return;
        }
      } catch {
        // not up yet
      }
      setTimeout(tick, 1_000);
    };
    tick();
  });
}

interface ProviderRow {
  id: string;
  status: string;
  reason: string;
  models: { modelId: string }[];
}

test.describe("provider transports — the local family through the product", () => {
  test("detection ladder truth on /api/brain with a real fixture upstream", async () => {
    test.setTimeout(360_000);

    // The fixture upstream: a real OpenAI-compatible wire on a real port.
    const upstream = http.createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "fixture-7b" }, { id: "fixture-70b" }] }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamBase = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;

    const PORT = await freePort();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-providers-"));
    const dbPath = path.join(tmp, "providers.sqlite");

    // Compilation must stay OUT of the readiness path. Master run 12 failed here: this spec's
    // `next dev` child sat in a FULL Turbopack recompile — the crash specs' dev boots had
    // appended fresh `.tmp/crash-dist-*` include globs to tsconfig.json mid-run (15:37),
    // invalidating the compile cache — while the ambient server ran queue-tail model calls, and
    // 240s expired with the child alive and mid-compile (dist manifests written 16:28-16:29,
    // stderr empty; boots measured 36.9s → 36.9s → 57.1s → >240s across runs 8/9/10/12). A
    // recompile under co-load is unbounded, so no honest budget exists for it. Inside an
    // acceptance run the prebuilt dist the ambient server itself serves is already on disk —
    // `next start` serves it without compiling (post-fix, the whole test measured 38.4s cold /
    // 11.8s warm; the child alone reached identity-ready in 7s) and the child then
    // runs the EXACT acceptance build rather than a parallel dev compile of the tree.
    // Standalone (no prebuilt dist) keeps the dev path; the master run remains the completion
    // authority if that dist is ever stale.
    const prebuiltDist = path.join(".tmp", "next-e2e-30stock");
    const usePrebuilt = fs.existsSync(path.join(prebuiltDist, "BUILD_ID"));
    const distDir = usePrebuilt ? prebuiltDist : path.join(".tmp", "provider-transports-dist");
    let server: ChildHandles | null = null;

    try {
      server = spawnServer(dbPath, distDir, PORT, {
        MARKETPULSE_VLLM_BASE_URL: upstreamBase,
        // A dead port: the not-running ladder state, distinguished from auth and from failure.
        MARKETPULSE_LMSTUDIO_BASE_URL: "http://127.0.0.1:9/v1",
      }, usePrebuilt ? "start" : "dev");
      await waitForServer(server, PORT);

      const res = await fetch(`http://127.0.0.1:${PORT}/api/brain`);
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { providers?: ProviderRow[] };
      const providers = body.providers ?? [];
      expect(providers.length, "the brain surface must list the provider registry").toBeGreaterThanOrEqual(10);
      const byId = new Map(providers.map((row) => [row.id, row]));

      // The answering local provider: READY, with the fixture's DISCOVERED models.
      const vllm = byId.get("vllm-local");
      expect(vllm?.status).toBe("READY");
      expect(vllm?.models.map((model) => model.modelId).sort()).toEqual(["fixture-70b", "fixture-7b"]);

      // The unconfigured API provider: the stated auth-required state with the fix, not a failure.
      const openrouter = byId.get("openrouter");
      expect(openrouter?.status).toBe("UNAUTHENTICATED");
      expect(openrouter?.reason).toMatch(/OPENROUTER_API_KEY/);

      // The not-running local provider: NOT_DETECTED with the start hint.
      const lmstudio = byId.get("lmstudio");
      expect(lmstudio?.status).toBe("NOT_DETECTED");
      expect(lmstudio?.reason).toMatch(/Not running/i);

      // The wireless provider still states its truth.
      const codex = byId.get("codex");
      expect(codex?.status).toBe("NOT_DETECTED");
      expect(codex?.reason).toMatch(/No adapter/i);
    } finally {
      if (server) server.kill();
      upstream.close();
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // best-effort; the stable dist dir is deliberately kept
      }
    }
  });
});
