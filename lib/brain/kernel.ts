/**
 * MarketPulse Brain Kernel — the central operational hub.
 *
 * Owns:
 * - Capability Registry (what the system CAN do)
 * - Event Bus subscriptions (what IS happening)
 * - System State (current state of all lanes)
 * - Lane States (Observe, Learn, Evolve + operational lanes)
 *
 * Brain is NOT an LLM. Brain is the ORCHESTRATOR.
 * LLM is a tool Brain uses for non-deterministic reasoning.
 */

import { getDb, schema } from "@/lib/db";
import { emit, subscribeAll, type MarketPulseEvent } from "./event-bus";
import { registerCoreCapabilities, updateCapabilityHealth, getAllCapabilities, capabilitySummary, type CapabilityHealth } from "./capability-registry";
import { type DetectedProvider } from "@/lib/runtime/providers";
import { detectProviders } from "@/lib/runtime/gateway";
import { liveRun, type AutonomousRun } from "@/lib/runtime/supervisor";
import { queueStats, listJobs } from "@/lib/research/queue";
import { listGraveyard } from "@/lib/strategy/graveyard";
import { systemReadiness } from "@/lib/product/readiness";
import { learningMetrics } from "@/lib/learning/metrics";

// ─── Lane Definitions ────────────────────────────────────────--

export type LaneState = "ACTIVE" | "WAITING" | "BLOCKED" | "IDLE" | "FAILED" | "THROTTLED";

export interface LaneStatus {
  name: string;
  state: LaneState;
  reason: string;
  lastAction: string | null;
  lastActionAt: string | null;
}

export type LaneName =
  | "observe"
  | "learn"
  | "evolve"
  | "data"
  | "scanner"
  | "research"
  | "strategy"
  | "backtest"
  | "validation"
  | "forward"
  | "paper"
  | "memory"
  | "repair"
  | "sre";

// ─── Brain State ───────────────────────────────────────────────

export interface BrainState {
  // Top-level mode: always RUN
  mode: "RUN" | "MAINTENANCE" | "STOPPED";
  // Is the autonomous runtime ticking?
  runtimeRunning: boolean;
  // Current autonomous run info
  autonomousRun: AutonomousRun | null;
  // All lanes
  lanes: Record<LaneName, LaneStatus>;
  // Provider status
  providers: DetectedProvider[];
  // Capability summary
  capabilities: ReturnType<typeof capabilitySummary>;
  // Queue stats
  queue: ReturnType<typeof queueStats>;
  // Recent events (last 20)
  recentEvents: MarketPulseEvent[];
  // System readiness
  readiness: ReturnType<typeof systemReadiness>;
  // Last updated
  updatedAt: string;
}

// ─── Brain Kernel ──────────────────────────────────────────────

const BRAIN_KEY = Symbol.for("marketpulse.brain");

interface BrainState_ {
  initialized: boolean;
  recentEvents: MarketPulseEvent[];
  laneStates: Record<LaneName, LaneStatus>;
  unsub: (() => void) | null;
}

function brainState(): BrainState_ {
  const store = globalThis as unknown as Record<symbol, BrainState_ | undefined>;
  store[BRAIN_KEY] ??= {
    initialized: false,
    recentEvents: [],
    laneStates: getDefaultLaneStates(),
    unsub: null,
  };
  return store[BRAIN_KEY] as BrainState_;
}

function getDefaultLaneStates(): Record<LaneName, LaneStatus> {
  return {
    observe: { name: "Observe", state: "ACTIVE", reason: "Continuous market observation", lastAction: null, lastActionAt: null },
    learn: { name: "Learn", state: "ACTIVE", reason: "Continuous learning", lastAction: null, lastActionAt: null },
    evolve: { name: "Evolve", state: "WAITING", reason: "Awaiting improvement opportunities", lastAction: null, lastActionAt: null },
    data: { name: "Data", state: "ACTIVE", reason: "Market data ingestion", lastAction: null, lastActionAt: null },
    scanner: { name: "Scanner", state: "WAITING", reason: "Awaiting market hours", lastAction: null, lastActionAt: null },
    research: { name: "Research", state: "WAITING", reason: "Awaiting research queue", lastAction: null, lastActionAt: null },
    strategy: { name: "Strategy", state: "WAITING", reason: "Awaiting candidates", lastAction: null, lastActionAt: null },
    backtest: { name: "Backtest", state: "ACTIVE", reason: "Backtest engine ready", lastAction: null, lastActionAt: null },
    validation: { name: "Validation", state: "ACTIVE", reason: "Validation gauntlet ready", lastAction: null, lastActionAt: null },
    forward: { name: "Forward", state: "WAITING", reason: "Awaiting challenger activation", lastAction: null, lastActionAt: null },
    paper: { name: "Paper", state: "ACTIVE", reason: "Paper trading engine ready", lastAction: null, lastActionAt: null },
    memory: { name: "Memory", state: "ACTIVE", reason: "Memory system active", lastAction: null, lastActionAt: null },
    repair: { name: "Repair", state: "IDLE", reason: "No incidents detected", lastAction: null, lastActionAt: null },
    sre: { name: "SRE", state: "ACTIVE", reason: "Observability active", lastAction: null, lastActionAt: null },
  };
}

