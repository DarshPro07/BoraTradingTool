import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

/**
 * Crash recovery — REALLY kill and restart the application, then prove the
 * interrupted AutonomousRun is resumed automatically (same run id, DEGRADED,
 * interrupted jobs re-claimed, audit row written).
 *
 * This spec spawns its OWN next dev server on port 3299 with an isolated temp
 * database and dist dir — it never touches the Playwright-managed webServer
 * on 3100. No external credentials are required; the autonomous runtime is a
 * local scheduler, and killing the process is a real SIGKILL.
 *
 * The boot-recovery hook lives in `instrumentation.ts` at the repo root:
 * `register()` calls `recoverInterruptedRun()` on every server start. Without
 * that hook, a killed run stays CRASHED until an operator presses Start; with
 * it, the next boot reconciles the stale heartbeat and resumes the same run.
 */

/**
 * A port the OS says is free, chosen at run time.
 *
 * This was a hard-coded 3299 with a `test.skip` if it was occupied — so a survivor from an earlier
 * run made a REQUIRED acceptance test skip silently and permanently. A skipped crash-recovery test
 * reads as "not failed" in every summary, which is exactly the false green this suite is meant to
 * prevent. A test environment that cannot be created must fail loudly; it must never opt out.
 *
 * Binding to port 0 asks the OS for an unused port and then releases it. There is a small race
 * between release and re-bind, which is why `spawnServer` failing to come up is a FAILURE
 * (`waitForServer` rejects) rather than another skip.
 */
async function freePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("could not determine a free port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

const MUTATION = {
  "content-type": "application/json",
  "x-marketpulse-mutation": "1",
};

interface StatusResponse {
  running: boolean;
  run: { id: string; status: string; heartbeatAt: string; reason: string | null } | null;
  last: { id: string; status: string; reason: string | null } | null;
}

interface StartResponse {
  run: { id: string; status: string; governanceCeiling: string };
  created: boolean;
}

interface ChildHandles {
  pid: number;
  kill: () => void;
}

function waitForServer(port: number, timeoutMs = 240_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error(`server on ${port} never became ready`));
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

function killTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // already dead — fine
  }
}

function spawnServer(dbPath: string, distDir: string, port: number): ChildHandles {
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MARKETPULSE_DB_PATH: dbPath,
        MARKETPULSE_NEXT_DIST_DIR: distDir,
        MARKETPULSE_TEST_MODE: "1",
        QUANT_CORE_URL: "off",
        QUANT_CORE_ROOT: ".tmp/no-quant-core",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    },
  );
  // Drain stdout/stderr so the pipe never blocks the child.
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", () => undefined);
  return { pid: child.pid ?? -1, kill: () => killTree(child.pid ?? -1) };
}

test.describe("crash recovery — real kill and restart", () => {
  test("a killed server resumes the same run on restart, never a second machine", async () => {
    test.setTimeout(600_000);

    // No skip guard. The port is allocated from the OS, so "someone else is using 3299" is not a
    // condition that can arise; if a server still cannot be started, that is a failure with a
    // reason, not a silent opt-out.
    const PORT = await freePort();
    const ORIGIN = `http://127.0.0.1:${PORT}`;
    const mutationHeaders = { ...MUTATION, origin: ORIGIN };
    console.log(`[crash-recovery] allocated port ${PORT}`);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-crash-"));
    const dbPath = path.join(tmp, "crash.sqlite");
    const distDir = path.join(tmp, "next-dist");
    let server: ChildHandles | null = null;

    try {
      // 1. Boot the server fresh.
      server = spawnServer(dbPath, distDir, PORT);
      await waitForServer(PORT);

      // 2. Start the autonomous machine — a real run begins.
      const startRes = await fetch(`${ORIGIN}/api/system/start`, {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ runtimeProfile: "default" }),
      });
      expect(startRes.status).toBe(201);
      const started = (await startRes.json()) as StartResponse;
      const runId = started.run.id;
      expect(runId).toMatch(/^arun_/);
      expect(started.run.status).toMatch(/STARTING|RUNNING|DEGRADED/);

      // Confirm the run is live and heartbeating.
      const status1 = (await (await fetch(`${ORIGIN}/api/system/status`)).json()) as StatusResponse;
      expect(status1.running).toBe(true);
      expect(status1.run?.id).toBe(runId);

      // 3. SIGKILL the server process — the run dies mid-flight, no graceful stop.
      server.kill();
      server = null;
      // Give the OS a moment to reap the process and release the port.
      await new Promise((r) => setTimeout(r, 3_000));

      // 4. Age the heartbeat past the stale threshold directly in the DB.
      //    The process was really dead; we compress the 5-minute stale window.
      const stale = new Database(dbPath);
      try {
        stale
          .prepare("UPDATE autonomous_runs SET heartbeat_at = ? WHERE id = ?")
          .run(new Date(Date.now() - 360_000).toISOString(), runId);
      } finally {
        stale.close();
      }

      // 5. Respawn the same server against the same database.
      server = spawnServer(dbPath, distDir, PORT);
      await waitForServer(PORT);

      // 6. The boot hook reconciles the stale run -> CRASHED -> resume SAME run
      //    as DEGRADED with interrupted jobs re-claimed. Poll until the status
      //    reflects recovery (the reconciler runs lazily via liveRun on the
      //    first status read, then recoverInterruptedRun resumes ticking).
      let recovered: StatusResponse | null = null;
      const pollDeadline = Date.now() + 60_000;
      while (Date.now() < pollDeadline) {
        const res = await fetch(`${ORIGIN}/api/system/status`);
        recovered = (await res.json()) as StatusResponse;
        if (recovered.running && recovered.run?.id === runId && recovered.run.status === "DEGRADED") {
          break;
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }

      // 7. Assert: SAME run resumed (never a second machine), DEGRADED, reason
      //    names the interrupted work.
      expect(recovered, "server never recovered the run").not.toBeNull();
      expect(recovered!.running).toBe(true);
      expect(recovered!.run?.id).toBe(runId);
      expect(recovered!.run?.status).toBe("DEGRADED");
      expect(recovered!.run?.reason).toMatch(/[Rr]ecovering|[Ii]nterrupted/);

      // 8. The audit trail carries the recovery row — exactly-once, attributable.
      const audit = new Database(dbPath);
      try {
        const row = audit
          .prepare(
            "SELECT action, subject, detail FROM audit_events WHERE action = ? AND subject = ? ORDER BY created_at DESC LIMIT 1",
          )
          .get("autonomous_run_recover", runId) as
          | { action: string; subject: string; detail: string }
          | undefined;
        expect(row, "autonomous_run_recover audit row must exist").toBeDefined();
        expect(row!.subject).toBe(runId);
        expect(row!.detail).toMatch(/interrupted_jobs=/);
      } finally {
        audit.close();
      }

      // 9. Stop the machine cleanly through the API (teardown via the product).
      await fetch(`${ORIGIN}/api/system/stop`, {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ reason: "crash-recovery test teardown" }),
      }).catch(() => undefined);
    } finally {
      if (server) server.kill();
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });
});
