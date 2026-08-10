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

  let id: string;
  try {
    id = recordStrategySpec({ name: parsed.data.name, dsl: parsed.data, createdBy, hypothesisId });
  } catch (caught) {
    // `strategy_specs` is unique on (name, version) and `recordStrategySpec` derives its id from
    // exactly those, so re-authoring an existing name threw straight through this handler and
    // reached the browser as a bare 500. Compiling a template twice — or double-clicking COMPILE
    // AND SAVE — is enough to hit it, and an opaque server error gives the author nothing to act
    // on when the real answer is "that name is taken".
    //
    // Answered as 409, not absorbed by auto-incrementing the version: a new version of a strategy
    // is a deliberate act with real consequences for the trial ledger, and quietly minting one on
    // a stray second click would fill the registry with versions nobody chose to create.
    const message = caught instanceof Error ? caught.message : String(caught);
    if (/UNIQUE constraint failed: strategy_specs/i.test(message)) {
      return NextResponse.json(
        {
          error: "NAME_ALREADY_EXISTS",
          message:
            `A strategy called "${parsed.data.name}" already exists at this version. ` +
            "Rename it, or set an explicit version to author a new revision — versions are not " +
            "created automatically, because each one carries its own trial history.",
        },
        { status: 409 },
      );
    }
    throw caught;
  }

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
