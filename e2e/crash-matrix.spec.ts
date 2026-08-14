import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

/**
 * C39 — the EXTENDED crash matrix: kill the server while real work is mid-flight, restart it,
 * and prove exactly-once effects across every ledger.
 *
 * `crash-recovery.spec.ts` proves the RUN resumes. This spec proves the WORK survives:
 *
 *   - kill DURING a real model call (`instrument_research` claimed, CLI in flight, ledger empty)
 *   - with the whole job family queued behind it in the same drain lane:
 *     `backtest` (real spec, real snapshot), `validation` (confirmed:true — refused by the
 *     Trial Budget Governor, which is OFF here, spending NOTHING), `paper_reconcile`,
 *     `forecast_resolve`, `memory_validate`
 *
 * After restart: the same run recovers, the interrupted job is reclaimed by lease expiry and
 * completes EXACTLY ONCE (one COMPLETED AgentRun for its jobId), the deterministic jobs each
 * reach their truthful terminal exactly once, zero trials are spent through crash + restart +
 * three governor refusals, and nothing invents a forward signal or paper order.
 *
 * The intra-handler partial-write windows (e.g. between recordAgentRun and completeJob) are
 * covered by SQLite transactionality and per-ledger idempotence constraints — the scope split is
 * recorded in docs/plans/crash-matrix/00-status.md rather than silently claimed here.
 */

const SUBJECT = "IN:XNSE:RELIANCE";
const RUN_STAMP = Date.now().toString(36);

/** 09:15 IST on Monday 2026-08-03 as unix seconds — the proven dataset-ledger session shape. */
const SESSION_OPEN_UTC = Date.UTC(2026, 7, 3, 3, 45, 0) / 1000;

/** A real, compilable strategy over the 5m bars this spec seeds (dataset-ledger's proven DSL). */
const DSL = {
  universe: { market: "NSE", maxPositions: 4, resolution: "5m" },
  entry: { all: [{ feature: "minutes_since_open", op: "gte", value: 15 }] },
  exit: { stopLossPct: 0.5, takeProfitPct: 1 },
  sizing: { maxPositionPct: 25 },
  costs: { commissionBps: 5, slippageBps: 7, assumedSpreadBps: 5 },
};

const MUTATION = {
  "content-type": "application/json",
  "x-marketpulse-mutation": "1",
  // Node fetch sends `sec-fetch-mode: cors` with NO `sec-fetch-site`; the boundary's
  // Fetch-Metadata gate then refuses. This caller IS a same-origin loopback client — say so.
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "same-origin",
};

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

/** The mutation boundary requires the server-issued local-session cookie (GET /api/session). */
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

interface ChildHandles {
  pid: number;
  kill: () => void;
  hasExited: () => boolean;
  stderrTail: () => string;
}

function waitForServer(handles: ChildHandles, port: number, timeoutMs = 240_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (handles.hasExited()) {
        reject(new Error(`server on ${port} exited before ready.\n--- stderr ---\n${handles.stderrTail()}`));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`server on ${port} never became ready.\n--- stderr ---\n${handles.stderrTail()}`));
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

/** Tree-kill: takes the in-flight Claude CLI child down with its server — a whole-machine crash. */
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
        // Deliberately ABSENT: MARKETPULSE_AUTONOMOUS_TRIALS. The governor must refuse the
        // confirmed validation job without spending — that refusal is one of the assertions.
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

interface JobRow {
  id: number;
  kind: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
}

async function fetchJobs(origin: string): Promise<JobRow[]> {
  const res = await fetch(`${origin}/api/research/jobs`);
  if (!res.ok) throw new Error(`GET /api/research/jobs -> ${res.status}`);
  return ((await res.json()) as { jobs: JobRow[] }).jobs;
}

function count(db: Database.Database, sql: string, ...args: unknown[]): number {
  return (db.prepare(sql).get(...args) as { n: number }).n;
}

