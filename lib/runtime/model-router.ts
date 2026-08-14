import type { ProviderId } from "./providers";
import type { Capability } from "./routing";
import type { ModelCapabilities, ModelEntry } from "./model-catalog";

/**
 * ModelRouter (rung 4) — pick the best MODEL for a ROLE from whatever roster exists, LEARNING from
 * the run ledger rather than a hard-coded "if research → X".
 *
 * This sits ABOVE `route()` (capability → provider). `route()` enforces the honesty invariants
 * (arithmetic never reaches an LLM; a forecast never reaches a chatbot; fallback is never silent).
 * This layer answers a different question: given a role's requirements and the models actually
 * available, which one has EARNED the work — by verified-output rate, latency and cost?
 *
 * Deliberately ROSTER-AGNOSTIC. It takes a `ModelEntry[]` (the same catalog type the rest of the
 * runtime uses) and a stats source; it never names a vendor model. A one-model machine routes every
 * role to that model (honestly, "only available model"); a five-model machine differentiates. Wiring
 * the real detected roster is a separate step — the POLICY is what this module is.
 *
 * The doctrine it inherits: a refusal is explicit and carries the whole attempt trail. There is no
 * silent downgrade — if nothing meets the role's hard requirements, the router says so with reasons.
 */

/** Below this many observations a model's measured rate is not trusted; the neutral prior is used. */
export const MIN_SAMPLES_FOR_EMPIRICAL = 3;
/** The neutral prior for an unproven model — enough to be TRIED, never enough to beat a proven one. */
export const PRIOR_VERIFICATION_RATE = 0.5;

const LATENCY_PRIOR_MS: Record<ModelEntry["latencyClass"], number> = { FAST: 5_000, MEDIUM: 20_000, SLOW: 60_000 };
const COST_RANK: Record<ModelEntry["costClass"], number> = { SUBSCRIPTION: 0, LOCAL: 1, SERVICE: 2, API: 3 };

export interface ModelStat {
  /** Fraction of this model's runs (for the capability) that COMPLETED and were verified/uncontested. */
  verificationRate: number;
  medianLatencyMs: number;
  samples: number;
}

/** The learned signal, keyed by (model, capability). Computed from the AgentRun ledger. */
export interface EmpiricalModelStats {
  lookup(modelId: string, capability: Capability): ModelStat | null;
}

export interface RoleModelRequirement {
  role: string;
  /** Hard capability filter — a candidate must declare ALL of these (e.g. ["research"] or ["coding","toolUse"]). */
  needs: (keyof ModelCapabilities)[];
  /** Hard latency cap (measured latency when proven, else the class prior). Null = no cap. */
  maxLatencyMs?: number | null;
  /** Hard floor on the measured verification rate — applied ONLY once a model has enough samples,
   *  so an unproven model is never rejected for lacking history (it is judged by the prior instead). */
  minVerificationRate?: number | null;
  /** Scoring weights. Verification dominates by default: route by earned quality first. */
  weights?: { verification: number; cost: number; latency: number };
}

// Verification LEADS by default — the owner's primary directive is "route by verification rate".
// Cost and latency only break near-ties. A latency-sensitive role raises `latency` in its own weights.
const DEFAULT_WEIGHTS = { verification: 1.0, cost: 0.15, latency: 0.15 } as const;

export interface ModelScoreLine {
  modelId: string;
  providerId: ProviderId;
  score: number;
  verificationRate: number;
  latencyMs: number;
  source: "EMPIRICAL" | "PRIOR";
}

export type ModelRouteDecision =
  | {
      ok: true;
      role: string;
      providerId: ProviderId;
      modelId: string;
      score: number;
      /** EMPIRICAL when the winner had enough history to be judged on measured rate; PRIOR otherwise. */
      source: "EMPIRICAL" | "PRIOR";
      reason: string;
      /** Every eligible candidate, best score first — the observable "why this model". */
      trail: ModelScoreLine[];
    }
  | {
      ok: false;
      role: string;
      code: "NO_MODEL_AVAILABLE" | "NO_MODEL_MEETS_REQUIREMENTS";
      /** Every candidate and exactly why it could not serve — never a silent downgrade. */
      attempted: { modelId: string; reason: string }[];
      message: string;
    };

function declaresAll(model: ModelEntry, needs: (keyof ModelCapabilities)[]): boolean {
  return needs.every((cap) => model.capabilities[cap]);
}

/**
 * Route one role to a model. `capability` keys the learned stats (the ledger records runs per
 * capability); the role's requirements are the hard filters and the scoring weights.
 */
