import fs from "node:fs";
import Database from "better-sqlite3";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ensureLocalSession } from "./lib/session";

/**
 * AUTO MODE — wall-clock lane concurrency, measured in real timestamps.
 *
 * ## What this spec was commissioned to prove
 *
 * "AUTO mode" (the machine on /brain) has three lane families: OBSERVE (read-only state
 * gathering), LEARN (research intake, queue drain, rehearsal, forecasts), and the operational
 * RESEARCH lane (research_jobs executed by the worker). The mission asked for wall-clock proof
 * of OBSERVE / LEARN / RESEARCH executing with TEMPORAL OVERLAP, using real job timestamps and
 * NEVER the lane labels ("Observe ACTIVE / Learn ACTIVE") the Brain kernel renders — those labels
 * are event-derived strings, not intervals.
 *
 * ## HISTORY, READ FIRST
 *
 * This spec previously asserted the OPPOSITE, and was right to. The machine could not overlap
 * lanes in wall-clock time, because lane execution was sequential by construction:
 *
 *   1. `supervisor.tick()` ran ONE awaited `runLearningCycle` per 60s tick, non-reentrant.
 *   2. `cycle.runCycleBody()` is ONE sequential async body (produce → runWorker → rehearsal →
 *      gauntlet → shadow → board), each step awaited in order. Nothing was forked.
 *   3. `withCycleLease()` serialized ALL drivers behind a SINGLE lease file — one lease meant one
 *      lane, so the research worker could only ever run as a PHASE inside the cycle.
 *   4. `runWorker()` drains with one sequential claim → await → complete loop.
 *
 * The old spec documented that honestly and pinned it, noting: "If a future change makes lanes
 * concurrent, the sequential assertions below will fail loudly and will need to be inverted into
 * overlap assertions." That change has now been made, and this is that inversion.
 *
 * ## WHAT CHANGED
 *
 * The RESEARCH lane now drains the durable queue on its OWN timer (`RESEARCH_TICK_MS`, 5s) under
 * its OWN lease (`researchLeasePath()`), independent of the 60s cycle. Point 3 above was the real
 * mutex, so giving the lane a separate lease file is what makes concurrency possible at all.
 *
 * ## WHY CONTAINMENT IS NOT PROOF, AND WHAT IS
 *
 * A job running "inside" a cycle's time window proves nothing on its own: under the OLD design
 * every job was inside its cycle, because the cycle CALLED the worker. Overlap alone cannot tell
 * the two architectures apart.
 *
 * The discriminator is WHO CLAIMED THE JOB. `claimNextJob` writes a `claimed` event whose detail
 * is `${workerId} attempt N` (lib/research/queue.ts). The cycle's internal drain claims as
 * `supervisor-<runId>`; the independent lane claims as `research-<runId>`. So the headline
 * assertion is not "some intervals overlap" but:
 *
 *   a job claimed by `research-<runId>` executed while a `supervisor-<runId>` cycle was running.
 *
 * That is only possible with two genuinely concurrent lanes, and it is measured entirely from the
 * product's own timestamps and its own worker identities — never from the lane labels ("Observe
 * ACTIVE / Learn ACTIVE") the Brain kernel renders, which are event-derived strings, not intervals.
 *
 * Both lanes remain INTERNALLY sequential, and that is still asserted: one cycle at a time, one
 * job at a time. Concurrency is across lanes, not duplication within one.
 *
 * ## Evidence sources (all real product timestamps)
 *
 *   - LEARN/OBSERVE lane: GET /api/cycles — cycle runs { ranAt (ISO), durationMs, driver,
 *     jobsProcessed } → interval [ranAt, ranAt + durationMs]. `driver` is the audit actor
 *     (`supervisor-<runId>`), so only THIS run's cycles are counted.
 *   - RESEARCH lane: GET /api/research/jobs — job records { id, kind, status }. Execution bounds
 *     come from the product's own `research_job_events` ledger (claimed / succeeded, unix
 *     seconds), read from the same SQLite file the server reads — the pattern established by
 *     e2e/forward-evidence.spec.ts for DB cross-checks, because no HTTP route exposes job events.
 *   - RUN identity: GET /api/system/status — run.id, run.ticks, queue stats.
 *
 * Timestamp precision caveat, used in the assertions: drizzle stores these `mode: "timestamp"`
 * integer columns as unix SECONDS (documented in `lib/brain/activity.ts`), so interval bounds
 * are whole seconds. The cross-cycle non-overlap assertion therefore carries a documented
 * ≤1s tolerance for second-truncation, not for concurrency.
 */

