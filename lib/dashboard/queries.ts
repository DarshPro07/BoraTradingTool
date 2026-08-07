import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getLearningMode } from "@/lib/governance/runtime";
import { AUTONOMOUS_PROHIBITED } from "@/lib/governance/policy";
import { fetchQuantResource, quantCoreStatus } from "@/lib/quantcore/client";
import { listAnalyses } from "@/lib/analyst/service";
import { listAudit } from "@/lib/knowledge/repository";
import { listJobs, queueStats } from "@/lib/research/queue";
import { listProposals, proposalStats } from "@/lib/learning/evolution";
import { masteryByPlane, nextCurriculum } from "@/lib/learning/curriculum";
import { executionCapabilities } from "@/lib/trading/capabilities";

export async function commandCenter() {
  const [status, board] = await Promise.all([quantCoreStatus(), fetchQuantResource("board")]);
  const db = getDb();

  const sources = db.select().from(schema.knowledgeSources).all();
  const claims = db.select().from(schema.knowledgeClaims).all();
  const hypotheses = db.select().from(schema.researchHypotheses).all();
  const specs = db.select().from(schema.strategySpecs).all();
  const trials = db.select().from(schema.trials).all();
  const outcomes = db.select().from(schema.forwardOutcomes).all();

  return {
    learningMode: getLearningMode(),
    execution: executionCapabilities,
    quantCore: status,
    board,
    counts: {
      sources: sources.length,
      claims: claims.length,
      hypotheses: hypotheses.filter((row) => row.status !== "duplicate").length,
      duplicateHypotheses: hypotheses.filter((row) => row.status === "duplicate").length,
      strategies: specs.length,
      paperChallengers: specs.filter((row) => row.status === "paper_challenger").length,
      trials: trials.length,
      failedTrials: trials.filter((row) => row.verdict === "fail").length,
      forwardOutcomes: outcomes.length,
    },
    queue: queueStats(),
    proposals: proposalStats(),
    recentAnalyses: listAnalyses(5),
  };
}

export function researchFunnel() {
  const db = getDb();
  const sources = db.select().from(schema.knowledgeSources).all();
  const claims = db.select().from(schema.knowledgeClaims).all();
  const hypotheses = db.select().from(schema.researchHypotheses).all();
  const specs = db.select().from(schema.strategySpecs).all();

  return {
    sources: {
      total: sources.length,
      byKind: sources.reduce<Record<string, number>>((totals, row) => {
        totals[row.kind] = (totals[row.kind] ?? 0) + 1;
        return totals;
      }, {}),
      rejected: sources.filter((row) => row.status === "rejected").length,
    },
    claims: {
      total: claims.length,
      byStatus: claims.reduce<Record<string, number>>((totals, row) => {
        totals[row.epistemicStatus] = (totals[row.epistemicStatus] ?? 0) + 1;
        return totals;
      }, {}),
      verified: claims.filter((row) => row.verifiedAt !== null).length,
    },
    hypotheses: {
      total: hypotheses.length,
      active: hypotheses.filter((row) => row.status === "proposed" || row.status === "accepted").length,
      duplicates: hypotheses.filter((row) => row.status === "duplicate").length,
      rejected: hypotheses.filter((row) => row.status === "rejected").length,
    },
    strategies: {
      total: specs.length,
      byStatus: specs.reduce<Record<string, number>>((totals, row) => {
        totals[row.status] = (totals[row.status] ?? 0) + 1;
        return totals;
      }, {}),
    },
  };
}

