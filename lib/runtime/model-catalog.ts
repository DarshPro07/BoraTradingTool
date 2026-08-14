import { getDb, schema } from "@/lib/db";
import type { ProviderId, CatalogModel } from "./providers";
import type { Capability } from "./routing";

/**
 * ModelCatalog — discovers and tracks models per provider.
 *
 * Each provider may expose many models. Each model records capabilities:
 * reasoning, coding, research, toolUse, structuredOutput, vision, etc.
 *
 * The CapabilityRouter uses this catalog to select the best model for each task.
 */

export interface ModelCapabilities {
  reasoning: boolean;
  coding: boolean;
  research: boolean;
  toolUse: boolean;
  structuredOutput: boolean;
  vision: boolean;
  longContext: boolean;
  financialTimeseries: boolean;
}

export interface ModelEntry {
  modelId: string;
  providerId: ProviderId;
  capabilities: ModelCapabilities;
  costClass: "SUBSCRIPTION" | "API" | "LOCAL" | "SERVICE";
  latencyClass: "FAST" | "MEDIUM" | "SLOW";
  contextWindow: number;
  available: boolean;
  health: "READY" | "DEGRADED" | "UNAVAILABLE";
}

export interface AIJob {
  id: string;
  requestedCapability: Capability;
  selectedProvider: ProviderId | null;
  selectedModel: string | null;
  selectionReason: string;
  fallbackChain: string[];
  actualProvider: ProviderId | null;
  actualModel: string | null;
  tokens: number | null;
  cost: number | null;
  durationMs: number;
  status: "COMPLETED" | "FAILED" | "REFUSED";
  createdAt: Date;
}

/**
 * Select the best model for a given capability.
 * Returns null if no suitable model is available.
 */
export function selectModelForCapability(
  capability: Capability,
  catalog: ModelEntry[],
): { model: ModelEntry; reason: string } | null {
  const capable = catalog.filter((m) => {
    if (!m.available || m.health !== "READY") return false;
    switch (capability) {
      case "RESEARCH":
      case "DEEP_REASONING":
        return m.capabilities.research || m.capabilities.reasoning;
      case "CODING":
        return m.capabilities.coding;
      case "CHEAP":
      case "FAST":
        return true; // Any model works; prefer fast/cheap
      case "INDEPENDENT_REVIEW":
        return m.capabilities.reasoning;
      default:
        return false;
    }
  });

  if (capable.length === 0) return null;

  // Sort by cost class (SUBSCRIPTION first), then latency.
  const rank = (m: ModelEntry) => {
    const costRank = m.costClass === "SUBSCRIPTION" ? 0 : m.costClass === "LOCAL" ? 1 : 2;
    const latencyRank = m.latencyClass === "FAST" ? 0 : m.latencyClass === "MEDIUM" ? 1 : 2;
    return costRank * 10 + latencyRank;
  };

  capable.sort((a, b) => rank(a) - rank(b));
  const selected = capable[0];

  return {
    model: selected,
    reason: `Selected ${selected.modelId} from ${selected.providerId} for ${capability}`,
  };
}

/**
 * Record an AIJob to the ledger.
 */
export function recordAIJob(job: AIJob): void {
  getDb()
    .insert(schema.agentRuns)
    .values({
      id: job.id,
      capability: job.requestedCapability,
      provider: job.actualProvider ?? job.selectedProvider ?? "none",
      model: job.actualModel ?? job.selectedModel ?? "none",
      status: job.status,
      trigger: "LEARNING",
      instrumentId: null,
      evidenceFingerprint: null,
      envelope: null,
      refusalCode: null,
      refusalMessage: null,
      tokens: job.tokens,
      cost: job.cost,
      costCurrency: null,
      fallbackReason: job.fallbackChain.join(" · ") || null,
      startedAt: job.createdAt,
      completedAt: new Date(),
    })
    .run();
}