const DB_PATH = process.env.MARKETPULSE_E2E_DB_PATH;
const RUN_STAMP = Date.now().toString(36);
const ORIGIN = process.env.MARKETPULSE_E2E_BASE_URL?.trim() || "http://127.0.0.1:3100";
const MUTATION = {
  headers: { "x-marketpulse-mutation": "1", "content-type": "application/json", origin: ORIGIN },
};

/** TICK_MS from lib/runtime/supervisor.ts — a tick fires immediately at start, then every 60s. */
const TICK_MS = 60_000;
/** Evidence is complete after two cycles × a real worker drain; 12 minutes is the outer budget. */
const POLL_DEADLINE_MS = 11.5 * 60_000;

interface LaneInterval {
  lane: string;
  label: string;
  startedAt: number;
  completedAt: number;
}

interface CycleRec {
  id: number;
  driver: string;
  ranAt: number;
  durationMs: number;
  jobsProcessed: number;
}

interface JobEvidence {
  id: number;
  kind: string;
  status: string;
  claimedAt: number | null;
  completedAt: number | null;
  /**
   * The worker that claimed it, parsed from the `claimed` event's `${workerId} attempt N` detail.
   * This is the discriminator between "the cycle drained it as a phase" (`supervisor-<runId>`)
   * and "the independent research lane drained it" (`research-<runId>`).
   */
  claimedBy: string | null;
}

function intervalsOverlap(a: LaneInterval, b: LaneInterval): boolean {
  return a.startedAt < b.completedAt && b.startedAt < a.completedAt;
}

