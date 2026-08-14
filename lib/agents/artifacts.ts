import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * AgentArtifact — the structured, persisted output a team member produces.
 *
 * The owner's rule (Team OS): members exchange ARTIFACTS, not chat transcripts. The Synthesizer reads
 * them BY ID. Persisting them (rather than passing blobs between agents) is what makes a team run
 * reproducible, token-bounded, crash-recoverable, and inspectable — and lets dissent become knowledge.
 */

export type ArtifactKind = "RESEARCH" | "VERIFICATION" | "CRITIQUE" | "SYNTHESIS";

export interface AgentArtifact {
  id: string;
  teamRunId: string;
  jobId: number | null;
  role: string;
  kind: ArtifactKind;
  agentRunId: string | null;
  /** Structured content — a JSON object, never a chat transcript. */
  content: Record<string, unknown>;
  createdAt: Date;
}

export interface RecordArtifactInput {
  id: string;
  teamRunId: string;
  jobId: number | null;
  role: string;
  kind: ArtifactKind;
  agentRunId: string | null;
  content: Record<string, unknown>;
  createdAt?: Date;
}

/** Persist one member's structured output. Idempotent by id: a crash-retry with the same id replaces. */
export function recordArtifact(input: RecordArtifactInput): string {
  const createdAt = input.createdAt ?? new Date();
  getDb()
    .insert(schema.agentArtifacts)
    .values({
      id: input.id,
      teamRunId: input.teamRunId,
      jobId: input.jobId,
      role: input.role,
      kind: input.kind,
      agentRunId: input.agentRunId,
      content: JSON.stringify(input.content),
      createdAt,
    })
    .onConflictDoUpdate({
      target: schema.agentArtifacts.id,
      set: { content: JSON.stringify(input.content), agentRunId: input.agentRunId, createdAt },
    })
    .run();
  return input.id;
}

function hydrate(row: typeof schema.agentArtifacts.$inferSelect): AgentArtifact {
  return {
    id: row.id,
    teamRunId: row.teamRunId,
    jobId: row.jobId,
    role: row.role,
    kind: row.kind as ArtifactKind,
    agentRunId: row.agentRunId,
    content: JSON.parse(row.content) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

/** One artifact by id — how the Synthesizer consumes a member's output (by id, not by blob). */
export function getArtifact(id: string): AgentArtifact | null {
  const row = getDb().select().from(schema.agentArtifacts).where(eq(schema.agentArtifacts.id, id)).get();
  return row ? hydrate(row) : null;
}

/** Every artifact of a team run, oldest first. */
export function listArtifactsForTeamRun(teamRunId: string): AgentArtifact[] {
  return getDb()
    .select()
    .from(schema.agentArtifacts)
    .where(eq(schema.agentArtifacts.teamRunId, teamRunId))
    .orderBy(asc(schema.agentArtifacts.createdAt))
    .all()
    .map(hydrate);
}