export function routeRoleModel(
  req: RoleModelRequirement,
  roster: readonly ModelEntry[],
  stats: EmpiricalModelStats,
  capability: Capability,
): ModelRouteDecision {
  const weights = req.weights ?? DEFAULT_WEIGHTS;
  const attempted: { modelId: string; reason: string }[] = [];

  interface Candidate {
    model: ModelEntry;
    verificationRate: number;
    latencyMs: number;
    costRank: number;
    source: "EMPIRICAL" | "PRIOR";
  }
  const survivors: Candidate[] = [];
  // Tracked structurally as we filter, so the refusal CODE is classified from a flag rather than by
  // re-parsing the human-readable reason strings (which a later wording edit could silently break).
  let sawCapableButCapped = false;

  for (const model of roster) {
    if (!model.available || model.health !== "READY") {
      attempted.push({ modelId: model.modelId, reason: `unavailable (${model.health})` });
      continue;
    }
    if (!declaresAll(model, req.needs)) {
      attempted.push({ modelId: model.modelId, reason: `does not declare ${req.needs.join("+")}` });
      continue;
    }
    const stat = stats.lookup(model.modelId, capability);
    const proven = stat !== null && stat.samples >= MIN_SAMPLES_FOR_EMPIRICAL;
    const verificationRate = proven ? stat!.verificationRate : PRIOR_VERIFICATION_RATE;
    const latencyMs = proven ? stat!.medianLatencyMs : LATENCY_PRIOR_MS[model.latencyClass];

    if (req.maxLatencyMs != null && latencyMs > req.maxLatencyMs) {
      attempted.push({ modelId: model.modelId, reason: `latency ${latencyMs}ms > cap ${req.maxLatencyMs}ms` });
      sawCapableButCapped = true; // capable, but the role's hard cap ruled it out
      continue;
    }
    // The verification floor bites only for PROVEN models — an unproven one is tried on its prior,
    // never rejected for having no track record (else no new model could ever earn history).
    if (req.minVerificationRate != null && proven && verificationRate < req.minVerificationRate) {
      attempted.push({ modelId: model.modelId, reason: `verified ${(verificationRate * 100).toFixed(0)}% < floor ${(req.minVerificationRate * 100).toFixed(0)}% (${stat!.samples} samples)` });
      sawCapableButCapped = true;
      continue;
    }

    survivors.push({ model, verificationRate, latencyMs, costRank: COST_RANK[model.costClass], source: proven ? "EMPIRICAL" : "PRIOR" });
  }

  if (survivors.length === 0) {
    // Distinguish "nothing could even try" from "candidates existed but failed the hard caps" — the
    // owner needs to fix the right thing (install a model vs. relax a latency/quality requirement).
    return {
      ok: false,
      role: req.role,
      code: sawCapableButCapped ? "NO_MODEL_MEETS_REQUIREMENTS" : "NO_MODEL_AVAILABLE",
      attempted,
      message: sawCapableButCapped
        ? `No model meets role ${req.role}'s requirements. The work is queued, not routed to an unfit model.`
        : `No available model declares ${req.needs.join("+")} for role ${req.role}.`,
    };
  }

  // Normalize cost and latency across the survivors so the weighted score is scale-free.
  const maxLatency = Math.max(...survivors.map((c) => c.latencyMs), 1);
  const score = (c: Candidate): number =>
    weights.verification * c.verificationRate - weights.cost * (c.costRank / 3) - weights.latency * (c.latencyMs / maxLatency);

  const ranked = [...survivors].sort((a, b) => {
    const byScore = score(b) - score(a);
    if (Math.abs(byScore) > 1e-9) return byScore;
    if (a.costRank !== b.costRank) return a.costRank - b.costRank; // cheaper wins ties
    return a.latencyMs - b.latencyMs; // then faster
  });

  const trail: ModelScoreLine[] = ranked.map((c) => ({
    modelId: c.model.modelId,
    providerId: c.model.providerId,
    score: Number(score(c).toFixed(4)),
    verificationRate: c.verificationRate,
    latencyMs: c.latencyMs,
    source: c.source,
  }));
  const winner = ranked[0];

  return {
    ok: true,
    role: req.role,
    providerId: winner.model.providerId,
    modelId: winner.model.modelId,
    score: Number(score(winner).toFixed(4)),
    source: winner.source,
    reason:
      winner.source === "EMPIRICAL"
        ? `${winner.model.modelId} earned it: ${(winner.verificationRate * 100).toFixed(0)}% verified over prior runs, ~${winner.latencyMs}ms.`
        : `${winner.model.modelId} chosen on priors (no proven history yet) among ${survivors.length} eligible model(s).`,
    trail,
  };
}
