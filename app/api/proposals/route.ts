import { NextResponse } from "next/server";
import { authenticateGovernedActor } from "@/lib/security/request";
import { readJsonObject } from "@/lib/http/input";
import {
  ProposalError,
  EvidenceSchema,
  advanceProposal,
  attachEvidence,
  createProposal,
  listProposals,
  proposalStats,
} from "@/lib/learning/evolution";
import type { ProposalStatus } from "@/lib/knowledge/types";

export const dynamic = "force-dynamic";

const STATUSES = ["draft", "tests_pending", "tests_passed", "reviewed", "approved", "merged", "rejected"] as const;

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  const filter = status && (STATUSES as readonly string[]).includes(status) ? (status as ProposalStatus) : undefined;
  return NextResponse.json(
    { proposals: listProposals(filter), stats: proposalStats() },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const access = authenticateGovernedActor(req);
  if (!access.ok) return access.response;

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as Record<string, unknown>;

  try {
    if (typeof body.id === "string" && typeof body.status === "string") {
      if (!(STATUSES as readonly string[]).includes(body.status)) {
        return NextResponse.json({ error: "INVALID_STATUS" }, { status: 400 });
      }
      advanceProposal(body.id, body.status as ProposalStatus, access.actor, {
        reviewer: typeof body.reviewer === "string" ? body.reviewer : undefined,
        reviewNotes: typeof body.reviewNotes === "string" ? body.reviewNotes : undefined,
      });
      return NextResponse.json({ id: body.id, status: body.status });
    }

    if (typeof body.id === "string" && body.evidence && typeof body.evidence === "object") {
      const evidence = EvidenceSchema.safeParse(body.evidence);
      if (!evidence.success) {
        return NextResponse.json(
          { error: "INVALID_EVIDENCE", message: evidence.error.issues.map((issue) => issue.message).join("; ") },
          { status: 400 },
        );
      }
      attachEvidence(body.id, evidence.data, access.actor);
      return NextResponse.json({ id: body.id, attached: true });
    }

    const id = createProposal(
      {
        origin: (body.origin as never) ?? "research",
        actionId: String(body.actionId ?? ""),
        title: String(body.title ?? ""),
        rationale: String(body.rationale ?? ""),
        touchedPaths: Array.isArray(body.touchedPaths) ? (body.touchedPaths as string[]) : undefined,
        branch: typeof body.branch === "string" ? body.branch : undefined,
      },
      access.actor,
    );
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof ProposalError) {
      const status = error.code === "REVIEWER_NOT_HUMAN" ? 403 : 422;
      return NextResponse.json({ error: error.code, message: error.message }, { status });
    }
    throw error;
  }
}
