/**
 * MarketPulse Capability Registry — what the system CAN do.
 *
 * Every meaningful executable capability has a machine-readable descriptor.
 * Brain reads this to know what exists, what's healthy, and how to invoke it.
 */

export type CapabilityHealth = "READY" | "ACTIVE" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";

export interface CapabilityDescriptor {
  capabilityId: string;
  name: string;
  domain: string;
  description: string;
  implementation: string; // file path
  health: CapabilityHealth;
  healthReason: string;
  deterministic: boolean;
  requiresLLM: boolean;
  requiresMarketData: boolean;
  lastSuccessfulRun: string | null;
  lastFailure: string | null;
  metrics: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
  };
}

// ─── Registry ──────────────────────────────────────────────────

const REG_KEY = Symbol.for("marketpulse.capability-registry");

interface RegistryState {
  capabilities: Map<string, CapabilityDescriptor>;
}

function registryState(): RegistryState {
  const store = globalThis as unknown as Record<symbol, RegistryState | undefined>;
  store[REG_KEY] ??= { capabilities: new Map() };
  return store[REG_KEY] as RegistryState;
}

/**
 * Register a capability. Idempotent — re-registering updates the descriptor.
 */
export function registerCapability(descriptor: CapabilityDescriptor): void {
  const state = registryState();
  state.capabilities.set(descriptor.capabilityId, descriptor);
}

/**
 * Update a capability's health.
 */
export function updateCapabilityHealth(
  capabilityId: string,
  health: CapabilityHealth,
  reason?: string,
): void {
  const state = registryState();
  const cap = state.capabilities.get(capabilityId);
  if (!cap) return;
  cap.health = health;
  if (reason) cap.healthReason = reason;
  if (health === "ACTIVE" || health === "READY") {
    cap.lastSuccessfulRun = new Date().toISOString();
    cap.metrics.successfulRuns++;
    cap.metrics.totalRuns++;
  }
  if (health === "DEGRADED" || health === "UNAVAILABLE") {
    cap.lastFailure = new Date().toISOString();
    cap.metrics.failedRuns++;
    cap.metrics.totalRuns++;
  }
}

/**
 * Get a single capability.
 */
export function getCapability(capabilityId: string): CapabilityDescriptor | undefined {
  return registryState().capabilities.get(capabilityId);
}

/**
 * Get all registered capabilities.
 */
export function getAllCapabilities(): CapabilityDescriptor[] {
  return [...registryState().capabilities.values()];
}

/**
 * Get capabilities by domain.
 */
export function getCapabilitiesByDomain(domain: string): CapabilityDescriptor[] {
  return getAllCapabilities().filter((c) => c.domain === domain);
}

/**
 * Get capabilities by health status.
 */
export function getCapabilitiesByHealth(health: CapabilityHealth): CapabilityDescriptor[] {
  return getAllCapabilities().filter((c) => c.health === health);
}

/**
 * Get a summary of the entire capability graph.
 */
export function capabilitySummary(): {
  total: number;
  ready: number;
  active: number;
  degraded: number;
  unavailable: number;
  unknown: number;
  domains: Record<string, number>;
} {
  const all = getAllCapabilities();
  const domains: Record<string, number> = {};
  for (const cap of all) {
    domains[cap.domain] = (domains[cap.domain] ?? 0) + 1;
  }
  return {
    total: all.length,
    ready: all.filter((c) => c.health === "READY").length,
    active: all.filter((c) => c.health === "ACTIVE").length,
    degraded: all.filter((c) => c.health === "DEGRADED").length,
    unavailable: all.filter((c) => c.health === "UNAVAILABLE").length,
    unknown: all.filter((c) => c.health === "UNKNOWN").length,
    domains,
  };
}

/**
 * Register all core MarketPulse capabilities.
 * Called once at system startup.
 */
