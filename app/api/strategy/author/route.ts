import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { recordStrategySpec } from "@/lib/knowledge/repository";
import { StrategyDslSchema, compileStrategy } from "@/lib/strategy/dsl";
import { checkRediscovery } from "@/lib/strategy/graveyard";

export const dynamic = "force-dynamic";

/**
 * Author a strategy.
 *
 * The gap this closes: the system could neither create a strategy nor import one, so the
 * battery, the graveyard and the star map all had nothing to act on and every screen was
 * legitimately empty.
 *
 * Order matters and is deliberate:
 *
 *   1. Schema — is this even a strategy?
 *   2. Compile — does it reference the future, or a feature that does not exist?
 *   3. Graveyard — has this exact strategy already been tried and buried?
 *   4. Only then, store.
 *
 * A rediscovery is refused rather than stored, because storing it means the next rehearsal
 * spends work rediscovering what the ledger already records.
 */
export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Body is not valid JSON." }, { status: 400 });
  }

  const payload = body as { dsl?: unknown; createdBy?: unknown; hypothesisId?: unknown };

  const parsed = StrategyDslSchema.safeParse(payload.dsl);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "SCHEMA_INVALID",
        message: "The strategy does not match the DSL schema.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 400 },
    );
  }

  const compiled = compileStrategy(parsed.data);
  if (!compiled.ok) {
    // A lookahead feature is a refusal, not a warning: every result such a strategy produced
    // would be computed from information it could not have had.
    return NextResponse.json({ error: compiled.code, message: compiled.message }, { status: 400 });
  }

  const rediscovery = checkRediscovery(parsed.data);
  if (rediscovery.rediscovered) {
    return NextResponse.json(
      { error: "ALREADY_BURIED", message: rediscovery.message, entry: rediscovery.entry },
      { status: 409 },
    );
  }

  const createdBy = typeof payload.createdBy === "string" && payload.createdBy.trim() ? payload.createdBy.trim() : "owner";
  const hypothesisId = typeof payload.hypothesisId === "string" && payload.hypothesisId.trim() ? payload.hypothesisId.trim() : undefined;

  const id = recordStrategySpec({ name: parsed.data.name, dsl: parsed.data, createdBy, hypothesisId });

  return NextResponse.json(
    {
      id,
      name: parsed.data.name,
      hash: compiled.hash,
      features: compiled.features,
      // Surfaced, not swallowed. An unsupported feature means this compiles and can never be
      // backtested here, and the author should know that now rather than at replay time.
      warnings: compiled.warnings,
      status: "draft",
    },
    { status: 201 },
  );
}
