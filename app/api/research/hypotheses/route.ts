import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recordHypothesis } from "@/lib/knowledge/repository";
import { authorFromHypotheses } from "@/lib/research/hypothesis-author";
import { requireMutationAccess } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * The owner's door into the research chain.
 *
 * ## The gap this closes
 *
 * The golden journey documented it: `recordHypothesis` was reachable only over MCP, so the
 * autonomous loop could form hypotheses from papers while the *owner* — the one person with
 * standing to contribute an idea — had no surface at all. Their only alternative was hand-writing
 * DSL in the Studio, which creates an orphan spec no statistical budget may ever be spent on.
 *
 * ## What one POST does
 *
 * Records the hypothesis (idempotent — the id is a content hash of title:statement, so
 * re-submitting the same idea changes nothing), then runs the same authoring engine the learning
 * cycle uses: triage, and for an expressible idea, a family declared *from the hypothesis itself*
 * and a draft strategy placed in it.
 *
 * A refusal is returned as a **200 with a verdict**, not an error. "This is not a trading rule"
 * and "this needs data we do not hold" are successful triage outcomes — most real hypotheses earn
 * one of them, and an owner trained to read refusals as failures will stop writing hypotheses.
 */
export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;

  let body: { title?: unknown; statement?: unknown; rationale?: unknown; market?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Body is not valid JSON." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const statement = typeof body.statement === "string" ? body.statement.trim() : "";
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : undefined;
  const market = body.market === "US" ? "US" : "NSE";

  if (title.length < 8 || title.length > 160) {
    return NextResponse.json(
      { error: "TITLE_INVALID", message: "A title needs 8–160 characters — enough to name the idea, short enough to scan." },
      { status: 400 },
    );
  }
  if (statement.length < 30 || statement.length > 2_000) {
    return NextResponse.json(
      {
        error: "STATEMENT_INVALID",
        message:
          "A statement needs 30–2,000 characters. The triage reads thresholds from your own words " +
          "(e.g. \"gap >= 3%, relative volume >= 1\") — a one-liner gives it nothing to read.",
      },
      { status: 400 },
    );
  }

  const db = getDb();
  const before = new Set(db.select().from(schema.researchHypotheses).all().map((row) => row.id));

  const hypothesisId = recordHypothesis({ title, statement, rationale, market, createdBy: "owner:studio" });
  const alreadyExisted = before.has(hypothesisId);

  // The same engine the learning cycle runs — one triage implementation, nowhere to drift. It
  // sweeps every unauthored hypothesis (idempotent), and we report this one's outcome.
  const report = await authorFromHypotheses("owner:studio");
  const outcome = report.outcomes.find((entry) => entry.hypothesisId === hypothesisId);

  // Authored on an earlier pass: the outcome list skips it, so the spec is looked up directly.
  const existingSpec = db
    .select()
    .from(schema.strategySpecs)
    .where(eq(schema.strategySpecs.hypothesisId, hypothesisId))
    .get();

  return NextResponse.json(
    {
      hypothesisId,
      alreadyExisted,
      // Owner-review field names, alongside the originals: outcome/created/missingFeatures.
      outcome: outcome?.verdict ?? (existingSpec ? "EXPRESSIBLE" : "UNKNOWN"),
      created: outcome?.specId !== undefined,
      missingFeatures: outcome?.verdict === "NEEDS_FEATURE" ? outcome.reason : undefined,
      provenance: outcome?.provenance ?? null,
      verdict: outcome?.verdict ?? (existingSpec ? "EXPRESSIBLE" : "UNKNOWN"),
      reason:
        outcome?.reason ??
        (existingSpec
          ? `Already expressed as ${existingSpec.name} on an earlier pass. Nothing was re-authored — a re-submitted idea must not duplicate its strategy or inflate its family.`
          : "This hypothesis was recorded but produced no triage outcome this pass."),
      authored:
        outcome?.specId !== undefined
          ? { specId: outcome.specId, name: outcome.title, familyId: outcome.familyId ?? null }
          : existingSpec
            ? { specId: existingSpec.id, name: existingSpec.name, familyId: null }
            : null,
    },
    { status: alreadyExisted ? 200 : 201 },
  );
}

/** The hypotheses held, newest first, with the strategy each produced where one exists. */
export async function GET() {
  const db = getDb();
  const hypotheses = db
    .select()
    .from(schema.researchHypotheses)
    .orderBy(desc(schema.researchHypotheses.createdAt))
    .all();
  const specs = db.select().from(schema.strategySpecs).all();

  return NextResponse.json({
    hypotheses: hypotheses.map((row) => ({
      id: row.id,
      title: row.title,
      statement: row.statement,
      market: row.market,
      status: row.status,
      createdBy: row.createdBy,
      strategy: specs.find((spec) => spec.hypothesisId === row.id)?.name ?? null,
    })),
  });
}