test.describe("AUTO mode — lane execution in wall-clock time", () => {
  test.skip(!DB_PATH, "needs direct access to the server's database file");

  test.beforeAll(async () => {
    const base =
      process.env.MARKETPULSE_E2E_BASE_URL?.trim() ||
      `http://127.0.0.1:${process.env.MARKETPULSE_E2E_PORT ?? 3100}`;
    // Wake the server (migration/bootstrap happens on first request), then wait for the DB file
    // to exist — exactly the recipe in e2e/forward-evidence.spec.ts.
    await fetch(`${base}/api/research/hypotheses`).catch(() => undefined);
    for (let attempt = 0; attempt < 20 && !fs.existsSync(DB_PATH!); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!fs.existsSync(DB_PATH!)) throw new Error(`Server database never appeared at ${DB_PATH}.`);

    const db = new Database(DB_PATH!);
    try {
      // --- Deterministic market data: two XNSE names with 300 daily bars each (count-guarded
      // like forward-evidence, so a persistent shared DB is never double-seeded). This gives the
      // cycle's data lanes (rehearsal canonical store, forward store reads) real series; in
      // MARKETPULSE_TEST_MODE the candle fixtures work regardless, so this is belt-and-braces.
      const END_UTC = Date.UTC(2026, 7, 10, 3, 45, 0) / 1000; // a settled past session
      for (const ticker of ["IN:XNSE:RELIANCE", "IN:XNSE:INFY"]) {
        const existing = db
          .prepare("SELECT COUNT(*) AS n FROM price_candles WHERE ticker = ? AND resolution = 'D'")
          .get(ticker) as { n: number };
        if (existing.n < 300) {
          const insert = db.prepare(
            "INSERT INTO price_candles (ticker, resolution, time, open, high, low, close, volume) VALUES (?, 'D', ?, ?, ?, ?, ?, ?)",
          );
          const all = db.transaction(() => {
            for (let day = 0; day < 300; day += 1) {
              const base = 1_000 + day * 0.5;
              insert.run(ticker, END_UTC - 300 * 86_400 + day * 86_400, base, base * 1.01, base * 0.99, base * 1.005, 1_000);
            }
          });
          all();
        }
      }

      // Research-lane work is seeded INSIDE the test body, not here — see `seedLaneJobs`.
    } finally {
      db.close();
    }
  });

  test.beforeEach(async ({ request }) => {
    // Same recipe as e2e/autonomous-master-runtime.spec.ts: start from a stopped machine so an
    // "already running" survivor from an earlier spec cannot contaminate the interval evidence.
    await ensureLocalSession(request);
    await request.post("/api/system/stop", { ...MUTATION, data: { reason: "test setup" } }).catch(() => undefined);
    // Give the stop a moment to land before Start, so the start below creates a FRESH run.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await (await request.get("/api/system/status")).json();
      if (status.running === false) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });

  test.afterEach(async ({ request }) => {
    await request.post("/api/system/stop", { ...MUTATION, data: { reason: "test teardown" } }).catch(() => undefined);
  });

  test("Observe/Learn cycle and the Research lane run real work CONCURRENTLY — proven by overlapping wall-clock intervals", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name.includes("mobile"), "mission policy: desktop-only Playwright");
    test.setTimeout(900_000); // run duration is dominated by TICK_MS (60s); budget allows ~12 min

    // Baseline: on a shared persistent DB, earlier specs may have left jobs/events behind. Only
    // records created after this point belong to this run.
    const beforeMaxJobId = readDb((db) => {
      const row = db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM research_jobs").get() as { m: number };
      return row.m;
    });

    /**
     * Seed AFTER the baseline, and before Start.
     *
     * This used to run in `beforeAll`, which quietly removed it from the evidence: every seeded
     * job then had `id <= beforeMaxJobId` and was filtered out by the `job.id > beforeMaxJobId`
     * guard below. The only jobs left to observe were the ones the cycle produces and then drains
     * itself milliseconds later in the same body — so the independent lane had nothing to claim,
     * and the run reported "no job was claimed by the research lane" even though the lane was
     * running correctly. The seeding position, not the runtime, was the defect.
     *
     * These are REAL queue jobs with REAL claimed/succeeded event timestamps. They are seeded
     * rather than produced because the machine's own `produceResearchJobs` reaches the network
     * (arXiv + the strategy catalogue) with no fetch timeout, and lane evidence must not depend on
     * that. Payloads carry title + content, without which `runJob` throws.
     */
    seedLaneJobs();

    const started = await request.post("/api/system/start", {
      ...MUTATION,
      data: { runtimeProfile: "SUBSCRIPTION_FIRST" },
    });
    expect(started.status()).toBe(201);
    const run = (await started.json()).run as { id: string; status: string };
    expect(run.id).toMatch(/^arun_/);
    const runId = run.id;

    // ── Evidence collection loop ──────────────────────────────────────────────────────────────
    // Every record carries the product's own timestamps. We stop as soon as the evidence is
    // complete (two cycles + a real worker drain) to keep the suite fast.
    let cycles: CycleRec[] = [];
    let jobs: JobEvidence[] = [];
    let statuses: Array<{ running: boolean; run: { id: string; ticks: number; status: string } | null; queue: Record<string, number> }> = [];

    const collect = async (requestCtx: APIRequestContext): Promise<void> => {
      const status = await (await requestCtx.get("/api/system/status")).json();
      statuses.push(status);

      const cycleData = await (await requestCtx.get("/api/cycles?limit=200")).json();
      cycles = (cycleData.runs ?? [])
        .filter((row: { driver: string }) => row.driver === `supervisor-${runId}`)
        .map((row: { id: number; driver: string; ranAt: string; durationMs: number; jobsProcessed: number }) => ({
          id: row.id,
          driver: row.driver,
          ranAt: Date.parse(row.ranAt),
          durationMs: row.durationMs,
          jobsProcessed: row.jobsProcessed,
        }))
        .sort((a: CycleRec, b: CycleRec) => a.ranAt - b.ranAt);

      const jobData = await (await requestCtx.get("/api/research/jobs")).json();
      const freshJobs = (jobData.jobs as Array<{ id: number; kind: string; status: string; createdAt: string }>)
        .filter((job) => job.id > beforeMaxJobId);
      const events = readDb((db) => {
        const ids = freshJobs.map((job) => job.id);
        if (ids.length === 0) {
          return [] as Array<{ jobId: number; event: string; detail: string | null; createdAt: number }>;
        }
        const placeholders = ids.map(() => "?").join(",");
        return db
          .prepare(`SELECT job_id AS jobId, event, detail, created_at AS createdAt FROM research_job_events WHERE job_id IN (${placeholders}) ORDER BY job_id, id`)
          .all(...ids) as Array<{ jobId: number; event: string; detail: string | null; createdAt: number }>;
      });
      jobs = freshJobs.map((job) => {
        const claimed = events.find((e) => e.jobId === job.id && e.event === "claimed");
        const completed = events.find((e) => e.jobId === job.id && e.event === "succeeded");
        return {
          id: job.id,
          kind: job.kind,
          status: job.status,
          claimedAt: claimed ? claimed.createdAt * 1000 : null,
          completedAt: completed ? completed.createdAt * 1000 : null,
          // Detail is `${workerId} attempt N`; the worker id is everything before " attempt ".
          claimedBy: claimed?.detail ? claimed.detail.split(" attempt ")[0] : null,
        };
      });
    };

    const completedJobs = () => jobs.filter((job) => job.status === "succeeded" && job.claimedAt !== null && job.completedAt !== null);
    /** Jobs the INDEPENDENT research lane executed, as opposed to the cycle's internal drain. */
    const laneJobs = () => completedJobs().filter((job) => job.claimedBy?.startsWith("research-"));
    const evidenceComplete = () =>
      cycles.length >= 2 &&
      completedJobs().length >= 2 &&
      // Without at least one lane-claimed job there is nothing that could prove concurrency.
      laneJobs().length >= 1 &&
      statuses.some((s) => s.run !== null && s.run.ticks >= 2);

    const deadline = Date.now() + POLL_DEADLINE_MS;
    for (;;) {
      await collect(request);
      if (evidenceComplete()) break;
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }

    // ── Stop first: the assertions below judge what was COLLECTED, never a live race. ──
    await request.post("/api/system/stop", { ...MUTATION, data: { reason: "evidence collected" } }).catch(() => undefined);

    const finalStatus = statuses[statuses.length - 1];
    expect(finalStatus.running, `machine must still be running while evidence is collected (last status: ${JSON.stringify(finalStatus.run)})`).toBe(true);
    const finalRun = finalStatus.run!;

    // ── 1. Never two runs ─────────────────────────────────────────────────────────────────────
    for (const status of statuses) {
      expect(status.run?.id, "the run id must never change — a second machine must never start").toBe(runId);
    }
    expect(finalRun.ticks, "the machine must have completed at least two ticks").toBeGreaterThanOrEqual(2);
    expect(["RUNNING", "DEGRADED"]).toContain(finalRun.status);

    // ── 2. Both lane families ran real work ───────────────────────────────────────────────────
    expect(cycles.length, "the Observe/Learn lane (the learning cycle) must have completed at least two real cycles").toBeGreaterThanOrEqual(2);
    for (const cycle of cycles) {
      expect(cycle.durationMs, `cycle ${cycle.id} must have a real, positive duration`).toBeGreaterThan(0);
    }
    const jobsDone = completedJobs();
    expect(jobsDone.length, "the Research lane must have succeeded at least two real queue jobs").toBeGreaterThanOrEqual(2);
    for (const job of jobsDone) {
      expect(job.claimedAt, `job ${job.id} has no claimed timestamp in the job-event ledger`).not.toBeNull();
      expect(job.completedAt, `job ${job.id} has no succeeded timestamp in the job-event ledger`).not.toBeNull();
    }

    // Queue sanity from the product's own status endpoint.
    const queue = finalStatus.queue;
    expect(queue.succeeded, "queue stats must count the succeeded jobs").toBeGreaterThanOrEqual(jobsDone.length);
    expect(queue.running, "queue stats must show no job still running after the worker pass").toBe(0);

    // ── 3. THE SEQUENTIALITY ASSERTIONS (the honest product behavior) ─────────────────────────
    // The machine is sequential by design (see file header). These assertions pin that behavior
    // with the product's own timestamps so a real concurrency change fails loudly.

    // 3a. Each drainer is internally sequential: within one worker, a job starts only after the
    // previous one finished, because `runWorker` is a single claim → await → complete loop.
    //
    // Scoped PER CLAIMANT deliberately. There are now two drainers — the independent research
    // lane and the cycle's own drain phase — and jobs from DIFFERENT claimants may legitimately
    // overlap; that is the concurrency this file exists to prove. What would be a real defect is
    // one worker running two jobs at once, which is what this still catches. (`claimNextJob`
    // claims transactionally under `lockedUntil`, so no job can be claimed by both.)
    const sortedJobs = [...jobsDone].sort((a, b) => (a.claimedAt! - b.claimedAt!) || (a.id - b.id));
    const byClaimant = new Map<string, JobEvidence[]>();
    for (const job of sortedJobs) {
      const claimant = job.claimedBy ?? "unknown";
      byClaimant.set(claimant, [...(byClaimant.get(claimant) ?? []), job]);
    }
    for (const [claimant, claimed] of byClaimant) {
      for (let index = 1; index < claimed.length; index += 1) {
        const prev = claimed[index - 1];
        const next = claimed[index];
        expect(
          next.claimedAt! >= prev.completedAt!,
          `worker ${claimant} ran jobs ${prev.id} and ${next.id} concurrently ` +
            `([${new Date(prev.claimedAt!).toISOString()}, ${new Date(prev.completedAt!).toISOString()}] vs ` +
            `[${new Date(next.claimedAt!).toISOString()}, ...]) — a single worker loop must be sequential`,
        ).toBe(true);
      }
    }

    // 3b. The INDEPENDENT research lane actually executed work. Under the old architecture this
    // set was necessarily empty: every claim came from `supervisor-<runId>`, because the cycle was
    // the only thing that could drain the queue.
    const laneDone = laneJobs();
    expect(
      laneDone.length,
      `no job was claimed by the independent research lane (claimants seen: ` +
        `${[...new Set(jobsDone.map((job) => job.claimedBy ?? "unknown"))].join(", ")}) — ` +
        `the RESEARCH lane is not running, so AUTO cannot be concurrent`,
    ).toBeGreaterThanOrEqual(1);

    // 3c. The Learn lane is internally sequential ACROSS ticks: cycle intervals never overlap.
    // One-second tolerance, documented: drizzle stores these timestamps as whole seconds, and
    // ranAt is sampled when the report object is built (ms after body start), so a sub-second
    // carry can reach 1s. This is a precision margin, not a concurrency allowance.
    for (let index = 1; index < cycles.length; index += 1) {
      const prev = cycles[index - 1];
      const next = cycles[index];
      expect(
        next.ranAt >= prev.ranAt + prev.durationMs - 1000,
        `cycles ${prev.id} and ${next.id} overlap in wall-clock time ` +
          `(cycle ${prev.id} [${new Date(prev.ranAt).toISOString()}, +${prev.durationMs}ms], cycle ${next.id} starts ` +
          `${new Date(next.ranAt).toISOString()}) — ticks are strictly sequential by design`,
      ).toBe(true);
    }

    // 3d. THE HEADLINE ASSERTION, in the mission's own terms: a job executed by the INDEPENDENT
    // research lane overlapped a learning cycle in wall-clock time.
    //
    // Both halves are required. Overlap alone is not proof — under the old design every job
    // overlapped (indeed was contained in) its cycle, because the cycle called the worker. It is
    // overlap BY A LANE-CLAIMED JOB that distinguishes two concurrent lanes from one sequential
    // body, and the claimant comes from the product's own job-event ledger.
    const learnIntervals: LaneInterval[] = cycles.map((cycle) => ({
      lane: "learn",
      label: `cycle ${cycle.id}`,
      startedAt: cycle.ranAt,
      completedAt: cycle.ranAt + cycle.durationMs,
    }));
    const laneJobIntervals: LaneInterval[] = laneDone
      .sort((a, b) => a.claimedAt! - b.claimedAt!)
      .map((job) => ({
        lane: "research",
        label: `job ${job.id} (${job.claimedBy})`,
        startedAt: job.claimedAt!,
        completedAt: job.completedAt!,
      }));

    /**
     * Concurrency is judged on the CLAIM INSTANT falling inside a cycle's execution window, not on
     * interval intersection — because interval intersection cannot express this data.
     *
     * `research_job_events.created_at` is a drizzle `mode: "timestamp"` integer, stored in whole
     * SECONDS (documented in the header and in lib/brain/activity.ts). A queue job that completes
     * in milliseconds therefore records `claimed` and `succeeded` in the same second, producing a
     * ZERO-WIDTH interval [T, T]. `intervalsOverlap` uses strict inequalities, so a zero-width
     * interval overlaps nothing at all, however plainly it sits inside a cycle — the first run of
     * this assertion failed on exactly that, with four lane jobs at 10:54:00.000 inside a cycle
     * spanning 10:54:00.000 → 10:54:01.214.
     *
     * Comparing a single instant against the cycle's millisecond-precision window avoids the
     * problem instead of papering over it, and errs toward FALSE NEGATIVES: a job claimed at
     * 10:53:59.8 records as 10:53:59 and will not be credited to a cycle starting at 10:54:00.
     * An under-count is the right direction for a proof.
     */
    const overlaps: string[] = [];
    for (const cycle of learnIntervals) {
      for (const job of laneJobIntervals) {
        const claimedDuringCycle =
          job.startedAt >= cycle.startedAt && job.startedAt < cycle.completedAt;
        // Kept for jobs long enough to have a real (non-degenerate) interval.
        const properOverlap = job.completedAt > job.startedAt && intervalsOverlap(cycle, job);
        if (claimedDuringCycle || properOverlap) {
          overlaps.push(
            `${job.label} [${new Date(job.startedAt).toISOString()} → ${new Date(job.completedAt).toISOString()}] ` +
              `ran during ${cycle.label} [${new Date(cycle.startedAt).toISOString()} → ${new Date(cycle.completedAt).toISOString()}]`,
          );
        }
      }
    }

    expect(
      overlaps.length,
      `no research-lane job overlapped a learning cycle in wall-clock time.\n` +
        `  cycles: ${learnIntervals.map((c) => `${c.label} ${new Date(c.startedAt).toISOString()}→${new Date(c.completedAt).toISOString()}`).join("; ")}\n` +
        `  lane jobs: ${laneJobIntervals.map((j) => `${j.label} ${new Date(j.startedAt).toISOString()}→${new Date(j.completedAt).toISOString()}`).join("; ")}\n` +
        `  AUTO's lanes are running one after another, not at the same time.`,
    ).toBeGreaterThanOrEqual(1);

    for (const line of overlaps) console.log(`[auto-mode-concurrency] OVERLAP ${line}`);

    // ── Evidence for the report ───────────────────────────────────────────────────────────────
    const evidence = {
      runId,
      ticks: finalRun.ticks,
      status: finalRun.status,
      queue: queue,
      cycles: cycles.map((cycle) => ({
        id: cycle.id,
        driver: cycle.driver,
        startedAt: new Date(cycle.ranAt).toISOString(),
        completedAt: new Date(cycle.ranAt + cycle.durationMs).toISOString(),
        durationMs: cycle.durationMs,
        jobsProcessed: cycle.jobsProcessed,
      })),
      jobs: sortedJobs.map((job) => ({
        id: job.id,
        kind: job.kind,
        status: job.status,
        startedAt: new Date(job.claimedAt!).toISOString(),
        completedAt: new Date(job.completedAt!).toISOString(),
      })),
    };
    await testInfo.attach("lane-intervals", {
      contentType: "application/json",
      body: JSON.stringify(evidence, null, 2),
    });
    console.log(`[auto-mode-concurrency] run ${runId} ticks=${finalRun.ticks}`);
    console.log(`[auto-mode-concurrency] ${cycles.length} supervisor cycles, ${sortedJobs.length} research jobs succeeded`);
    for (const cycle of evidence.cycles) {
      console.log(`[auto-mode-concurrency] cycle ${cycle.id} ${cycle.startedAt} → ${cycle.completedAt} (${cycle.durationMs}ms, ${cycle.jobsProcessed} jobs processed)`);
    }
    for (const job of evidence.jobs) {
      console.log(`[auto-mode-concurrency] job ${job.id} ${job.kind} ${job.startedAt} → ${job.completedAt}`);
    }
  });
});

