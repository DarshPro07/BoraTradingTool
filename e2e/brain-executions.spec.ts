import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Brain execution observability, proven on a REAL TeamRun (owner acceptance #1-#17): this spec
 * boots its own server, enqueues a deep (team-marked) research job, lets the Chief-of-Staff team
 * run its REAL model calls, and then drives /brain → the execution drill-in, asserting the tree
 * tells the ledger's truth — job above team, members with assigned-vs-executed-vs-verification
 * never collapsed, artifacts by identity, dissent (or its stated absence), real timing, totals
 * reconciled, durable across reload, and no console errors.
 *
 * This is also the FIRST live team execution in the product's history — every prior Team OS
 * proof ran on injected deterministic cores. TEST_MODE serves fixture candles (labeled), but the
 * member model calls are real.
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

async function localSessionCookie(origin: string): Promise<string> {
  const res = await fetch(`${origin}/api/session`);
  if (!res.ok) throw new Error(`session bootstrap failed: ${res.status}`);
  const setCookie =
    (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()[0] ??
    res.headers.get("set-cookie") ??
    "";
  const cookie = setCookie.split(";")[0];
  if (!cookie) throw new Error("no session cookie issued");
  return cookie;
}

const SUBJECT = "IN:XNSE:HDFCBANK";

test.describe("brain execution observability — a real TeamRun, drilled", () => {
  test("the tree tells the ledger's truth end to end", async ({ page }) => {
    test.setTimeout(900_000);

    // Inside the master acceptance run a server is already up; booting a SECOND `next dev` there
    // cost a cold compile under full machine load and blew the readiness budget (master run 5).
    // Reuse the ambient product when the harness provides one — standalone runs still boot their
    // own. The crash specs keep spawning theirs; killing the server IS their subject.
    const AMBIENT = process.env.MARKETPULSE_E2E_BASE_URL?.trim() || null;
    const PORT = AMBIENT ? 0 : await freePort();
    const ORIGIN = AMBIENT ?? `http://127.0.0.1:${PORT}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-brainobs-"));
    const dbPath = path.join(tmp, "brainobs.sqlite");
    const distDir = path.join(".tmp", "brain-obs-dist");
    let server: ChildHandles | null = null;
    let teardownCookie: string | null = null;
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
    // #16 says "no console/page errors" — listening only for `pageerror` made that assertion
    // structurally incapable of failing on a console error, which is the commoner symptom.
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
    });

    try {
      if (!AMBIENT) {
        server = spawnServer(dbPath, distDir, PORT);
        await waitForServer(server, PORT);
      }

      const cookie = await localSessionCookie(ORIGIN);
      teardownCookie = cookie;
      const headers = {
        "content-type": "application/json",
        "x-marketpulse-mutation": "1",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "same-origin",
        origin: ORIGIN,
        cookie,
      };

      // Start the machine, feed it history, and hand it a DEEP (team-marked) research job.
      const started = await fetch(`${ORIGIN}/api/system/start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ runtimeProfile: "default" }),
      });
      expect(started.status).toBe(201);

      const ingest = await fetch(`${ORIGIN}/api/market/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify({ instrumentId: SUBJECT }),
      });
      expect(ingest.ok).toBe(true);

      // On a SHARED server other executions may already exist (or appear while this one runs).
      // Record them first so the assertions below can only ever land on the run this spec caused.
      const preexisting = new Set(
        (
          (await (await fetch(`${ORIGIN}/api/brain/executions`)).json()) as {
            executions: { teamRunId: string }[];
          }
        ).executions.map((execution) => execution.teamRunId),
      );

      const enqueued = await fetch(`${ORIGIN}/api/research/jobs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          kind: "instrument_research",
          payload: { instrumentId: SUBJECT, team: true },
          dedupeKey: `brainobs-${Date.now().toString(36)}`,
        }),
      });
      expect([200, 201]).toContain(enqueued.status);
      const jobId = ((await enqueued.json()) as { id: number }).id;

      // The team runs REAL model calls (3 members + synthesis). Poll the read model's own list
      // until the TeamRun completes — this is the surface under test observing itself.
      let teamRunId: string | null = null;
      const deadline = Date.now() + 600_000;
      for (;;) {
        const res = await fetch(`${ORIGIN}/api/brain/executions`);
        const body = (await res.json()) as {
          executions: { teamRunId: string; status: string; dissentCount: number }[];
        };
        const done = body.executions.find(
          (execution) => execution.status === "COMPLETED" && !preexisting.has(execution.teamRunId),
        );
        if (done) {
          teamRunId = done.teamRunId;
          break;
        }
        if (Date.now() > deadline) {
          const jobRes = await fetch(`${ORIGIN}/api/research/jobs`);
          const jobs = ((await jobRes.json()) as { jobs: { id: number; status: string; lastError: string | null }[] }).jobs;
          throw new Error(
            `no COMPLETED TeamRun within budget. executions=${JSON.stringify(body.executions)} job=${JSON.stringify(
              jobs.find((row) => row.id === jobId),
            )}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }

      // ── /brain lists the real execution ─────────────────────────────────────────────────
      await page.goto(`${ORIGIN}/brain`, { waitUntil: "domcontentloaded" });
      const panel = page.getByTestId("brain-executions");
      await expect(panel).toBeVisible();
      // OUR row by identity — not `.first()`, which on a shared server is whatever ran last.
      const row = panel.locator(`[data-testid="brain-execution-row"][href$="/${teamRunId}"]`);
      await expect(row).toContainText("HDFCBANK");
      await expect(row).toContainText("COMPLETED");

      // ── drill in: the execution tree ────────────────────────────────────────────────────
      await row.click();
      await expect(page).toHaveURL(new RegExp(`/brain/executions/${teamRunId}`));
      await expect(page.getByTestId("execution-status")).toHaveText("COMPLETED");

      // #2 the originating REAL job, its state read from the Job OS.
      const jobPanel = page.getByTestId("execution-job");
      await expect(jobPanel).toContainText(`#${jobId}`);
      await expect(jobPanel).toContainText("instrument_research");
      await expect(jobPanel).toContainText(/succeeded|running|queued/);

      // #3, #4, #5-#7: all members, definition versions, and the three binding facts uncollapsed.
      const members = page.getByTestId("execution-member");
      await expect(members).toHaveCount(4); // researcher, verifier, critic, chief synthesis
      const bindings = page.getByTestId("member-binding");
      for (let index = 0; index < 4; index += 1) {
        await expect(bindings.nth(index)).toContainText("Assigned:");
        await expect(bindings.nth(index)).toContainText("Executed:");
        await expect(bindings.nth(index)).toContainText("Verification:");
      }
      await expect(page.getByTestId("execution-tree")).toContainText(/@v?1/); // agentId@version visible

      // #8 artifacts by identity (kind + art_ id + bytes) — the drill into an artifact.
      const artifacts = page.getByTestId("member-artifacts");
      await expect(artifacts.first()).toBeVisible();
      await expect(artifacts.first()).toContainText(/art_[0-9a-f]+/);
      await expect(artifacts.first()).toContainText(/bytes/);

      // #9 dissent survives synthesis — rendered verbatim, or its absence STATED.
      const result = page.getByTestId("execution-result");
      await expect(result).toBeVisible();
      const dissent = page.getByTestId("execution-dissent");
      if ((await dissent.count()) > 0) {
        await expect(dissent).toContainText(/:/);
      } else {
        await expect(result).toContainText(/No dissent was recorded/);
      }

      // #10 real timing bars for every member.
      await expect(page.getByTestId("timeline-row")).toHaveCount(4);

      // #11 totals reconcile against child runs, with the cost honesty line.
      const totals = page.getByTestId("execution-totals");
      await expect(totals).toContainText(/reconciles with members/);
      await expect(totals).toContainText(/Tokens:/);

      // #14 durable: reload and the same tree reads back from the ledgers.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("execution-status")).toHaveText("COMPLETED");
      await expect(page.getByTestId("execution-member")).toHaveCount(4);

      // #16 no console/page errors through the whole journey.
      expect(consoleErrors, `page errors: ${consoleErrors.join(" | ")}`).toEqual([]);
    } finally {
      // Hand the machine back. On its own throwaway server the kill below took it down with the
      // process; on the SHARED acceptance server it kept ticking for the rest of the suite,
      // driving cycles and competing for the same real model calls the journey chains need.
      await fetch(`${ORIGIN}/api/system/stop`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-marketpulse-mutation": "1",
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "same-origin",
          origin: ORIGIN,
          cookie: teardownCookie ?? "",
        },
        body: JSON.stringify({ reason: "test teardown" }),
      }).catch(() => undefined);
      if (server) server.kill();
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // best-effort; stable dist dir kept
      }
    }
  });
});
