import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  evaluateAutonomousAction,
  type Actor,
  type GovernanceDecision,
  type LearningMode,
} from "./policy";

const VALID_MODES: readonly LearningMode[] = ["off", "observing", "learning", "evolving"];

export function getLearningMode(): LearningMode {
  const row = getDb().select().from(schema.learningState).where(eq(schema.learningState.id, 1)).get();
  const mode = row?.mode as LearningMode | undefined;
  return mode && VALID_MODES.includes(mode) ? mode : "off";
}

export function setLearningMode(mode: LearningMode, updatedBy: Actor): void {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Unknown learning mode "${mode}".`);
  }
  if (updatedBy !== "owner") {
    throw new GovernanceDenied("OWNER_REQUIRED", "Only the owner can change learning mode.");
  }
  const db = getDb();
  db.insert(schema.learningState)
    .values({ id: 1, mode, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.learningState.id,
      set: { mode, updatedBy, updatedAt: new Date() },
    })
    .run();

  db.insert(schema.auditEvents)
    .values({
      actor: updatedBy,
      action: "set_learning_mode",
      decision: "allowed",
      subject: mode,
      learningMode: mode,
      createdAt: new Date(),
    })
    .run();
}

/**
 * The single choke point for autonomous work. Every action an autonomous actor takes
 * passes through here, and every decision — allowed or denied — is written to the
 * append-only audit log before the action proceeds.
 */
export function authorize(actionId: string, actor: Actor, subject?: string): GovernanceDecision {
  const mode = getLearningMode();
  const decision = evaluateAutonomousAction(actionId, actor, mode);

  getDb()
    .insert(schema.auditEvents)
    .values({
      actor,
      action: actionId,
      decision: decision.allowed ? "allowed" : "denied",
      denialCode: decision.allowed ? null : decision.code,
      subject: subject ?? null,
      detail: decision.allowed ? decision.action.summary : decision.reason,
      learningMode: mode,
      createdAt: new Date(),
    })
    .run();

  return decision;
}

export class GovernanceDenied extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GovernanceDenied";
  }
}

/** Throwing variant for call sites that treat denial as exceptional. */
export function requireAuthorization(actionId: string, actor: Actor, subject?: string): void {
  const decision = authorize(actionId, actor, subject);
  if (!decision.allowed) {
    throw new GovernanceDenied(decision.code, decision.reason);
  }
}
