import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { getDb, schema } from "@/lib/db";
import { StrategyDslSchema } from "@/lib/strategy/dsl";
import { HoldoutBudgetExhausted, ResearchIdentityMissing, runGauntlet } from "@/lib/strategy/gauntlet";
import { freezeStanding } from "@/lib/strategy/research-freeze";
import { runPortfolioBacktest } from "@/lib/backtest/portfolio";
import { snapshotFromStore } from "@/lib/research-data/snapshot";

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

  // Checked before the confirmation flag, deliberately. Confirming an irreversible action the
  // system is not currently willing to perform would read as "you consented, so it happened" —
  // and the freeze exists precisely because the accounting behind that consent is wrong.
  const freeze = freezeStanding("gauntlet_trial");
  if (!freeze.allowed) {
    return NextResponse.json({ error: "RESEARCH_FROZEN", message: freeze.reason }, { status: 423 });
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

  // Evidence comes from a real replay over a RECORDED snapshot (13b) — not from anything the
  // caller supplies, and not from a provider window, which has no identity to pin a trial to.
  const snapshot = snapshotFromStore(parsed.data.universe.market, parsed.data.universe.resolution, "gauntlet");
  if (!snapshot.ok) {
    return NextResponse.json(
      {
        error: snapshot.code,
        message: `${snapshot.message} Neither a trial nor the holdout budget was touched.`,
      },
      { status: 503 },
    );
  }

  const backtest = runPortfolioBacktest(parsed.data, snapshot.dataset, {
    datasetFingerprint: snapshot.fingerprint,
    datasetSnapshotId: snapshot.snapshotId,
  });
  if (!backtest.ok) {
    return NextResponse.json({ error: backtest.code, message: backtest.message }, { status: 422 });
  }

  let report;
  try {
    report = runGauntlet(
      spec.id,
      parsed.data,
      { ...backtest.evidence, executionProfileId: backtest.execution?.profileId ?? null },
      "owner",
    );
  } catch (caught) {
    // Both refusals are the machinery working, and both must reach the caller as structured
    // answers rather than a bare 500 — a refusal that surfaces as a crash reads as a defect and
    // teaches people to retry it.
    if (caught instanceof ResearchIdentityMissing) {
      return NextResponse.json(
        {
          error: "RESEARCH_IDENTITY_MISSING",
          message: caught.message,
        },
        { status: 412 },
      );
    }
    if (caught instanceof HoldoutBudgetExhausted) {
      return NextResponse.json({ error: caught.code, message: caught.message }, { status: 409 });
    }
    throw caught;
  }

  return NextResponse.json({
    specId: spec.id,
    name: spec.name,
    passed: report.passed,
    trialsCounted: report.trialsCounted,
    // 13b provenance: the exact dataset the verdict was computed on.
    datasetSnapshotId: report.datasetSnapshotId,
    datasetFingerprint: snapshot.fingerprint,
    summary: report.summary,
    stages: report.stages,
    trades: backtest.trades.length,
    instrumentsEvaluated: backtest.instrumentsEvaluated,
    // The broker assumptions the replay was actually simulated under — profile id, deadline,
    // provenance. Null for daily runs. A validation number without its execution assumptions is
    // a result nobody can audit; the hardcoded 15:20 this system used to carry was invisible in
    // exactly this position.
    executionAssumptions: backtest.execution,
  });
}
