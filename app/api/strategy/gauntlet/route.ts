import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { getDb, schema } from "@/lib/db";
import { StrategyDslSchema } from "@/lib/strategy/dsl";
import { runGauntlet } from "@/lib/strategy/gauntlet";
import { runPortfolioBacktest } from "@/lib/backtest/portfolio";
import { marketCandleLoader } from "@/lib/learning/dataset";

export const dynamic = "force-dynamic";

/**
 * Run the validation gauntlet on one strategy.
 *
 * This route did not exist. `runGauntlet` was fully implemented, thoroughly tested, and callable
 * only from the test suite — so the most consequential action in the system had no path from the
 * application to it, and the validation funnel could never show anything but zero.
 *
 * **This spends a trial.** The evaluation is counted against the strategy's family, so it
 * permanently raises the statistical bar every future candidate in that family must clear. That
 * is why it is a deliberate POST behind an explicit confirmation flag rather than something the
 * autonomous cycle may do on a timer.
 *
 * It does **not** consume the sealed holdout budget: `runGauntlet` only draws on that when the
 * evidence carries a `holdoutId`, and a portfolio replay produces an in-sample/out-of-sample
 * split with no holdout claim. Saying otherwise would overstate the cost — which is its own kind
 * of dishonesty, because a warning nobody believes is a warning nobody reads.
 */
export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;

  let body: { specId?: unknown; confirm?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Body is not valid JSON." }, { status: 400 });
  }

  const specId = typeof body.specId === "string" ? body.specId.trim() : "";
  if (!specId) {
    return NextResponse.json({ error: "SPEC_REQUIRED", message: "specId is required." }, { status: 400 });
  }

  // An irreversible action requires an explicit acknowledgement. A caller that has not said it
  // understands the cost has almost certainly not intended to pay it.
  if (body.confirm !== true) {
    return NextResponse.json(
      {
        error: "CONFIRMATION_REQUIRED",
        message:
          "Running the gauntlet counts a trial against this strategy's family and permanently raises the bar every future candidate in it must clear. It does not touch the sealed holdout, which is only drawn on when holdout evidence is supplied. Send confirm: true to proceed.",
      },
      { status: 428 },
    );
  }

  const spec = getDb().select().from(schema.strategySpecs).all().find((row) => row.id === specId);
  if (!spec) {
    return NextResponse.json({ error: "SPEC_NOT_FOUND", message: `No strategy ${specId}.` }, { status: 404 });
  }

  const parsed = StrategyDslSchema.safeParse(JSON.parse(spec.dsl));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "DSL_INVALID", message: "The stored specification no longer parses against the current compiler." },
      { status: 409 },
    );
  }

  // Evidence comes from a real replay, not from anything supplied by the caller. A gauntlet fed
  // caller-supplied returns would grade whatever the caller wanted it to grade.
  const dataset = await marketCandleLoader()(spec.id, parsed.data);
  if (Object.keys(dataset).length === 0) {
    return NextResponse.json(
      {
        error: "NO_DATA",
        message:
          "No candles are available for this strategy's universe, so there is nothing to validate. The holdout budget was not touched.",
      },
      { status: 503 },
    );
  }

  const backtest = runPortfolioBacktest(parsed.data, dataset);
  if (!backtest.ok) {
    return NextResponse.json({ error: backtest.code, message: backtest.message }, { status: 422 });
  }

  const report = runGauntlet(spec.id, parsed.data, backtest.evidence, "owner");

  return NextResponse.json({
    specId: spec.id,
    name: spec.name,
    passed: report.passed,
    trialsCounted: report.trialsCounted,
    summary: report.summary,
    stages: report.stages,
    trades: backtest.trades.length,
    instrumentsEvaluated: backtest.instrumentsEvaluated,
  });
}