export function registerCoreCapabilities(): void {
  const now = new Date().toISOString();

  const capabilities: CapabilityDescriptor[] = [
    // System
    { capabilityId: "system.identity", name: "System Identity", domain: "system", description: "System identity and version", implementation: "lib/system/identity.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },
    { capabilityId: "system.readiness", name: "System Readiness", domain: "system", description: "Readiness probe for all subsystems", implementation: "lib/product/readiness.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },
    { capabilityId: "system.scheduler", name: "Autonomous Scheduler", domain: "system", description: "60-second ticker with crash recovery", implementation: "lib/runtime/supervisor.ts", health: "UNKNOWN", healthReason: "Not started", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: null, lastFailure: null, metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 } },
    { capabilityId: "system.brain", name: "Brain Kernel", domain: "system", description: "Central operational hub", implementation: "lib/brain/kernel.ts", health: "READY", healthReason: "Registered", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // NSE / Market
    { capabilityId: "nse.identity", name: "NSE Identity", domain: "data", description: "Canonical NSE instrument identity", implementation: "lib/market/canonical-identity.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },
    { capabilityId: "nse.security-master", name: "NSE Security Master", domain: "data", description: "NSE securities master sync", implementation: "lib/market/security-master.ts", health: "UNKNOWN", healthReason: "Depends on sync", deterministic: true, requiresLLM: false, requiresMarketData: true, lastSuccessfulRun: null, lastFailure: null, metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 } },
    { capabilityId: "data.ingest", name: "Data Ingestion", domain: "data", description: "Ingest OHLCV data from providers", implementation: "lib/market/candle-store.ts", health: "UNKNOWN", healthReason: "Depends on provider config", deterministic: true, requiresLLM: false, requiresMarketData: true, lastSuccessfulRun: null, lastFailure: null, metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 } },
    { capabilityId: "data.quality", name: "Data Quality", domain: "data", description: "Data quality monitoring", implementation: "lib/dashboard/queries.ts", health: "READY", healthReason: "Query-based", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // Research
    { capabilityId: "research.instrument", name: "Instrument Research", domain: "research", description: "Research an NSE instrument with evidence and LLM", implementation: "lib/research/bridge.ts", health: "UNKNOWN", healthReason: "Requires LLM provider", deterministic: false, requiresLLM: true, requiresMarketData: true, lastSuccessfulRun: null, lastFailure: null, metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 } },
    { capabilityId: "research.verify-sources", name: "Source Verification", domain: "research", description: "Verify citation sources for research", implementation: "lib/research/bridge.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },
    { capabilityId: "hypothesis.generate", name: "Hypothesis Generation", domain: "research", description: "Generate falsifiable hypotheses", implementation: "lib/research/hypothesis-author.ts", health: "UNKNOWN", healthReason: "Requires LLM", deterministic: false, requiresLLM: true, requiresMarketData: false, lastSuccessfulRun: null, lastFailure: null, metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 } },

    // Strategy
    { capabilityId: "strategy.author", name: "Strategy Authoring", domain: "strategy", description: "Author deterministic Strategy DSL", implementation: "lib/strategy/dsl.ts", health: "READY", healthReason: "Built-in compiler", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },
    { capabilityId: "strategy.factory", name: "Strategy Factory", domain: "strategy", description: "Breed and screen strategy generations", implementation: "lib/factory/generation.ts", health: "UNKNOWN", healthReason: "Requires market data", deterministic: true, requiresLLM: false, requiresMarketData: true, lastSuccessfulRun: null, lastFailure: null, metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 } },
    { capabilityId: "strategy.gauntlet", name: "Validation Gauntlet", domain: "strategy", description: "Statistical validation gauntlet", implementation: "lib/strategy/gauntlet.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // Backtest
    { capabilityId: "backtest.run", name: "Backtest Engine", domain: "backtest", description: "Run backtest against canonical data", implementation: "lib/backtest/engine.ts", health: "READY", healthReason: "Built-in engine", deterministic: true, requiresLLM: false, requiresMarketData: true, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // Validation
    { capabilityId: "validation.gauntlet", name: "Selection Trial", domain: "validation", description: "Out-of-sample validation with holdout", implementation: "lib/strategy/gauntlet.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // Forward
    { capabilityId: "forward.enroll", name: "Forward Testing", domain: "forward", description: "Forward testing with shadow pass", implementation: "lib/forward/shadow.ts", health: "UNKNOWN", healthReason: "Requires activated challenger", deterministic: true, requiresLLM: false, requiresMarketData: true, lastSuccessfulRun: null, lastFailure: null, metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 } },

    // Paper
    { capabilityId: "paper.evaluate", name: "Paper Trading", domain: "paper", description: "Paper order lifecycle simulation", implementation: "lib/paper/service.ts", health: "READY", healthReason: "Built-in engine", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },
    { capabilityId: "paper.lifetime", name: "Paper Lifecycle", domain: "paper", description: "Full paper order lifecycle", implementation: "lib/paper/engine.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // Alpha
    { capabilityId: "alpha.health", name: "Alpha Health", domain: "alpha", description: "Alpha health monitoring", implementation: "lib/quant/alpha-health.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // Scanner
    { capabilityId: "scanner.run", name: "Market Scanner", domain: "scanner", description: "Signal scanner over universe", implementation: "lib/quantcore/signals.ts", health: "UNKNOWN", healthReason: "Requires quant core data", deterministic: true, requiresLLM: false, requiresMarketData: true, lastSuccessfulRun: null, lastFailure: null, metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 } },

    // Learning
    { capabilityId: "learning.cycle", name: "Learning Cycle", domain: "learning", description: "Autonomous learning cycle", implementation: "lib/learning/cycle.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },
    { capabilityId: "memory.observe", name: "Memory Observation", domain: "learning", description: "Observe and record memory", implementation: "lib/learning/introspection.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // Jobs
    { capabilityId: "jobs.queue", name: "Job Queue", domain: "jobs", description: "Research job queue with dependencies", implementation: "lib/research/queue.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },
    { capabilityId: "jobs.worker", name: "Job Worker", domain: "jobs", description: "Job execution worker", implementation: "lib/research/worker.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // Agents
    { capabilityId: "agents.gateway", name: "Agent Gateway", domain: "agents", description: "Multi-provider agent gateway", implementation: "lib/runtime/gateway.ts", health: "UNKNOWN", healthReason: "Depends on provider config", deterministic: false, requiresLLM: true, requiresMarketData: false, lastSuccessfulRun: null, lastFailure: null, metrics: { totalRuns: 0, successfulRuns: 0, failedRuns: 0 } },

    // Providers
    { capabilityId: "providers.manager", name: "Provider Manager", domain: "providers", description: "Multi-model provider management", implementation: "lib/runtime/providers.ts", health: "READY", healthReason: "Built-in registry", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // Repair
    { capabilityId: "repair.self", name: "Self Repair", domain: "repair", description: "Autonomous self-repair", implementation: "lib/learning/self-repair.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },

    // SRE
    { capabilityId: "sre.observability", name: "Observability", domain: "sre", description: "System observability and health", implementation: "lib/brain/event-bus.ts", health: "READY", healthReason: "Built-in", deterministic: true, requiresLLM: false, requiresMarketData: false, lastSuccessfulRun: now, lastFailure: null, metrics: { totalRuns: 1, successfulRuns: 1, failedRuns: 0 } },
  ];

  for (const cap of capabilities) {
    registerCapability(cap);
  }
}
