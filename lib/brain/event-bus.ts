/**
 * MarketPulse Event Bus — the system's central nervous system.
 *
 * Every major operation emits typed events here. Brain consumes them.
 * Jobs, Agents, Scheduler, and all subsystems publish through this bus.
 *
 * Events are persisted to the database for durability and replay.
 * In-memory subscribers get real-time notification.
 */

import { randomUUID } from "node:crypto";
import { getDb, schema } from "@/lib/db";

// ─── Event Types ───────────────────────────────────────────────

export type MarketPulseEvent =
  // System lifecycle
  | { kind: "SYSTEM_STARTED"; systemId: string; at: string }
  | { kind: "SYSTEM_STOPPED"; reason: string; at: string }
  | { kind: "SYSTEM_DEGRADED"; reason: string; at: string }
  | { kind: "SYSTEM_RECOVERED"; runId: string; at: string }
  // Autonomous run
  | { kind: "AUTONOMOUS_RUN_STARTED"; runId: string; profile: string; at: string }
  | { kind: "AUTONOMOUS_RUN_STOPPED"; runId: string; reason: string; at: string }
  | { kind: "AUTONOMOUS_TICK"; runId: string; tick: number; mode: string; at: string }
  // Jobs
  | { kind: "JOB_CREATED"; jobId: number; jobKind: string; capability: string; at: string }
  | { kind: "JOB_STARTED"; jobId: number; workerId: string; at: string }
  | { kind: "JOB_COMPLETED"; jobId: number; result: string; at: string }
  | { kind: "JOB_FAILED"; jobId: number; error: string; attempt: number; at: string }
  | { kind: "JOB_BLOCKED"; jobId: number; reason: string; at: string }
  // Agents
  | { kind: "AGENT_STARTED"; agentId: string; capability: string; provider: string; at: string }
  | { kind: "AGENT_COMPLETED"; agentId: string; result: string; tokens: number | null; cost: number | null; at: string }
  | { kind: "AGENT_FAILED"; agentId: string; error: string; at: string }
  // Models
  | { kind: "MODEL_SELECTED"; provider: string; model: string; capability: string; reason: string; at: string }
  | { kind: "MODEL_CALL_STARTED"; provider: string; model: string; at: string }
  | { kind: "MODEL_CALL_COMPLETED"; provider: string; model: string; tokens: number; latencyMs: number; cost: number | null; at: string }
  | { kind: "MODEL_CALL_FAILED"; provider: string; model: string; error: string; at: string }
  // Research
  | { kind: "RESEARCH_STARTED"; instrumentId: string; at: string }
  | { kind: "RESEARCH_COMPLETED"; instrumentId: string; proposalId: string; verdict: string; at: string }
  | { kind: "RESEARCH_FAILED"; instrumentId: string; reason: string; at: string }
  // Evidence
  | { kind: "EVIDENCE_PACKET_BUILT"; instrumentId: string; sourceCount: number; at: string }
  | { kind: "CITATIONS_VERIFIED"; instrumentId: string; verified: number; total: number; at: string }
  // Hypothesis
  | { kind: "HYPOTHESIS_CREATED"; hypothesisId: string; instrumentId: string; at: string }
  | { kind: "HYPOTHESIS_REJECTED"; hypothesisId: string; reason: string; at: string }
  // Strategy
  | { kind: "STRATEGY_CREATED"; specId: string; name: string; at: string }
  | { kind: "STRATEGY_REJECTED"; specId: string; reason: string; at: string }
  | { kind: "STRATEGY_ADVANCED"; specId: string; fromStage: string; toStage: string; at: string }
  // Backtest
  | { kind: "BACKTEST_STARTED"; specId: string; instrumentId: string; at: string }
  | { kind: "BACKTEST_COMPLETED"; specId: string; trades: number; pnl: number; at: string }
  // Validation
  | { kind: "VALIDATION_COMPLETED"; specId: string; verdict: string; at: string }
  // Holdout
  | { kind: "HOLDOUT_ACCESSED"; specId: string; granted: boolean; at: string }
  // Forward
  | { kind: "FORWARD_SIGNAL_CREATED"; signalId: string; instrumentId: string; at: string }
  | { kind: "FORWARD_SIGNAL_RESOLVED"; signalId: string; outcome: string; at: string }
  // Paper
  | { kind: "PAPER_ORDER_CREATED"; orderId: string; instrumentId: string; side: string; at: string }
  | { kind: "PAPER_ORDER_FILLED"; orderId: string; price: number; at: string }
  | { kind: "PAPER_ORDER_CANCELLED"; orderId: string; reason: string; at: string }
  | { kind: "PAPER_POSITION_CLOSED"; positionId: string; pnl: number; at: string }
  // Scanner
  | { kind: "SCANNER_COMPLETED"; instrumentsScanned: number; signals: number; at: string }
  // Data
  | { kind: "DATA_INGESTED"; instrumentId: string; bars: number; source: string; at: string }
  | { kind: "DATA_QUALITY_ALERT"; instrumentId: string; issue: string; at: string }
  // Learning
  | { kind: "LEARNING_CYCLE_COMPLETED"; cycleId: string; actions: number; skipped: number; at: string }
  | { kind: "MEMORY_PROMOTED"; memoryId: string; from: string; to: string; at: string }
  // Alpha
  | { kind: "ALPHA_HEALTH_UPDATED"; challengerId: string; status: string; at: string }
  // Incident / Repair
  | { kind: "INCIDENT_CREATED"; incidentId: string; severity: string; description: string; at: string }
  | { kind: "REPAIR_COMPLETED"; incidentId: string; action: string; at: string }
  // Capabilities
  | { kind: "CAPABILITY_REGISTERED"; capabilityId: string; name: string; at: string }
  | { kind: "CAPABILITY_HEALTH_CHANGED"; capabilityId: string; health: string; reason: string; at: string };

