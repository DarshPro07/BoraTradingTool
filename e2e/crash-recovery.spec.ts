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
  // Node's fetch auto-sends `sec-fetch-mode: cors` WITHOUT `sec-fetch-site`, which falls through
  // every accept branch of the boundary's Fetch-Metadata gate. This caller genuinely is a
  // same-origin loopback client, so it states that truthfully instead of arriving half-labeled.
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "same-origin",
};

/**
 * The mutation boundary (lib/security/request.ts) requires the SameSite local-session cookie the
 * server itself issues via GET /api/session. Node's fetch has no cookie jar, so this spec — which
 * talks to a server it spawned itself, outside Playwright's request fixture — must carry the
 * cookie explicitly. Without it every mutation is an honest 403 (this was the checkpoint's named
 * "auth surfaces not e2e-verified" risk, found by exactly this journey).
 */
async function localSessionCookie(origin: string): Promise<string> {
  const res = await fetch(`${origin}/api/session`);
  if (!res.ok) throw new Error(`local session bootstrap failed: HTTP ${res.status}`);
  const setCookie =
    (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()[0] ??
    res.headers.get("set-cookie") ??
    "";
  const cookie = setCookie.split(";")[0];
  if (!cookie) throw new Error("GET /api/session issued no session cookie");
  return cookie;
}

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
  /** True once the child process exited — a dead child cannot become ready, so stop polling. */
  hasExited: () => boolean;
  /** The child's last stderr lines, so a spawn failure DIAGNOSES itself instead of timing out. */
  stderrTail: () => string;
}

function waitForServer(handles: ChildHandles, port: number, timeoutMs = 240_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      // A child that died (EADDRINUSE, crash on boot) can never become ready — fail NOW with its
      // own words rather than polling a corpse for the full deadline and reporting nothing.
      if (handles.hasExited()) {
        reject(new Error(`server on ${port} exited before becoming ready.\n--- child stderr ---\n${handles.stderrTail()}`));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`server on ${port} never became ready.\n--- child stderr ---\n${handles.stderrTail()}`));
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
  // Drain stdout; keep a bounded stderr tail — the diagnosis when the server never comes up.
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
    // Next.js resolves `distDir` RELATIVE TO THE PROJECT ROOT. An absolute temp path here produced
    // `E:\BoraTradingTool\C:\Users\...` and the child died on boot with mkdir ENOENT — silently,
    // until waitForServer learned to report the child's stderr. Keep it inside the repo's .tmp.
    const distDir = path.join(".tmp", `crash-dist-${Date.now().toString(36)}`);
    let server: ChildHandles | null = null;

    try {
      // 1. Boot the server fresh.
      server = spawnServer(dbPath, distDir, PORT);
      await waitForServer(server, PORT);

      // 2. Start the autonomous machine — a real run begins. Mutations need the server-issued
      //    local-session cookie (see localSessionCookie).
      const cookie = await localSessionCookie(ORIGIN);
      const startRes = await fetch(`${ORIGIN}/api/system/start`, {
        method: "POST",
        headers: { ...mutationHeaders, cookie },
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
      //    The column is drizzle `integer(..., { mode: "timestamp" })` — EPOCH SECONDS. Writing an
      //    ISO string here (the original bug) made the readback an Invalid Date, every staleness
      //    comparison silently false, and the boot saw a "live" run to leave alone — so the
      //    recovery path under test never executed and the audit row never appeared.
      const stale = new Database(dbPath);
      try {
        stale
          .prepare("UPDATE autonomous_runs SET heartbeat_at = ? WHERE id = ?")
          .run(Math.floor((Date.now() - 360_000) / 1000), runId);
      } finally {
        stale.close();
      }

      // 5. Respawn the same server against the same database — on a FRESH port. The test's
      //    identity is the DATABASE (same run must resume), not the TCP port; reusing the killed
      //    port raced Windows TIME_WAIT / surviving turbopack children into EADDRINUSE, and the
      //    respawn then "never became ready" with no diagnosis. A new port removes the race.
      const PORT2 = await freePort();
      const ORIGIN2 = `http://127.0.0.1:${PORT2}`;
      const mutationHeaders2 = { ...MUTATION, origin: ORIGIN2 };
      console.log(`[crash-recovery] respawn on fresh port ${PORT2}`);
      server = spawnServer(dbPath, distDir, PORT2);
      await waitForServer(server, PORT2);

      // 6. The boot hook reconciles the stale run -> CRASHED -> resume SAME run
      //    as DEGRADED with interrupted jobs re-claimed. Poll until the status
      //    reflects recovery (the reconciler runs lazily via liveRun on the
      //    first status read, then recoverInterruptedRun resumes ticking).
      let recovered: StatusResponse | null = null;
      const pollDeadline = Date.now() + 60_000;
      while (Date.now() < pollDeadline) {
        const res = await fetch(`${ORIGIN2}/api/system/status`);
        recovered = (await res.json()) as StatusResponse;
        // DEGRADED is the TRANSIENT mid-recovery state; a machine that already repaired the
        // interruption reports RUNNING (health taxonomy: DEGRADED = live infrastructure fault,
        // never "recently recovered"). Both prove the SAME run resumed — racing to observe the
        // transient window made a faster recovery read as a failure.
        if (recovered.running && recovered.run?.id === runId && /DEGRADED|RUNNING/.test(recovered.run.status)) {
          break;
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }

      // 7. Assert: SAME run resumed (never a second machine). The durable proof that RECOVERY
      //    (not a fresh start) produced this state is the audit row checked in step 8.
      expect(recovered, "server never recovered the run").not.toBeNull();
      expect(recovered!.running).toBe(true);
      expect(recovered!.run?.id).toBe(runId);
      expect(recovered!.run?.status).toMatch(/DEGRADED|RUNNING/);
      if (recovered!.run?.status === "DEGRADED") {
        expect(recovered!.run?.reason).toMatch(/[Rr]ecovering|[Ii]nterrupted/);
      }

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
      const cookie2 = await localSessionCookie(ORIGIN2).catch(() => "");
      await fetch(`${ORIGIN2}/api/system/stop`, {
        method: "POST",
        headers: { ...mutationHeaders2, cookie: cookie2 },
        body: JSON.stringify({ reason: "crash-recovery test teardown" }),
      }).catch(() => undefined);
    } finally {
      if (server) server.kill();
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      try {
        fs.rmSync(distDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });
});