/**
 * Initialize the Brain Kernel. Called once at server startup.
 * Registers capabilities, subscribes to events, detects providers.
 */
export async function initializeBrain(): Promise<void> {
  const state = brainState();
  if (state.initialized) return;

  // Register all capabilities
  registerCoreCapabilities();

  // Subscribe to ALL events to maintain real-time state
  state.unsub = subscribeAll((event) => {
    state.recentEvents.unshift(event);
    if (state.recentEvents.length > 50) {
      state.recentEvents = state.recentEvents.slice(0, 50);
    }
    updateLanesFromEvent(event);
  });

  // Detect providers
  try {
    const providers = await detectProviders();
    const hasHealthy = providers.some((p: DetectedProvider) => p.status === "READY");
    updateCapabilityHealth("agents.gateway", hasHealthy ? "READY" : "UNAVAILABLE",
      hasHealthy ? `${providers.filter((p: DetectedProvider) => p.status === "READY").length} provider(s) ready` : "No providers configured");
    updateCapabilityHealth("providers.manager", "READY");
    for (const provider of providers) {
      updateCapabilityHealth(`provider.${provider.id}` as any,
        provider.status === "READY" ? "READY" : "UNAVAILABLE",
        provider.reason);
    }
  } catch {
    updateCapabilityHealth("agents.gateway", "UNAVAILABLE", "Detection failed");
  }

  // Mark scheduler as ready
  updateCapabilityHealth("system.scheduler", "READY", "Supervisor ready to start");

  state.initialized = true;

  emit({
    kind: "SYSTEM_STARTED",
    systemId: process.env.MARKETPULSE_BOOT_ID ?? "unknown",
    at: new Date().toISOString(),
  });
}

