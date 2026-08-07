import { z } from "zod";

/**
 * Quant Core Contract v1 — see docs/CONTRACT_QUANTCORE_V1.md.
 * This file is FROZEN and shared with the Python quant core owned by another agent.
 * Additive changes only within v1.
 */
export const CONTRACT_VERSION = "v1" as const;

export const QUANT_RESOURCES = [
  "health",
  "board",
  "universe",
  "forwardOutcomes",
  "regime",
  "trials",
] as const;
export type QuantResource = (typeof QUANT_RESOURCES)[number];

export type QuantTransport = "http" | "filesystem";

export type QuantErrorCode =
  | "QUANT_CORE_UNAVAILABLE"
  | "RESOURCE_NOT_PROVIDED"
  | "RESOURCE_STALE"
  | "RESOURCE_MALFORMED"
  | "CONTRACT_VERSION_MISMATCH";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Beyond this age a resource is flagged stale. Data is still returned; the UI badges it. */
export const FRESHNESS_BUDGET_MS: Readonly<Record<QuantResource, number>> = Object.freeze({
  health: 5 * MINUTE,
  board: 36 * HOUR,
  universe: 7 * 24 * HOUR,
  forwardOutcomes: 36 * HOUR,
  regime: 24 * HOUR,
  trials: 24 * HOUR,
});

/**
 * Filesystem-derived health comes from the daily board packet, so it inherits the
 * board's budget rather than the 5-minute budget an HTTP heartbeat would have.
 */
export function freshnessBudget(resource: QuantResource, transport: QuantTransport): number {
  if (resource === "health" && transport === "filesystem") return FRESHNESS_BUDGET_MS.board;
  return FRESHNESS_BUDGET_MS[resource];
}

export const SafetySchema = z.object({
  liveExecution: z.boolean(),
  brokerEnabled: z.boolean(),
  modelGate: z.string(),
});

export const DataStatusSchema = z.object({
  daily: z.string().nullable(),
  dailyRange: z.string().nullable(),
  intraday15m: z.string().nullable(),
  dataConfidence: z.number().nullable(),
  primaryLimit: z.string().nullable(),
});

export const HealthSchema = z.object({
  mode: z.string(),
  safety: SafetySchema,
  dataStatus: DataStatusSchema,
  lastRunAt: z.string().nullable(),
});
export type QuantHealth = z.infer<typeof HealthSchema>;

export const CandidateSchema = z.object({
  symbol: z.string(),
  side: z.string(),
  setup: z.string().nullable(),
  score: z.number().nullable(),
  verdict: z.enum(["RESEARCH_ONLY", "PAPER_CANDIDATE", "BLOCKED"]),
  blockers: z.array(z.string()),
});
export type QuantCandidate = z.infer<typeof CandidateSchema>;

const CountSchema = z.number().int().nonnegative();

export const OutcomeAuditSchema = z.object({
  historicalWins: CountSchema,
  historicalLosses: CountSchema,
  historicalExpired: CountSchema,
  liveResolved: CountSchema,
  labelMappingOk: z.boolean(),
  mlGate: z.string(),
});

export const BoardSchema = z.object({
  candidates: z.array(CandidateSchema),
  gates: z.record(z.string(), z.string()),
  strategies: z.record(z.string(), z.string()),
  outcomeAudit: OutcomeAuditSchema,
  scenarios: z.object({ active: CountSchema, resolved: CountSchema, pending: CountSchema }),
});
export type QuantBoard = z.infer<typeof BoardSchema>;

export const UniverseSchema = z.object({
  market: z.string(),
  count: CountSchema,
  instruments: z.array(
    z.object({ symbol: z.string(), sector: z.string().nullable(), liquid: z.boolean() }),
  ),
});
export type QuantUniverse = z.infer<typeof UniverseSchema>;

export const ForwardOutcomesSchema = z.object({
  resolved: CountSchema,
  pending: CountSchema,
  observations: z.array(
    z.object({
      id: z.string(),
      symbol: z.string(),
      strategy: z.string().nullable(),
      openedAt: z.string(),
      resolvedAt: z.string().nullable(),
      outcome: z.enum(["open", "win", "loss", "expired"]),
      rMultiple: z.number().nullable(),
    }),
  ),
});
export type QuantForwardOutcomes = z.infer<typeof ForwardOutcomesSchema>;

export const RegimeSchema = z.object({
  state: z.string(),
  asOf: z.string(),
  confidence: z.number().nullable(),
  calibration: z.string().nullable(),
});
export type QuantRegime = z.infer<typeof RegimeSchema>;

export const TrialsSchema = z.object({
  total: CountSchema,
  trials: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      strategy: z.string(),
      verdict: z.string(),
      reason: z.string().nullable(),
      recordedAt: z.string(),
    }),
  ),
});
export type QuantTrials = z.infer<typeof TrialsSchema>;

export const RESOURCE_SCHEMAS = {
  health: HealthSchema,
  board: BoardSchema,
  universe: UniverseSchema,
  forwardOutcomes: ForwardOutcomesSchema,
  regime: RegimeSchema,
  trials: TrialsSchema,
} as const;

export interface QuantSuccess<T> {
  ok: true;
  resource: QuantResource;
  version: typeof CONTRACT_VERSION;
  transport: QuantTransport;
  generatedAt: string | null;
  retrievedAt: string;
  stale: boolean;
  ageMs: number | null;
  source: string;
  data: T;
}

export interface QuantFailure {
  ok: false;
  resource: QuantResource;
  code: QuantErrorCode;
  message: string;
  retrievedAt: string;
  source?: string;
}

export type QuantResult<T> = QuantSuccess<T> | QuantFailure;

export type ResourceData = {
  health: QuantHealth;
  board: QuantBoard;
  universe: QuantUniverse;
  forwardOutcomes: QuantForwardOutcomes;
  regime: QuantRegime;
  trials: QuantTrials;
};

export function failure(
  resource: QuantResource,
  code: QuantErrorCode,
  message: string,
  source?: string,
): QuantFailure {
  return { ok: false, resource, code, message, retrievedAt: new Date().toISOString(), source };
}

export function success<R extends QuantResource>(
  resource: R,
  transport: QuantTransport,
  source: string,
  generatedAt: string | null,
  data: ResourceData[R],
  now = Date.now(),
): QuantSuccess<ResourceData[R]> {
  const generatedMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const ageMs = Number.isNaN(generatedMs) ? null : Math.max(0, now - generatedMs);
  return {
    ok: true,
    resource,
    version: CONTRACT_VERSION,
    transport,
    generatedAt,
    retrievedAt: new Date(now).toISOString(),
    stale: ageMs !== null && ageMs > freshnessBudget(resource, transport),
    ageMs,
    source,
    data,
  };
}