/**
 * Put deterministic work in the queue for the RESEARCH lane to claim.
 *
 * Priority 100 and `available_at = now` so they are immediately claimable. Four jobs, so the lane
 * (every `RESEARCH_TICK_MS`) has work in hand while the learning cycle is busy with its long
 * phases — which is the window in which the two lanes must be observed to overlap.
 */
function seedLaneJobs(): void {
  readDb((db) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const insert = db.prepare(
      `INSERT INTO research_jobs
         (kind, payload, status, priority, attempts, max_attempts, dedupe_key, available_at, created_at, updated_at)
       VALUES (?, ?, 'queued', 100, 0, 3, ?, ?, ?, ?)`,
    );
    const titles = [
      "Momentum persistence in NSE liquid names",
      "Mean reversion after earnings gaps in Indian equities",
      "Intraday volume profile asymmetries on XNSE",
      "Cost-aware turnover limits for daily rebalancing",
    ];
    const seed = db.transaction(() => {
      for (let index = 0; index < titles.length; index += 1) {
        const title = titles[index];
        // The dedupe key carries a per-attempt stamp so a re-run seeds fresh jobs rather than
        // colliding with the previous run's and silently seeding nothing.
        const stamp = `${RUN_STAMP}-${Date.now().toString(36)}-${index}`;
        insert.run(
          "ingest_paper",
          JSON.stringify({
            kind: "paper",
            title,
            content:
              `${title}. A published study catalogued for autonomous intake. The authors report ` +
              `results over their own window, universe and cost assumptions; this system treats ` +
              `the figure as a reason to test the idea, never as evidence that it works here. ` +
              `Deterministic e2e seeding payload ${stamp}.`,
            url: `https://example.invalid/e2e/${stamp}`,
            locator: `e2e:${stamp}`,
            license: "e2e fixture",
            authors: [],
          }),
          `e2e-lane-${stamp}`,
          nowSec,
          nowSec,
          nowSec,
        );
      }
    });
    seed();
    return null;
  });
}

/** Read the server's SQLite file with better-sqlite3 (same pattern as forward-evidence.spec.ts). */
function readDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH!);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}