import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { authorize } from "@/lib/governance/runtime";
import { checkProtectedPath } from "@/lib/governance/paths";
import { classifyAction, type Actor } from "@/lib/governance/policy";
import type { ProposalStatus } from "@/lib/knowledge/types";

/** Exported for testing. Owner-token configuration no longer changes proposal authority. */
export function isSystemAutonomous(): boolean {
  return true;
}

/** Independent authority check; an autonomous worker cannot approve its own work. */
function requireIndependentAuthority(actor: Actor, message: string): void {
  if (actor === "owner" || actor === "claude_interactive") return;
  throw new ProposalError("REVIEWER_NOT_HUMAN", message);
}

export interface ProposalInput {
  origin: "incident" | "research" | "failure" | "schedule";
  actionId: string;
  title: string;
  rationale: string;
  /** Files the change would touch. Any protected path rejects the proposal outright. */
  touchedPaths?: string[];
  branch?: string;
  worktree?: string;
  diffPath?: string;
}

export const EvidenceSchema = z.object({
  kind: z.enum(["test", "replay", "monte_carlo", "review", "benchmark"]),
  detail: z.string().trim().min(1).max(2_000),
  passed: z.boolean(),
  reference: z.string().trim().min(1).max(500).optional(),
}).strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export type ProposalErrorCode =
  | "ACTION_NOT_PERMITTED"
  | "PROTECTED_PATH"
  | "INVALID_TRANSITION"
  | "EVIDENCE_REQUIRED"
  | "SELF_REVIEW"
  | "REVIEWER_NOT_HUMAN"
  | "INVALID_EVIDENCE"
  | "PROPOSAL_NOT_FOUND";

export class ProposalError extends Error {
  constructor(
    readonly code: ProposalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProposalError";
  }
}

/**
 * Legal transitions. A proposal cannot jump straight to approved, and merged is only
 * reachable through a human approval.
 */
const TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = Object.freeze({
  draft: ["tests_pending", "rejected"],
  tests_pending: ["tests_passed", "rejected"],
  tests_passed: ["reviewed", "rejected"],
  reviewed: ["approved", "rejected"],
  approved: ["merged", "rejected"],
  merged: [],
  rejected: [],
});

