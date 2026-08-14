import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Brain activity projection — a unified timeline from existing durable ledgers.
 *
 * This is intentionally a PROJECTION, not a new authoritative event store. It reads
 * from the sources of truth (jobs, audit_events, agent_runs, autonomous_runs, etc.)
 * and normalizes them into a common view for Brain and MCP.
 */

export type ActivityCategory =
  | "runtime"
  | "job"
  | "research"
  | "strategy"
  | "forward"
  | "paper"
  | "data"
  | "system"
  | "learning";

export interface ActivityItem {
  id: string;
  occurredAt: Date;
  category: ActivityCategory;
  runId: string | null;
  entityType: string | null;
  entityId: string | null;
  action: string;
  status: string | null;
  title: string;
  detail: string | null;
  sourceLedger: string;
}

export interface ActivityQuery {
  limit?: number;
  category?: ActivityCategory;
  since?: Date;
  runId?: string;
}

export function getActivityTimeline(query: ActivityQuery = {}): ActivityItem[] {
  const limit = query.limit ?? 50;
  const since = query.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Timestamps are stored as Unix seconds (mode: "timestamp" on integer columns).
  const sinceSec = Math.floor(since.getTime() / 1000);

  const items: ActivityItem[] = [];

  // 1. Job events
  const jobEvents = getDb()
    .select({
      createdAt: schema.researchJobEvents.createdAt,
      event: schema.researchJobEvents.event,
      detail: schema.researchJobEvents.detail,
      jobId: schema.researchJobEvents.jobId,
      jobKind: schema.researchJobs.kind,
      jobStatus: schema.researchJobs.status,
    })
    .from(schema.researchJobEvents)
    .innerJoin(schema.researchJobs, eq(schema.researchJobEvents.jobId, schema.researchJobs.id))
    .where(sql`${schema.researchJobEvents.createdAt} >= ${sinceSec}`)
    .orderBy(desc(schema.researchJobEvents.createdAt))
    .limit(limit)
    .all();

  for (const evt of jobEvents) {
    items.push({
      id: `job_evt_${evt.jobId}_${evt.createdAt.getTime()}`,
      occurredAt: evt.createdAt,
      category: "job",
      runId: null,
      entityType: "research_job",
      entityId: String(evt.jobId),
      action: evt.event,
      status: evt.jobStatus,
      title: `${evt.jobKind}: ${evt.event}`,
      detail: evt.detail,
      sourceLedger: "research_job_events",
    });
  }

  // 2. Audit events
  const auditEvents = getDb()
    .select()
    .from(schema.auditEvents)
    .where(sql`${schema.auditEvents.createdAt} >= ${sinceSec}`)
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(limit)
    .all();

  for (const evt of auditEvents) {
    items.push({
      id: `audit_${evt.id}`,
      occurredAt: evt.createdAt,
      category: evt.action.includes("autonomous") ? "runtime" : "system",
      runId: evt.subject?.startsWith("arun_") ? evt.subject : null,
      entityType: null,
      entityId: evt.subject,
      action: evt.action,
      status: evt.decision,
      title: formatAuditTitle(evt.action),
      detail: evt.detail,
      sourceLedger: "audit_events",
    });
  }

  // 3. Agent runs (model calls)
  const agentRuns = getDb()
    .select()
    .from(schema.agentRuns)
    .where(sql`${schema.agentRuns.startedAt} >= ${sinceSec}`)
    .orderBy(desc(schema.agentRuns.startedAt))
    .limit(Math.ceil(limit / 2))
    .all();

  for (const run of agentRuns) {
    items.push({
      id: `agent_${run.id}`,
      occurredAt: run.startedAt,
      category: "research",
      runId: null,
      entityType: "agent_run",
      entityId: run.id,
      action: run.capability,
      status: run.status,
      title: `${run.capability}: ${run.status}`,
      detail: run.instrumentId ?? null,
      sourceLedger: "agent_runs",
    });
  }

  // 4. Autonomous runs
  const runs = getDb()
    .select()
    .from(schema.autonomousRuns)
    .where(sql`${schema.autonomousRuns.startedAt} >= ${sinceSec}`)
    .orderBy(desc(schema.autonomousRuns.startedAt))
    .limit(Math.ceil(limit / 3))
    .all();

  for (const run of runs) {
    items.push({
      id: `run_${run.id}`,
      occurredAt: run.startedAt,
      category: "runtime",
      runId: run.id,
      entityType: "autonomous_run",
      entityId: run.id,
      action: `run_${run.status.toLowerCase()}`,
      status: run.status,
      title: `Autonomous run ${run.status.toLowerCase()}`,
      detail: run.reason ?? run.nextAction,
      sourceLedger: "autonomous_runs",
    });
  }

  // 5. Research hypotheses
  const hypotheses = getDb()
    .select()
    .from(schema.researchHypotheses)
    .where(sql`${schema.researchHypotheses.createdAt} >= ${sinceSec}`)
    .orderBy(desc(schema.researchHypotheses.createdAt))
    .limit(Math.ceil(limit / 3))
    .all();

  for (const h of hypotheses) {
    items.push({
      id: `hyp_${h.id}`,
      occurredAt: h.createdAt,
      category: "research",
      runId: null,
      entityType: "hypothesis",
      entityId: h.id,
      action: "hypothesis_registered",
      status: h.status,
      title: h.title,
      detail: h.statement.slice(0, 200),
      sourceLedger: "research_hypotheses",
    });
  }

  // 6. Forward challengers
  const challengers = getDb()
    .select()
    .from(schema.forwardChallengers)
    .where(sql`${schema.forwardChallengers.activatedAt} >= ${sinceSec}`)
    .orderBy(desc(schema.forwardChallengers.activatedAt))
    .limit(Math.ceil(limit / 4))
    .all();

  for (const c of challengers) {
    items.push({
      id: `challenger_${c.id}`,
      occurredAt: c.activatedAt,
      category: "forward",
      runId: null,
      entityType: "forward_challenger",
      entityId: c.id,
      action: `challenger_${c.status.toLowerCase()}`,
      status: c.status,
      title: `Forward challenger ${c.status.toLowerCase()}`,
      detail: c.strategySpecId,
      sourceLedger: "forward_challengers",
    });
  }

  // 7. Paper orders
  const paperOrders = getDb()
    .select()
    .from(schema.paperOrders)
    .where(sql`${schema.paperOrders.createdAt} >= ${sinceSec}`)
    .orderBy(desc(schema.paperOrders.createdAt))
    .limit(Math.ceil(limit / 4))
    .all();

  for (const o of paperOrders) {
    items.push({
      id: `paper_order_${o.id}`,
      occurredAt: o.createdAt,
      category: "paper",
      runId: null,
      entityType: "paper_order",
      entityId: String(o.id),
      action: `paper_${o.status.toLowerCase()}`,
      status: o.status,
      title: `Paper ${o.side} ${o.instrumentId}`,
      detail: `${o.quantity} @ ${o.fillPrice ?? o.limitPrice ?? "?"}`,
      sourceLedger: "paper_orders",
    });
  }

  const filtered = query.category ? items.filter((i) => i.category === query.category) : items;
  const runFiltered = query.runId ? filtered.filter((i) => i.runId === query.runId) : filtered;

  return runFiltered
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit);
}

export function getActivityCounts(since?: Date): Record<ActivityCategory, number> {
  const items = getActivityTimeline({ limit: 1000, since });
  const counts = {
    runtime: 0,
    job: 0,
    research: 0,
    strategy: 0,
    forward: 0,
    paper: 0,
    data: 0,
    system: 0,
    learning: 0,
  };
  for (const item of items) {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
  }
  return counts as Record<ActivityCategory, number>;
}

function formatAuditTitle(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