type EventKind = MarketPulseEvent["kind"];

// ─── Subscriber Types ──────────────────────────────────────────

export type EventSubscriber = (event: MarketPulseEvent) => void;

// ─── Event Bus ─────────────────────────────────────────────────

const SUB_KEY = Symbol.for("marketpulse.eventbus.subscribers");

interface BusState {
  subscribers: Map<EventKind, Set<EventSubscriber>>;
  globalSubscribers: Set<EventSubscriber>;
}

function busState(): BusState {
  const store = globalThis as unknown as Record<symbol, BusState | undefined>;
  store[SUB_KEY] ??= {
    subscribers: new Map(),
    globalSubscribers: new Set(),
  };
  return store[SUB_KEY] as BusState;
}

/**
 * Subscribe to a specific event kind.
 * Returns an unsubscribe function.
 */
export function subscribe(kind: EventKind, fn: EventSubscriber): () => void {
  const state = busState();
  if (!state.subscribers.has(kind)) {
    state.subscribers.set(kind, new Set());
  }
  state.subscribers.get(kind)!.add(fn);
  return () => {
    state.subscribers.get(kind)?.delete(fn);
  };
}

/**
 * Subscribe to all events.
 * Returns an unsubscribe function.
 */
export function subscribeAll(fn: EventSubscriber): () => void {
  const state = busState();
  state.globalSubscribers.add(fn);
  return () => {
    state.globalSubscribers.delete(fn);
  };
}

/**
 * Publish an event. Persists to DB and notifies all subscribers.
 */
export function publish(event: MarketPulseEvent): void {
  // Persist to the durable ledger.
  //
  // This deliberately does NOT catch. It used to, with the comment "event persistence must not
  // break the publisher" — but that guarantee is incompatible with the one callers actually rely
  // on. `completeJob` (lib/research/queue.ts:187) wraps `mutate + emit` in a single
  // `getDb().transaction(...)` precisely so the domain change and its event land together or not
  // at all. Swallowing the insert failure inside that transaction let the mutation COMMIT while
  // the event vanished: the job showed as succeeded with nothing in the ledger to say so.
  //
  // For a system whose entire premise is that evidence is durable, silently losing the evidence
  // is strictly worse than surfacing the database fault. Letting this throw aborts the enclosing
  // transaction, so "both or neither" is enforced by SQLite rather than merely claimed in a
  // docstring. Callers outside a transaction now see a real DB fault instead of a silent gap.
  getDb()
    .insert(schema.auditEvents)
    .values({
      actor: "system:event-bus",
      action: event.kind,
      decision: "allowed",
      denialCode: null,
      subject: extractSubject(event),
      detail: JSON.stringify(event).slice(0, 500),
      learningMode: null,
      createdAt: new Date(event.at),
    })
    .run();

  // Notify in-memory subscribers
  const state = busState();
  state.subscribers.get(event.kind)?.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // Subscriber errors must not break the bus
    }
  });
  state.globalSubscribers.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // Subscriber errors must not break the bus
    }
  });
}

function extractSubject(event: MarketPulseEvent): string {
  const e = event as Record<string, unknown>;
  return String(
    e.runId ?? e.jobId ?? e.agentId ?? e.instrumentId ?? e.specId ?? e.capabilityId ?? e.incidentId ?? event.kind,
  );
}

/**
 * Publish an event with automatic timestamp.
 * Caller provides all fields except 'at' (which is auto-added).
 */
export function emit(event: Record<string, unknown> & { kind: string; at?: string }): void {
  publish({
    ...event,
    at: event.at ?? new Date().toISOString(),
  } as MarketPulseEvent);
}

/** Generate a unique event-scoped ID. */
export function eventId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
