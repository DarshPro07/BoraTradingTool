import { getDb, schema } from "@/lib/db";
import { recordFailure } from "@/lib/knowledge/repository";
import { emit } from "@/lib/brain/event-bus";
import { ingestSource, type IngestPayload } from "./ingest";
import { claimNextJob, completeJob, failJob, type ClaimedJob } from "./queue";

export interface WorkerResult {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
  idle: boolean;
}

async function runJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  switch (job.kind) {
    case "ingest_paper":
    case "ingest_video":
    case "ingest_repository":
    case "ingest_web": {
      const payload = job.payload as unknown as IngestPayload;
      if (!payload?.title || !payload?.content) {
        throw new Error("Ingestion payload requires both a title and content.");
      }
      return ingestSource(job.kind, payload) as unknown as Record<string, unknown>;
    }
    case "dedupe_hypotheses":
      return { note: "Deduplication runs inline during ingestion; nothing to do." };
    case "ingest_history": {
      const instrumentId = (job.payload as { instrumentId?: unknown }).instrumentId;
      if (typeof instrumentId !== "string" || instrumentId.length === 0) {
        throw new Error("ingest_history requires an instrumentId.");
      }
      // Idempotent by construction: ALREADY_READY when the store already satisfies the research
      // floor, so a retried or duplicated job cannot double-write history.
      const { ingestInstrumentHistory } = await import("@/lib/market/ingest");
      const outcome = await ingestInstrumentHistory(instrumentId);
      // A refusal (unknown instrument, source empty) FAILS the job so the queue's retry/dead
      // machinery records it — a remediation that silently succeeds while ingesting nothing would
      // recreate the exact loop this kind exists to break.
      if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}`);
      return outcome as unknown as Record<string, unknown>;
    }
    case "forecast_resolve": {
      // Store-only and ledger-deduped, so this job and the event-driven resolver cannot
      // double-grade however they interleave. "No forecasts are awaiting a grade" is success.
      const { resolveMaturedForecasts } = await import("@/lib/forecast/resolver");
      return (await resolveMaturedForecasts()) as unknown as Record<string, unknown>;
    }
    case "memory_validate": {
      const { inspectMemory } = await import("@/lib/learning/introspection");
      return inspectMemory() as unknown as Record<string, unknown>;
    }
    case "backtest":
      return runBacktestJob(job);
    case "validation":
      return runValidationJob(job);
    case "paper_reconcile": {
      // Deterministic, bar-time only, idempotent — advances the paper state machine on recorded
      // bars. "Nothing to reconcile" is success, not a failure.
      const { runPaperPass } = await import("@/lib/forward/paper");
      return runPaperPass() as unknown as Record<string, unknown>;
    }
    case "incident_repair": {
      // Fixes only provably-understated declared costs against the published schedule; reports
      // (never fixes) capital drift; audited; never touches code or governance.
      const { runSelfRepair } = await import("@/lib/learning/self-repair");
      return runSelfRepair("incident-repair-job") as unknown as Record<string, unknown>;
    }
    case "forward_enroll": {
      // The durable validated→paper_forward link. Double-gated like `validation`: explicit
      // enqueue only (the cycle reports, never enqueues) and `confirmed: true` in the payload —
      // activation begins a forward observation record, and the confirm gate keeps that an
      // intentional act. `activateChallenger` re-verifies identity, gauntlet experiment and
      // economics itself; its refusals surface as this job's own coded failure.
      const payload = job.payload as { specId?: unknown; confirmed?: unknown };
      if (payload.confirmed !== true) {
        throw new Error("FORWARD_ENROLL_UNCONFIRMED: enrolling a forward challenger requires confirmed:true.");
      }
      if (typeof payload.specId !== "string" || payload.specId.length === 0) {
        throw new Error("SPEC_NOT_FOUND: forward_enroll requires a specId.");
      }
      const { activateChallenger } = await import("@/lib/forward/shadow");
      const outcome = activateChallenger(payload.specId, "autonomous_worker");
      if (outcome.ok) return outcome as unknown as Record<string, unknown>;
      // Idempotent by goal: the strategy IS enrolled — a retry, a crash-reclaim or a duplicate
      // enqueue must report success, not fail a satisfied objective.
      if (outcome.code === "ALREADY_ACTIVE") {
        return { ok: true, alreadyActive: true, message: outcome.message };
      }
      throw new Error(`${outcome.code}: ${outcome.message}`);
    }
    case "holdout_decision": {
      // The query-once final gate. Double-gated here (explicit enqueue + confirmed:true) and
      // again inside the evaluator (owner-authorized seal, contamination, family budget).
      const payload = job.payload as { specId?: unknown; confirmed?: unknown };
      if (payload.confirmed !== true) {
        throw new Error("HOLDOUT_UNCONFIRMED: a holdout evaluation is a one-time statistical spend and requires confirmed:true.");
      }
      if (typeof payload.specId !== "string" || payload.specId.length === 0) {
        throw new Error("SPEC_NOT_FOUND: holdout_decision requires a specId.");
      }
      const { evaluateHoldout } = await import("@/lib/strategy/holdout-evaluator");
      const outcome = await evaluateHoldout(payload.specId, "autonomous_worker");
      if (outcome.ok) return outcome as unknown as Record<string, unknown>;
      throw new Error(`${outcome.code}: ${outcome.message}`);
    }
    case "instrument_research": {
      const instrumentId = (job.payload as { instrumentId?: unknown }).instrumentId;
      if (typeof instrumentId !== "string" || instrumentId.length === 0) {
        throw new Error("instrument_research requires an instrumentId.");
      }
      // The Agent Runtime owns semantic execution; the Job OS (here) owns lifecycle. The handler
      // records the AgentRun with agent+job provenance and returns/throws so the queue's failure
      // taxonomy classifies the outcome.
      //
      // DETERMINISTIC escalation: a deep/team-marked job is coordinated by the Chief-of-Staff team;
      // everything else stays the verified single-agent path, byte-for-byte unchanged. The agent
      // never decides to escalate itself — this decision is the Job OS's, from the payload.
      const { decideTeamExecution } = await import("@/lib/agents/teams");
      if (decideTeamExecution(job.payload as Record<string, unknown>) === "REQUIRED_TEAM") {
        const { runInstrumentResearchTeam } = await import("@/lib/agents/team-runtime");
        return (await runInstrumentResearchTeam(instrumentId, job.id)) as unknown as Record<string, unknown>;
      }
      const { runInstrumentResearch } = await import("@/lib/agents/runtime");
      return (await runInstrumentResearch(instrumentId, job.id)) as unknown as Record<string, unknown>;
    }
    default:
      throw new Error(`Unsupported job kind "${job.kind}".`);
  }
}

/** Load a strategy spec and its parsed DSL, or throw a coded error the queue records. */
async function loadSpecDsl(specId: unknown) {
  if (typeof specId !== "string" || specId.trim().length === 0) {
    throw new Error("A specId is required.");
  }
  const spec = getDb().select().from(schema.strategySpecs).all().find((row) => row.id === specId);
  if (!spec) throw new Error(`SPEC_NOT_FOUND: ${specId}`);
  const { StrategyDslSchema } = await import("@/lib/strategy/dsl");
  const parsed = StrategyDslSchema.safeParse(JSON.parse(spec.dsl));
  if (!parsed.success) throw new Error(`DSL_INVALID: ${specId} does not parse against the current compiler.`);
  return { spec, dsl: parsed.data };
}

/**
 * Backtest one strategy over the canonical store, persist the experiment, and announce the real
 * specId — the engine's own emit reports "unknown", which cannot wake a spec-scoped dependent.
 *
 * Deterministic and re-runnable: it reads a recorded snapshot (never the provider) and spends
 * nothing irreversible, which is why it is a READ capability and safe as autonomous durable work.
 */
async function runBacktestJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  const { spec, dsl } = await loadSpecDsl((job.payload as { specId?: unknown }).specId);
  const { snapshotFromStore } = await import("@/lib/research-data/snapshot");
  const snapshot = snapshotFromStore(dsl.universe.market, dsl.universe.resolution, "backtest");
  if (!snapshot.ok) throw new Error(`${snapshot.code}: ${snapshot.message}`);

  const { runPortfolioBacktest } = await import("@/lib/backtest/portfolio");
  const result = runPortfolioBacktest(dsl, snapshot.dataset, {
    datasetFingerprint: snapshot.fingerprint,
    datasetSnapshotId: snapshot.snapshotId,
  });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);

  const { recordExperiment } = await import("@/lib/research-data/snapshot");
  const { COMPILER_VERSION } = await import("@/lib/strategy/dsl");
  const experimentId = recordExperiment({
    specId: spec.id,
    snapshotId: snapshot.snapshotId,
    kind: "rehearsal",
    engineVersion: COMPILER_VERSION,
    executionProfileId: result.execution?.profileId ?? null,
    summary: `Backtest over ${snapshot.instruments.length} instrument(s): ${result.trades.length} trade(s).`,
    trades: result.trades,
    actor: "autonomous_worker",
  });

  const pnl = result.evidence.inSampleReturns.reduce((sum, value) => sum + value, 0);
  emit({ kind: "BACKTEST_COMPLETED", specId: spec.id, instrumentId: dsl.universe.market, trades: result.trades.length, pnl });
  return { ok: true, specId: spec.id, experimentId, tradeCount: result.trades.length, snapshotId: snapshot.snapshotId };
}

/**
 * Run the validation gauntlet — DOUBLE-GATED, because a trial is permanent and irreversible.
 *
 * The gauntlet raises the multiple-testing bar for the whole strategy family forever, so this
 * handler refuses unless BOTH hold: the job was created with `confirmed: true` (an explicit
 * intent marker on the job, never a default), AND the deterministic Trial Budget Governor
 * authorizes the spend. The governor — not this handler, and not any generic allowlist — is the
 * sole authority: it checks the dedicated autonomous-trial lane switch (off by default), the
 * candidate's selection guards, the freeze, and the daily budget. A refusal FAILS the job with a
 * named reason and spends nothing. Nothing in the autonomous loop enqueues this kind; it is
 * reached only by an explicit owner/API-created job, and even then the governor may refuse.
 */
async function runValidationJob(job: ClaimedJob): Promise<Record<string, unknown>> {
  const payload = job.payload as { specId?: unknown; confirmed?: unknown };
  if (payload.confirmed !== true) {
    throw new Error("VALIDATION_UNCONFIRMED: a validation job spends a permanent trial and requires confirmed:true.");
  }

  const { spec, dsl } = await loadSpecDsl(payload.specId);

  // The Trial Budget Governor is the sole authorizer. It reuses the selection guards (canonical
  // identity, rehearsed rung, cost honesty, capital fit) and adds the lane switch + freeze +
  // budget. `withAuthorizedTrial` holds the trial mutex across the whole authorize→spend section,
  // so the budget is atomic even when this job races the autonomous cycle or a second validation
  // job. A confirmed job is still refused unless the governor says yes.
  const { selectTrialCandidates } = await import("@/lib/strategy/auto-gauntlet");
  const { withAuthorizedTrial } = await import("@/lib/strategy/trial-governor");
  const candidate = selectTrialCandidates(new Date()).find((entry) => entry.specId === spec.id) ?? null;

  return withAuthorizedTrial({ candidate }, async (authorization) => {
    if (!authorization.approved) {
      // Refused before any reservation was consumed — no trial spent.
      throw new Error(`TRIAL_NOT_AUTHORIZED: ${authorization.code} — ${authorization.reason}`);
    }

    const { snapshotFromStore } = await import("@/lib/research-data/snapshot");
    const snapshot = snapshotFromStore(dsl.universe.market, dsl.universe.resolution, "validation");
    if (!snapshot.ok) throw new Error(`${snapshot.code}: ${snapshot.message}`);

    const { runPortfolioBacktest } = await import("@/lib/backtest/portfolio");
    const backtest = runPortfolioBacktest(dsl, snapshot.dataset, {
      datasetFingerprint: snapshot.fingerprint,
      datasetSnapshotId: snapshot.snapshotId,
    });
    if (!backtest.ok) throw new Error(`${backtest.code}: ${backtest.message}`);

    const { runGauntlet } = await import("@/lib/strategy/gauntlet");
    const report = runGauntlet(
      spec.id,
      dsl,
      { ...backtest.evidence, executionProfileId: backtest.execution?.profileId ?? null },
      "autonomous_worker",
    );
    // The gauntlet recorded its selection trial, so the wrapper will CONSUME the reservation from
    // the ledger regardless of what happens next — the completion event is best-effort.
    try {
      emit({ kind: "VALIDATION_COMPLETED", specId: spec.id, verdict: report.passed ? "PASSED" : "FAILED" });
    } catch {
      // A failed notification must not obscure a spent trial.
    }
    return { ok: true, specId: spec.id, passed: report.passed, trialsCounted: report.trialsCounted, summary: report.summary };
  });
}

/**
 * Drains up to `maxJobs` from the queue. This is the deterministic half of the system:
 * it runs on a schedule with Claude Code closed and needs no model to make progress.
 *
 * `budgetMs` stops CLAIMING new jobs once spent; a job already running is never interrupted. A
 * count alone cannot bound a pass whose jobs are network fetches of 1-6 seconds each, and the
 * scheduled cycle must finish inside its lease or the next cycle takes over mid-pass.
 */
export async function runWorker(
  workerId = "worker-1",
  maxJobs = 10,
  { budgetMs = Number.POSITIVE_INFINITY }: { budgetMs?: number } = {},
): Promise<WorkerResult> {
  const result: WorkerResult = { processed: 0, succeeded: 0, failed: 0, dead: 0, idle: true };
  const deadline = Date.now() + budgetMs;

  for (let index = 0; index < maxJobs && Date.now() < deadline; index += 1) {
    const job = claimNextJob(workerId);
    if (!job) break;

    result.idle = false;
    result.processed += 1;

    try {
      completeJob(job.id, await runJob(job));
      result.succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = failJob(job.id, message);
      result.failed += 1;
      if (!outcome.retrying) {
        result.dead += 1;
        // A permanently failed job becomes durable failure memory so the same
        // dead end is visible to future research rather than silently retried.
        recordFailure("system", `job_${job.kind}`, message, String(job.id), "Job exhausted its retries.");
      }
    }
  }

  return result;
}
