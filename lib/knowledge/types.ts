export const SOURCE_KINDS = ["paper", "video", "repository", "report", "documentation", "web"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_STATUSES = ["discovered", "archived", "extracted", "verified", "rejected"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/**
 * The analyst must always distinguish what is known from what is merely inferred.
 * Every claim carries one of these and the UI renders them differently.
 */
export const EPISTEMIC_STATUSES = [
  "known",
  "inferred",
  "unknown",
  "conflicting",
  "historically_observed",
  "not_forward_validated",
] as const;
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

export const PLANES = [
  "computational_finance",
  "quantum_physics",
  "market_microstructure",
  "system",
] as const;
export type Plane = (typeof PLANES)[number];

export const LESSON_LEVELS = ["beginner", "quant", "code"] as const;
export type LessonLevel = (typeof LESSON_LEVELS)[number];

export const CONCEPT_RELATIONS = ["prerequisite_of", "specialises", "contradicts", "related_to"] as const;
export type ConceptRelation = (typeof CONCEPT_RELATIONS)[number];

export const HYPOTHESIS_STATUSES = ["proposed", "duplicate", "accepted", "rejected", "tested"] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export const SPEC_STATUSES = [
  "draft",
  "compiled",
  "validating",
  "paper_challenger",
  "retired",
  "rejected",
] as const;
export type SpecStatus = (typeof SPEC_STATUSES)[number];

export const TRIAL_KINDS = [
  "replay",
  "walk_forward",
  "monte_carlo",
  "cost_stress",
  "no_trade_comparison",
  "causality",
  "parameter_stability",
  /**
   * The sealed-holdout query, recorded as a trial so its *verdict* has somewhere to live.
   *
   * `holdout_ledger` records that a holdout was queried — the budget accounting — but carries no
   * pass/fail. Without this kind there was no source anywhere in the schema for
   * `StageEvidence.holdoutCleared`, so `advanceStrategy` could never leave `validated` and no
   * strategy could reach `owner_review`. The ladder had a rung with nothing under it.
   *
   * Distinct from the seven gauntlet stages on purpose: those are run repeatedly during
   * validation, this one may happen once, ever.
   */
  "sealed_holdout",
] as const;
export type TrialKind = (typeof TRIAL_KINDS)[number];

export const TRIAL_VERDICTS = ["pass", "fail", "inconclusive"] as const;
export type TrialVerdict = (typeof TRIAL_VERDICTS)[number];

export const REPRODUCTION_STATUSES = ["pending", "match", "mismatch", "error"] as const;
export type ReproductionStatus = (typeof REPRODUCTION_STATUSES)[number];

export const FORWARD_OUTCOMES = ["open", "win", "loss", "expired"] as const;
export type ForwardOutcomeKind = (typeof FORWARD_OUTCOMES)[number];

export const PROPOSAL_STATUSES = [
  "draft",
  "tests_pending",
  "tests_passed",
  "reviewed",
  "approved",
  "merged",
  "rejected",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface SourceInput {
  kind: SourceKind;
  title: string;
  url?: string;
  locator?: string;
  content: string;
  license?: string;
  authors?: string[];
  publishedAt?: Date;
  archivedPath?: string;
}

export interface ClaimInput {
  sourceId: string;
  statement: string;
  locator?: string;
  epistemicStatus?: EpistemicStatus;
  confidence?: number;
  indiaRelevant?: boolean;
}

export interface HypothesisInput {
  claimId?: string;
  title: string;
  statement: string;
  rationale?: string;
  market?: string;
  createdBy: string;
}

export interface StrategySpecInput {
  hypothesisId?: string;
  parentId?: string;
  name: string;
  version?: number;
  dsl: unknown;
  createdBy: string;
}

export interface TrialInput {
  strategySpecId: string;
  kind: TrialKind;
  verdict: TrialVerdict;
  reason?: string;
  metrics?: Record<string, unknown>;
  datasetFingerprint?: string;
  actor: string;
  startedAt?: Date;
}

export interface LessonInput {
  conceptId?: string;
  plane: Plane;
  level: LessonLevel;
  title: string;
  body: string;
  citations: string[];
}

/** A node in the memory graph, normalised across every table. */
export interface GraphNode {
  id: string;
  type:
    | "source"
    | "claim"
    | "concept"
    | "equation"
    | "reproduction"
    | "hypothesis"
    | "strategy"
    | "trial"
    | "validation"
    | "forward_outcome"
    | "lesson";
  label: string;
  detail?: string;
  status?: string;
  createdAt: Date | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
}

export interface GraphTrace {
  root: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class KnowledgeError extends Error {
  constructor(
    readonly code:
      | "SOURCE_NOT_FOUND"
      | "CLAIM_NOT_FOUND"
      | "SPEC_NOT_FOUND"
      | "NODE_NOT_FOUND"
      | "DUPLICATE_SOURCE"
      | "INVALID_CITATION"
      | "INVALID_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeError";
  }
}
