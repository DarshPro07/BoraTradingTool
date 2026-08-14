import type { CatalogModel, DetectedProvider } from "./providers";
import { descriptorFor, isUsable } from "./providers";
import type { ModelCapabilities, ModelEntry } from "./model-catalog";

/**
 * The REAL model roster (masterclass A6.1) — built from what `detectProviders()` actually found,
 * never from fixtures, and never from fabricated model names or benchmark values.
 *
 * Two truthful cases per READY provider:
 *   1. The probe ENUMERATED models (`DetectedProvider.models`) — each becomes a roster entry with
 *      the catalog's own relative quality/cost (discovered, not authored here).
 *   2. The provider is READY but does not enumerate (claude-code today: the CLI serves its
 *      configured model but `--version` lists nothing). The roster then carries ONE entry with the
 *      SENTINEL id `<provider>:default` — an explicit statement that "this provider will serve its
 *      own configured model; the concrete id is discovered per-run from execution telemetry", not a
 *      fabricated model name. The ModelRouter can route to it; the binding is recorded as
 *      PROVIDER_DEFAULT rather than pretending a specific model was requested (A6.2 truth rule).
 *
 * Capability flags derive from the provider DESCRIPTOR's declared support (tools/structured
 * output/kind), which is registry truth, not benchmark invention. Latency starts at the neutral
 * MEDIUM prior — the ModelRouter replaces priors with MEASURED stats once runs accumulate.
 */

/** The sentinel meaning "the provider's own configured model" — not a real, requestable model id. */
export function providerDefaultModelId(providerId: string): string {
  return `${providerId}:default`;
}

export function isProviderDefaultModel(modelId: string): boolean {
  return modelId.endsWith(":default");
}

function capabilitiesFor(provider: DetectedProvider): ModelCapabilities {
  const descriptor = descriptorFor(provider.id);
  const isLlm = descriptor.kind === "LLM";
  return {
    // An LLM can reason over and research supplied evidence; a financial model or service cannot be
    // offered as one (the routing layer already refuses to treat Kronos as a chatbot).
    reasoning: isLlm,
    research: isLlm,
    coding: isLlm,
    toolUse: descriptor.supportsTools,
    structuredOutput: descriptor.supportsStructuredOutput,
    vision: false, // not declared by the registry; never guessed
    longContext: false, // unreported — a prior of false refuses rather than flatters
    financialTimeseries: descriptor.kind === "FINANCIAL_MODEL",
  };
}

function entryFromCatalogModel(provider: DetectedProvider, model: CatalogModel): ModelEntry {
  const descriptor = descriptorFor(provider.id);
  return {
    modelId: model.modelId,
    providerId: provider.id,
    capabilities: capabilitiesFor(provider),
    costClass: descriptor.costClass,
    // Relative cost is the catalog's own discovered claim; latency stays a neutral prior until the
    // ledger MEASURES it (the ModelRouter prefers measured latency for proven models anyway).
    latencyClass: model.relativeCost === "LOW" ? "FAST" : model.relativeCost === "HIGH" ? "SLOW" : "MEDIUM",
    contextWindow: 0, // unreported by detection; 0 = unknown, never a guessed number
    available: true,
    health: "READY",
  };
}

function looksLikeCatalogModel(value: unknown): value is CatalogModel {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CatalogModel).modelId === "string" &&
    (value as CatalogModel).modelId.length > 0
  );
}

/**
 * Build the production roster from a detection pass. Roster-agnostic by construction: one READY
 * provider yields a one-entry roster (routed honestly as "only available"), five yield five.
 * Non-LLM providers are excluded — the semantic roles this roster serves require an LLM, and the
 * TIME_SERIES/DETERMINISTIC invariants are enforced below this layer by `route()` regardless.
 */
export function buildDetectedRoster(detected: readonly DetectedProvider[]): ModelEntry[] {
  const roster: ModelEntry[] = [];
  for (const provider of detected) {
    if (!isUsable(provider)) continue;
    if (descriptorFor(provider.id).kind !== "LLM") continue;

    const enumerated = (provider.models ?? []).filter(looksLikeCatalogModel);
    if (enumerated.length > 0) {
      for (const model of enumerated) roster.push(entryFromCatalogModel(provider, model));
      continue;
    }

    // READY but non-enumerating: one truthful sentinel entry (see module doc).
    const descriptor = descriptorFor(provider.id);
    roster.push({
      modelId: providerDefaultModelId(provider.id),
      providerId: provider.id,
      capabilities: capabilitiesFor(provider),
      costClass: descriptor.costClass,
      latencyClass: "MEDIUM",
      contextWindow: 0,
      available: true,
      health: "READY",
    });
  }
  return roster;
}