function updateLanesFromEvent(event: MarketPulseEvent): void {
  const state = brainState();
  const now = event.at;

  switch (event.kind) {
    case "AUTONOMOUS_RUN_STARTED":
      state.laneStates.observe.state = "ACTIVE";
      state.laneStates.learn.state = "ACTIVE";
      break;
    case "AUTONOMOUS_RUN_STOPPED":
      state.laneStates.observe.state = "IDLE";
      state.laneStates.learn.state = "IDLE";
      state.laneStates.evolve.state = "IDLE";
      break;
    case "RESEARCH_STARTED":
      state.laneStates.research.state = "ACTIVE";
      state.laneStates.research.lastAction = `Researching ${event.instrumentId}`;
      state.laneStates.research.lastActionAt = now;
      break;
    case "RESEARCH_COMPLETED":
      state.laneStates.research.state = "WAITING";
      state.laneStates.research.lastAction = `${event.instrumentId}: ${event.verdict}`;
      state.laneStates.research.lastActionAt = now;
      break;
    case "SCANNER_COMPLETED":
      state.laneStates.scanner.state = "WAITING";
      state.laneStates.scanner.lastAction = `Scanned ${event.instrumentsScanned}, ${event.signals} signals`;
      state.laneStates.scanner.lastActionAt = now;
      break;
    case "STRATEGY_CREATED":
      state.laneStates.strategy.state = "ACTIVE";
      state.laneStates.strategy.lastAction = `Created ${event.name}`;
      state.laneStates.strategy.lastActionAt = now;
      break;
    case "BACKTEST_COMPLETED":
      state.laneStates.backtest.state = "ACTIVE";
      state.laneStates.backtest.lastAction = `${event.trades} trades, P&L ${event.pnl}`;
      state.laneStates.backtest.lastActionAt = now;
      break;
    case "VALIDATION_COMPLETED":
      state.laneStates.validation.state = "ACTIVE";
      state.laneStates.validation.lastAction = event.verdict;
      state.laneStates.validation.lastActionAt = now;
      break;
    case "FORWARD_SIGNAL_CREATED":
      state.laneStates.forward.state = "ACTIVE";
      state.laneStates.forward.lastAction = `Signal for ${event.instrumentId}`;
      state.laneStates.forward.lastActionAt = now;
      break;
    case "PAPER_ORDER_CREATED":
    case "PAPER_ORDER_FILLED":
    case "PAPER_POSITION_CLOSED":
      state.laneStates.paper.state = "ACTIVE";
      state.laneStates.paper.lastAction = `${event.kind.replace("_", " ").toLowerCase()}`;
      state.laneStates.paper.lastActionAt = now;
      break;
    case "JOB_COMPLETED":
      state.laneStates.learn.state = "ACTIVE";
      break;
    case "AGENT_COMPLETED":
      state.laneStates.research.state = "ACTIVE";
      break;
    case "INCIDENT_CREATED":
      state.laneStates.repair.state = "ACTIVE";
      state.laneStates.repair.lastAction = event.description;
      state.laneStates.repair.lastActionAt = now;
      break;
    case "REPAIR_COMPLETED":
      state.laneStates.repair.state = "IDLE";
      state.laneStates.repair.lastAction = event.action;
      state.laneStates.repair.lastActionAt = now;
      break;
    case "DATA_INGESTED":
      state.laneStates.data.state = "ACTIVE";
      state.laneStates.data.lastAction = `${event.bars} bars for ${event.instrumentId}`;
      state.laneStates.data.lastActionAt = now;
      break;
    case "LEARNING_CYCLE_COMPLETED":
      state.laneStates.learn.lastAction = `${event.actions} actions, ${event.skipped} skipped`;
      state.laneStates.learn.lastActionAt = now;
      break;
    case "MEMORY_PROMOTED":
      state.laneStates.memory.state = "ACTIVE";
      state.laneStates.memory.lastAction = `Promoted ${event.memoryId}`;
      state.laneStates.memory.lastActionAt = now;
      break;
    case "MODEL_SELECTED":
      // Provider activity
      break;
    case "SYSTEM_DEGRADED":
      state.laneStates.repair.state = "ACTIVE";
      state.laneStates.repair.reason = event.reason;
      break;
    case "SYSTEM_RECOVERED":
      state.laneStates.repair.state = "IDLE";
      state.laneStates.repair.reason = "System recovered";
      break;
  }
}

/**
 * Get the current Brain state — used by /brain page and API.
 */
export async function getBrainState(): Promise<BrainState> {
  const state = brainState();
  if (!state.initialized) {
    await initializeBrain();
  }

  const run = liveRun();
  const queue = queueStats();
  const readiness = systemReadiness();
  const providers = await detectProviders();
  const caps = capabilitySummary();

  // Update lane states based on current runtime state
  if (run) {
    state.laneStates.observe.state = "ACTIVE";
    state.laneStates.learn.state = "ACTIVE";
    // Evolve is ACTIVE when system is making progress
    const metrics = learningMetrics();
    if (metrics && !metrics.verdict.toLowerCase().includes("stall")) {
      state.laneStates.evolve.state = "ACTIVE";
      state.laneStates.evolve.reason = `Evolving: ${metrics.verdict}`;
    } else {
      state.laneStates.evolve.state = "WAITING";
      state.laneStates.evolve.reason = "Awaiting improvement opportunities";
    }
  } else {
    state.laneStates.observe.state = "IDLE";
    state.laneStates.learn.state = "IDLE";
    state.laneStates.evolve.state = "IDLE";
  }

  // Research lane: ACTIVE if jobs running
  if (queue.running > 0) {
    state.laneStates.research.state = "ACTIVE";
  } else if (queue.queued > 0) {
    state.laneStates.research.state = "WAITING";
  }

  return {
    mode: run ? "RUN" : "STOPPED",
    runtimeRunning: !!run,
    autonomousRun: run,
    lanes: { ...state.laneStates },
    providers,
    capabilities: caps,
    queue,
    recentEvents: [...state.recentEvents],
    readiness,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get lane states only (lightweight, for polling).
 */
export function getLaneStates(): Record<LaneName, LaneStatus> {
  return { ...brainState().laneStates };
}

/**
 * Get recent events (lightweight, for polling).
 */
export function getRecentEvents(count = 20): MarketPulseEvent[] {
  return brainState().recentEvents.slice(0, count);
}

/**
 * Shutdown the Brain Kernel.
 */
export function shutdownBrain(): void {
  const state = brainState();
  state.unsub?.();
  state.unsub = null;
  state.initialized = false;
}