test.describe("crash matrix — kill mid-flight, recover, exactly-once", () => {
  test("a mid-model-call kill with the job family in flight recovers to exactly-once effects", async () => {
    test.setTimeout(720_000);

    const started = Date.now();
    const stamp = (label: string) =>
      console.log(`[matrix] +${((Date.now() - started) / 1000).toFixed(1)}s ${label}`);

    const PORT = await freePort();
    const ORIGIN = `http://127.0.0.1:${PORT}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-matrix-"));
    const dbPath = path.join(tmp, "matrix.sqlite");
    // Project-relative (Next resolves distDir against the project root) and STABLE — a stamped
    // name made Next append one tsconfig types-include per run, forever.
    const distDir = path.join(".tmp", "crash-matrix-dist");
    let server: ChildHandles | null = null;

    try {
      // ── Phase 0: boot + start the machine ────────────────────────────────────────────────
      server = spawnServer(dbPath, distDir, PORT);
      await waitForServer(server, PORT);
      stamp(`server A up on ${PORT}`);

      const cookie = await localSessionCookie(ORIGIN);
      const headers = { ...MUTATION, origin: ORIGIN, cookie };

      const startRes = await fetch(`${ORIGIN}/api/system/start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ runtimeProfile: "default" }),
      });
      expect(startRes.status).toBe(201);
      const runId = ((await startRes.json()) as { run: { id: string } }).run.id;
      expect(runId).toMatch(/^arun_/);
      stamp(`machine started: ${runId}`);

      // ── Phase 1: seed — real history for research, real bars + spec for the backtest ─────
      const ingest = await fetch(`${ORIGIN}/api/market/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify({ instrumentId: SUBJECT }),
      });
      expect(ingest.ok, `ingest ${SUBJECT} -> ${ingest.status}`).toBe(true);
      stamp(`ingested history for ${SUBJECT}`);

      {
        // 5-minute bars for the strategy's snapshot (dataset-ledger's proven deterministic shape).
        const db = new Database(dbPath);
        try {
          const have = count(
            db,
            "SELECT COUNT(*) AS n FROM price_candles WHERE ticker = ? AND resolution = '5'",
            SUBJECT,
          );
          if (have < 300) {
            const insert = db.prepare(
              "INSERT INTO price_candles (ticker, resolution, time, open, high, low, close, volume) VALUES (?, '5', ?, ?, ?, ?, ?, 1000)",
            );
            db.transaction(() => {
              let price = 100;
              for (let session = 0; session < 4; session += 1) {
                const open = SESSION_OPEN_UTC + session * 86_400;
                for (let bar = 0; bar < 75; bar += 1) {
                  price += 0.4;
                  insert.run(SUBJECT, open + bar * 300, price - 0.2, price + 0.6, price - 0.6, price);
                }
              }
            })();
          }
        } finally {
          db.close();
        }
      }

      const authored = await fetch(`${ORIGIN}/api/strategy/author`, {
        method: "POST",
        headers,
        body: JSON.stringify({ dsl: { ...DSL, name: `crash_matrix_${RUN_STAMP}` }, createdBy: "e2e" }),
      });
      expect(authored.status, "strategy author").toBe(201);
      const specId = ((await authored.json()) as { id: string }).id;
      stamp(`authored spec ${specId}`);

      // ── Phase 2: the flight — six kinds, research first so a REAL model call holds the lane ─
      const enqueue = async (kind: string, payload: Record<string, unknown>, priority: number) => {
        const res = await fetch(`${ORIGIN}/api/research/jobs`, {
          method: "POST",
          headers,
          body: JSON.stringify({ kind, payload, priority, dedupeKey: `cm-${RUN_STAMP}-${kind}` }),
        });
        expect([200, 201], `enqueue ${kind} -> ${res.status}`).toContain(res.status);
        return ((await res.json()) as { id: number }).id;
      };

      const researchJobId = await enqueue("instrument_research", { instrumentId: SUBJECT }, 1);
      const backtestJobId = await enqueue("backtest", { specId }, 50);
      const validationJobId = await enqueue("validation", { specId, confirmed: true }, 55);
      const paperJobId = await enqueue("paper_reconcile", {}, 60);
      const forecastJobId = await enqueue("forecast_resolve", {}, 65);
      const memoryJobId = await enqueue("memory_validate", {}, 70);
      stamp(`flight enqueued: research=${researchJobId} backtest=${backtestJobId} validation=${validationJobId}`);

      // Wait until the research job is genuinely mid-model-call: claimed (running) and the
      // AgentRun ledger still empty — the call has started and nothing has been recorded.
      const claimDeadline = Date.now() + 90_000;
      let claimed = false;
      while (Date.now() < claimDeadline) {
        const jobs = await fetchJobs(ORIGIN);
        const research = jobs.find((j) => j.id === researchJobId);
        if (research?.status === "running") {
          claimed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1_000));
      }
      expect(claimed, "research job was never claimed — the drain lane did not start").toBe(true);
      // Let the CLI genuinely get into flight (spawn + evidence packet ≈ sub-second; the model
      // call itself runs 45–70s — six seconds in, we are unambiguously mid-call).
      await new Promise((r) => setTimeout(r, 6_000));
      {
        const db = new Database(dbPath, { readonly: true });
        try {
          expect(
            count(db, "SELECT COUNT(*) AS n FROM agent_runs"),
            "AgentRun ledger must still be empty mid-call — the kill must precede persistence",
          ).toBe(0);
        } finally {
          db.close();
        }
      }
      stamp("research mid-call, ledger empty — KILLING the server tree");

      // ── Phase 3: the crash ───────────────────────────────────────────────────────────────
      const killedAtMs = Date.now();
      server.kill();
      server = null;
      await new Promise((r) => setTimeout(r, 3_000));

      const preKillStatus = new Map<number, { status: string; attempts: number }>();
      {
        const db = new Database(dbPath);
        try {
          // The orphaned truth: the RESEARCH job died mid-call holding a worker.
          const orphan = db
            .prepare("SELECT status, attempts FROM research_jobs WHERE id = ?")
            .get(researchJobId) as { status: string; attempts: number };
          expect(orphan.status).toBe("running");
          expect(orphan.attempts).toBe(1);
          // The co-flight jobs are drained by TWO concurrent workers BY DESIGN (the event-driven
          // research lane and the cycle's embedded worker, under separate leases) — so at kill
          // time each is legitimately queued, already succeeded, mid-run under the second worker,
          // or (validation) already dead of its fast governor refusals. Record the truth; the
          // exactly-once audit below is the invariant, not a single-lane timing assumption.
          for (const id of [backtestJobId, validationJobId, paperJobId, forecastJobId, memoryJobId]) {
            const row = db
              .prepare("SELECT status, attempts FROM research_jobs WHERE id = ?")
              .get(id) as { status: string; attempts: number };
            expect(
              ["queued", "running", "succeeded", "dead"],
              `job ${id} in an impossible state at crash time: ${row.status}`,
            ).toContain(row.status);
            preKillStatus.set(id, row);
          }
          // Compress the recovery clocks (both epoch SECONDS): the run heartbeat past STALE_MS,
          // and EVERY orphaned job lease past expiry — whichever worker held it.
          db.prepare("UPDATE autonomous_runs SET heartbeat_at = ? WHERE id = ?").run(
            Math.floor((Date.now() - 360_000) / 1000),
            runId,
          );
          db.prepare("UPDATE research_jobs SET locked_until = ? WHERE status = 'running'").run(
            Math.floor((Date.now() - 1_000) / 1000),
          );
        } finally {
          db.close();
        }
      }
      stamp(
        `orphan state verified (co-flight at kill: ${[...preKillStatus.entries()]
          .map(([id, row]) => `${id}=${row.status}`)
          .join(" ")}); clocks aged`,
      );

      // ── Phase 4: restart on a fresh port, same database ──────────────────────────────────
      const PORT2 = await freePort();
      const ORIGIN2 = `http://127.0.0.1:${PORT2}`;
      server = spawnServer(dbPath, distDir, PORT2);
      await waitForServer(server, PORT2);
      stamp(`server B up on ${PORT2}`);

      // Recovery: the SAME run resumes and the audit trail says why.
      let recoveredStatus = "";
      const recoveryDeadline = Date.now() + 90_000;
      while (Date.now() < recoveryDeadline) {
        const res = await fetch(`${ORIGIN2}/api/system/status`);
        const body = (await res.json()) as { running: boolean; run: { id: string; status: string } | null };
        if (body.running && body.run?.id === runId && /DEGRADED|RUNNING/.test(body.run.status)) {
          recoveredStatus = body.run.status;
          break;
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }
      expect(recoveredStatus, "the same run must resume after restart").toMatch(/DEGRADED|RUNNING/);
      const recoveredAtMs = Date.now();

      // The dead server could not release its LANE leases, and acquireLease has no same-holder
      // re-entry — so without recovery-time release, whichever lane was mid-drain at the kill is
      // dead for the lease's full 10-minute TTL while the OTHER lane silently masks it at its own
      // cadence (run 1 of this spec completed entirely on 60s cycle ticks behind a stranded
      // research lease). Recovery must free the dead run's lane leases: each file is either gone
      // or re-held by a POST-KILL acquisition — never the corpse's record.
      for (const suffix of [".research-lease", ".cycle-lease"]) {
        const leaseFile = `${dbPath}${suffix}`;
        if (fs.existsSync(leaseFile)) {
          const lease = JSON.parse(fs.readFileSync(leaseFile, "utf8")) as { acquiredAt: number };
          expect(
            lease.acquiredAt,
            `${suffix} must not still be the dead server's record after recovery`,
          ).toBeGreaterThan(killedAtMs);
        }
      }
      {
        const db = new Database(dbPath, { readonly: true });
        try {
          const audit = db
            .prepare(
              "SELECT detail FROM audit_events WHERE action = 'autonomous_run_recover' AND subject = ? ORDER BY created_at DESC LIMIT 1",
            )
            .get(runId) as { detail: string } | undefined;
          expect(audit, "autonomous_run_recover audit row must exist").toBeDefined();
          const interrupted = Number(/interrupted_jobs=(\d+)/.exec(audit!.detail)?.[1] ?? "0");
          expect(interrupted, "recovery must have seen the interrupted job").toBeGreaterThanOrEqual(1);
        } finally {
          db.close();
        }
      }
      stamp(`recovered as ${recoveredStatus}`);

      // ── Phase 5: the work completes — each job exactly once, each truthfully ─────────────
      // The research rerun is a REAL model call; the validation job burns its three attempts on
      // governor refusals with backoff. Budget generously, fail with the queue's own snapshot.
      const doneDeadline = Date.now() + 330_000;
      let snapshot: JobRow[] = [];
      const terminal = (row: JobRow | undefined, wanted: string) => row?.status === wanted;
      for (;;) {
        snapshot = await fetchJobs(ORIGIN2);
        const byId = new Map(snapshot.map((j) => [j.id, j]));
        if (
          terminal(byId.get(researchJobId), "succeeded") &&
          terminal(byId.get(backtestJobId), "succeeded") &&
          terminal(byId.get(validationJobId), "dead") &&
          terminal(byId.get(paperJobId), "succeeded") &&
          terminal(byId.get(forecastJobId), "succeeded") &&
          terminal(byId.get(memoryJobId), "succeeded")
        ) {
          break;
        }
        if (Date.now() > doneDeadline) {
          const lease = fs.existsSync(`${dbPath}.research-lease`)
            ? fs.readFileSync(`${dbPath}.research-lease`, "utf8")
            : "(no research lease file)";
          throw new Error(
            `flight never reached its terminal states.\nqueue: ${JSON.stringify(
              snapshot.filter((j) =>
                [researchJobId, backtestJobId, validationJobId, paperJobId, forecastJobId, memoryJobId].includes(j.id),
              ),
            )}\nresearch lease: ${lease}`,
          );
        }
        await new Promise((r) => setTimeout(r, 3_000));
      }
      stamp("all six jobs reached their truthful terminals");

      // The RESEARCH LANE — not only the cycle's safety-net worker — must participate after
      // recovery. The claim trail records its claimant (`<workerId> attempt N`), so a recovered
      // machine running solely on 60s cycle ticks (lane dead behind the stranded lease) is
      // visible here as the absence of any post-kill `research-*` claim.
      {
        const db = new Database(dbPath, { readonly: true });
        try {
          const laneClaims = count(
            db,
            "SELECT COUNT(*) AS n FROM research_job_events WHERE event = 'claimed' AND detail LIKE 'research-%' AND created_at > ?",
            Math.floor(killedAtMs / 1000),
          );
          expect(
            laneClaims,
            "the event-driven research lane must claim work after recovery — a zero here means it is dead behind the dead server's lease and the cycle is masking it",
          ).toBeGreaterThanOrEqual(1);
        } finally {
          db.close();
        }
      }
      stamp("post-recovery claims include the research lane itself");

      // ── Phase 6: the exactly-once ledger audit ───────────────────────────────────────────
      {
        const db = new Database(dbPath, { readonly: true });
        try {
          // The interrupted research job: reclaimed once (attempts 2), succeeded, present truth
          // clean (lastError null), and EXACTLY ONE completed AgentRun for its jobId.
          const research = db
            .prepare("SELECT status, attempts, last_error, result FROM research_jobs WHERE id = ?")
            .get(researchJobId) as { status: string; attempts: number; last_error: string | null; result: string };
          expect(research.status).toBe("succeeded");
          expect(research.attempts, "exactly one reclaim after the kill").toBe(2);
          expect(research.last_error).toBeNull();

          // Work that had already COMPLETED before the kill is never re-executed by recovery —
          // its attempt count is frozen at the pre-kill value.
          for (const [id, before] of preKillStatus) {
            if (before.status !== "succeeded" && before.status !== "dead") continue;
            const after = db
              .prepare("SELECT status, attempts FROM research_jobs WHERE id = ?")
              .get(id) as { status: string; attempts: number };
            expect(after.status, `terminal job ${id} must stay terminal through recovery`).toBe(before.status);
            expect(after.attempts, `terminal job ${id} must not gain attempts through recovery`).toBe(
              before.attempts,
            );
          }

          const completedRuns = count(
            db,
            "SELECT COUNT(*) AS n FROM agent_runs WHERE job_id = ? AND status = 'COMPLETED'",
            researchJobId,
          );
          expect(completedRuns, "one kill + one reclaim must yield EXACTLY ONE completed AgentRun").toBe(1);
          const envelope = db
            .prepare("SELECT envelope FROM agent_runs WHERE job_id = ? AND status = 'COMPLETED'")
            .get(researchJobId) as { envelope: string };
          expect(() => JSON.parse(envelope.envelope)).not.toThrow();

          // The backtest persisted a complete experiment — its durable result names it.
          const backtest = db
            .prepare("SELECT status, result FROM research_jobs WHERE id = ?")
            .get(backtestJobId) as { status: string; result: string };
          const backtestResult = JSON.parse(backtest.result) as { experimentId?: string; tradeCount?: number };
          expect(typeof backtestResult.experimentId).toBe("string");
          expect(typeof backtestResult.tradeCount).toBe("number");

          // The confirmed validation job died of governor refusal — and spent NOTHING, through a
          // crash, a restart, and its full retry budget. This is the no-duplicate-trial boundary.
          const validation = db
            .prepare("SELECT status, attempts, last_error FROM research_jobs WHERE id = ?")
            .get(validationJobId) as { status: string; attempts: number; last_error: string | null };
          expect(validation.status).toBe("dead");
          expect(validation.last_error).toMatch(/TRIAL_NOT_AUTHORIZED/);
          for (const table of ["trials", "selection_trials", "trial_reservations"]) {
            expect(
              count(db, `SELECT COUNT(*) AS n FROM ${table}`),
              `${table} must be untouched (zero spend) through crash + restart + refusal retries`,
            ).toBe(0);
          }

          // Recovery invented nothing: no forward signals, no paper orders of either ledger.
          for (const table of ["forward_signals", "paper_forward_orders", "paper_orders"]) {
            expect(count(db, `SELECT COUNT(*) AS n FROM ${table}`), `${table} must be empty`).toBe(0);
          }
        } finally {
          db.close();
        }
      }
      stamp("ledger audit clean: exactly-once everywhere, zero trials, nothing invented");

      // ── Phase 7: dedupe identity survived the crash ──────────────────────────────────────
      const cookie2 = await localSessionCookie(ORIGIN2);
      const headers2 = { ...MUTATION, origin: ORIGIN2, cookie: cookie2 };
      const redo = await fetch(`${ORIGIN2}/api/research/jobs`, {
        method: "POST",
        headers: headers2,
        body: JSON.stringify({
          kind: "instrument_research",
          payload: { instrumentId: SUBJECT },
          dedupeKey: `cm-${RUN_STAMP}-instrument_research`,
        }),
      });
      expect(redo.status).toBe(200);
      const redoBody = (await redo.json()) as { id: number; deduped: boolean };
      expect(redoBody.deduped, "the succeeded job's dedupe key must still answer").toBe(true);
      expect(redoBody.id).toBe(researchJobId);

      // The dead validation corpse answers for its key inside the revival cooldown — the
      // BLOCKED taxonomy holding through a crash rather than resetting to amnesia.
      const redoValidation = await fetch(`${ORIGIN2}/api/research/jobs`, {
        method: "POST",
        headers: headers2,
        body: JSON.stringify({
          kind: "validation",
          payload: { specId, confirmed: true },
          dedupeKey: `cm-${RUN_STAMP}-validation`,
        }),
      });
      expect(redoValidation.status).toBe(200);
      const redoValidationBody = (await redoValidation.json()) as { id: number; deduped: boolean };
      expect(redoValidationBody.deduped, "a cooling corpse must answer for its dedupe key").toBe(true);
      expect(redoValidationBody.id).toBe(validationJobId);
      stamp("dedupe identity intact through the crash");

      // ── Teardown through the product ─────────────────────────────────────────────────────
      await fetch(`${ORIGIN2}/api/system/stop`, {
        method: "POST",
        headers: headers2,
        body: JSON.stringify({ reason: "crash-matrix teardown" }),
      }).catch(() => undefined);
    } finally {
      if (server) server.kill();
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; the dist dir is deliberately KEPT (stable, reused across runs)
      }
    }
  });
});