function readEvidence(row: typeof schema.evolutionProposals.$inferSelect): Evidence[] {
  if (!row.evidence) return [];
  try {
    const parsed = z.array(EvidenceSchema).safeParse(JSON.parse(row.evidence));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/**
 * Creates a proposal. The action must be on the permitted list and the change must not
 * touch a protected path — the risk kernel, the governance policy, hooks, or credentials.
 */
export function createProposal(input: ProposalInput, actor: Actor = "autonomous_worker"): string {
  if (classifyAction(input.actionId) !== "permitted") {
    throw new ProposalError(
      "ACTION_NOT_PERMITTED",
      `Action "${input.actionId}" is not permitted for autonomous work, so no proposal can be raised for it.`,
    );
  }

  const decision = authorize(input.actionId, actor, input.title);
  if (!decision.allowed) {
    throw new ProposalError("ACTION_NOT_PERMITTED", decision.reason);
  }

  for (const touched of input.touchedPaths ?? []) {
    const protection = checkProtectedPath(touched);
    if (protection.protected) {
      throw new ProposalError(
        "PROTECTED_PATH",
        `"${touched}" is protected: ${protection.reason} A proposal cannot modify it.`,
      );
    }
  }

  const id = `evo_${createHash("sha256").update(`${input.title}:${Date.now()}`).digest("hex").slice(0, 16)}`;
  const now = new Date();

  getDb()
    .insert(schema.evolutionProposals)
    .values({
      id,
      origin: input.origin,
      actionId: input.actionId,
      title: input.title,
      rationale: input.rationale,
      diffPath: input.diffPath ?? null,
      branch: input.branch ?? null,
      worktree: input.worktree ?? null,
      evidence: JSON.stringify([]),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return id;
}

export function getProposal(id: string) {
  return getDb().select().from(schema.evolutionProposals).where(eq(schema.evolutionProposals.id, id)).get() ?? null;
}

export function attachEvidence(id: string, evidence: unknown, actor: Actor): void {
  const row = getProposal(id);
  if (!row) throw new ProposalError("PROPOSAL_NOT_FOUND", `Unknown proposal "${id}".`);
  requireIndependentAuthority(actor, "Only an independent operator can attest proposal evidence.");
  if (["approved", "merged", "rejected"].includes(row.status)) {
    throw new ProposalError("INVALID_TRANSITION", `Evidence is frozen once a proposal is ${row.status}.`);
  }
  const parsed = EvidenceSchema.safeParse(evidence);
  if (!parsed.success) {
    throw new ProposalError("INVALID_EVIDENCE", `Invalid proposal evidence: ${parsed.error.message}`);
  }

  const existing = readEvidence(row);
  existing.push(parsed.data);
  getDb()
    .update(schema.evolutionProposals)
    .set({ evidence: JSON.stringify(existing), updatedAt: new Date() })
    .where(eq(schema.evolutionProposals.id, id))
    .run();
}

export interface AdvanceOptions {
  reviewer?: string;
  reviewNotes?: string;
}

/**
 * Advances a proposal through its lifecycle, enforcing that each gate has been met.
 * The two gates that matter: tests must actually pass, and the reviewer must be someone
 * other than the author — a system that approves its own work is not reviewed.
 */
export function advanceProposal(
  id: string,
  target: ProposalStatus,
  actor: Actor,
  options: AdvanceOptions = {},
): void {
  const row = getProposal(id);
  if (!row) throw new ProposalError("PROPOSAL_NOT_FOUND", `Unknown proposal "${id}".`);

  const current = row.status as ProposalStatus;
  if (!TRANSITIONS[current].includes(target)) {
    throw new ProposalError(
      "INVALID_TRANSITION",
      `Cannot move a proposal from "${current}" to "${target}". Allowed: ${TRANSITIONS[current].join(", ") || "none"}.`,
    );
  }

  const evidence = readEvidence(row);

  if (target === "tests_passed") {
    const tests = evidence.filter((item) => item.kind === "test");
    if (tests.length === 0) {
      throw new ProposalError("EVIDENCE_REQUIRED", "Attach test evidence before claiming tests passed.");
    }
    // The most recent run decides the gate. Earlier failures stay in the record — they are
    // the proposal's history — but fixing the code and re-running must be able to open it,
    // otherwise every failed iteration would require abandoning the proposal.
    const latest = tests[tests.length - 1];
    if (latest.passed !== true) {
      throw new ProposalError(
        "EVIDENCE_REQUIRED",
        `The most recent test evidence failed: ${latest.detail}. Fix it and attach a passing run.`,
      );
    }
  }

  if (target === "reviewed") {
    requireIndependentAuthority(actor, "Only an independent operator can attest an independent review.");
    const reviewer = options.reviewer?.trim();
    if (!reviewer) {
      throw new ProposalError("EVIDENCE_REQUIRED", "A reviewer must be named.");
    }
    if (reviewer === actor) {
      throw new ProposalError("SELF_REVIEW", "A proposal cannot be reviewed by the actor advancing it.");
    }
  }

  if (target === "approved") {
    requireIndependentAuthority(actor, "Only an independent operator can approve a proposal.");
  }

  if (target === "merged") {
    requireIndependentAuthority(actor, "Only an independent operator can merge an approved proposal.");
  }

  getDb()
    .update(schema.evolutionProposals)
    .set({
      status: target,
      reviewer: options.reviewer ?? row.reviewer,
      reviewNotes: options.reviewNotes ?? row.reviewNotes,
      updatedAt: new Date(),
    })
    .where(eq(schema.evolutionProposals.id, id))
    .run();

  getDb()
    .insert(schema.auditEvents)
    .values({
      actor,
      action: `proposal_${target}`,
      decision: "allowed",
      subject: id,
      detail: options.reviewNotes ?? null,
      createdAt: new Date(),
    })
    .run();
}

export function listProposals(status?: ProposalStatus, limit = 50) {
  const db = getDb();
  const query = db.select().from(schema.evolutionProposals);
  const rows = status
    ? query.where(eq(schema.evolutionProposals.status, status)).all()
    : query.orderBy(desc(schema.evolutionProposals.updatedAt)).all();
  return rows.slice(0, limit).map((row) => ({ ...row, evidenceItems: readEvidence(row) }));
}

export function proposalStats(): Record<string, number> {
  const stats: Record<string, number> = {
    draft: 0,
    tests_pending: 0,
    tests_passed: 0,
    reviewed: 0,
    approved: 0,
    merged: 0,
    rejected: 0,
  };
  for (const row of getDb().select().from(schema.evolutionProposals).all()) {
    if (row.status in stats) stats[row.status] += 1;
  }
  return stats;
}