export function strategyLab() {
  const db = getDb();
  const specs = db.select().from(schema.strategySpecs).orderBy(desc(schema.strategySpecs.createdAt)).all();
  const validations = db.select().from(schema.validationResults).all();
  const trials = db.select().from(schema.trials).all();

  return specs.map((spec) => {
    const specTrials = trials.filter((trial) => trial.strategySpecId === spec.id);
    const latest = validations
      .filter((validation) => validation.strategySpecId === spec.id)
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime())[0];

    return {
      id: spec.id,
      name: spec.name,
      version: spec.version,
      status: spec.status,
      parentId: spec.parentId,
      createdAt: spec.createdAt,
      trials: specTrials.length,
      failedTrials: specTrials.filter((trial) => trial.verdict === "fail").length,
      validation: latest
        ? {
            passed: latest.passed === 1,
            oosProfitFactor: latest.oosProfitFactor,
            deflatedSharpe: latest.deflatedSharpe,
            pbo: latest.pbo,
            costMultiplePf: latest.costMultiplePf,
            trialsCounted: latest.trialsCounted,
            evaluatedAt: latest.evaluatedAt,
          }
        : null,
    };
  });
}

export function experimentLedger(limit = 100) {
  const db = getDb();
  const trials = db.select().from(schema.trials).orderBy(desc(schema.trials.id)).limit(limit).all();
  const specs = new Map(db.select().from(schema.strategySpecs).all().map((spec) => [spec.id, spec]));

  return trials.map((trial) => ({
    id: trial.id,
    strategy: specs.get(trial.strategySpecId)?.name ?? trial.strategySpecId,
    kind: trial.kind,
    verdict: trial.verdict,
    reason: trial.reason,
    metrics: trial.metrics ? (JSON.parse(trial.metrics) as Record<string, unknown>) : null,
    actor: trial.actor,
    startedAt: trial.startedAt,
  }));
}

export function researchLibrary() {
  const db = getDb();
  const sources = db.select().from(schema.knowledgeSources).orderBy(desc(schema.knowledgeSources.ingestedAt)).all();
  const claims = db.select().from(schema.knowledgeClaims).all();

  return sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    title: source.title,
    url: source.url,
    license: source.license,
    status: source.status,
    rejectionReason: source.rejectionReason,
    ingestedAt: source.ingestedAt,
    claims: claims.filter((claim) => claim.sourceId === source.id).length,
  }));
}

export function analystDesk() {
  const db = getDb();
  return {
    analyses: listAnalyses(20),
    lessons: db.select().from(schema.knowledgeLessons).orderBy(desc(schema.knowledgeLessons.createdAt)).limit(20).all(),
    concepts: db.select().from(schema.knowledgeConcepts).all(),
    curriculum: nextCurriculum(undefined, 8),
    mastery: masteryByPlane(),
  };
}

export function agentsAndJobs() {
  return {
    queue: queueStats(),
    jobs: listJobs(undefined, 30),
    proposals: listProposals(undefined, 30),
    proposalStats: proposalStats(),
    learningMode: getLearningMode(),
  };
}

export async function dataQuality() {
  const [health, board, forward] = await Promise.all([
    fetchQuantResource("health"),
    fetchQuantResource("board"),
    fetchQuantResource("forwardOutcomes"),
  ]);
  const [universe, regime, trials] = await Promise.all([
    fetchQuantResource("universe"),
    fetchQuantResource("regime"),
    fetchQuantResource("trials"),
  ]);

  return { health, board, forward, universe, regime, trials };
}

export function auditView(limit = 200) {
  const db = getDb();
  const events = listAudit(limit);
  return {
    events,
    denied: events.filter((event) => event.decision === "denied").length,
    prohibited: AUTONOMOUS_PROHIBITED,
    failures: db.select().from(schema.failureMemory).orderBy(desc(schema.failureMemory.id)).limit(50).all(),
    learningMode: getLearningMode(),
    execution: executionCapabilities,
  };
}

export function memoryGraphRoots() {
  const db = getDb();
  return {
    sources: db.select().from(schema.knowledgeSources).orderBy(desc(schema.knowledgeSources.ingestedAt)).limit(50).all(),
    strategies: db.select().from(schema.strategySpecs).all(),
    lessonCount: db.select().from(schema.knowledgeLessons).all().length,
    contradictions: db.select().from(schema.knowledgeContradictions).all(),
  };
}

export function conceptById(id: string) {
  return getDb().select().from(schema.knowledgeConcepts).where(eq(schema.knowledgeConcepts.id, id)).get() ?? null;
}
