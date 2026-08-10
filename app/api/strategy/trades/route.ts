import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { inspectTrades } from "@/lib/backtest/inspect";
import { latestExperiment, recordExperiment, snapshotFromStore } from "@/lib/research-data/snapshot";
import { requireMutationAccess } from "@/lib/security/request";
import { COMPILER_VERSION, StrategyDslSchema } from "@/lib/strategy/dsl";

export const dynamic = "force-dynamic";

/**
 * Per-trade inspection, under the historical-research data contract.
 *
 * A completed experiment is EVIDENCE: reopening it serves its stored trade ledger, byte for byte,
 * whatever the provider or the store have done since. A first run builds a dataset snapshot from
 * the canonical store — never the live provider window, which is how this route once answered
 * "0 trades" while the store's 30,832 bars said 73 — runs the replay, and persists both the
 * experiment and every trade.
 *
 * Missing stored data refuses with the remedy named (ingestion). It does not fetch: an experiment
 * whose bars quietly came from "whatever the provider had today" is not reproducible, and an
 * unreproducible result is not evidence.
 */
export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;

  let body: { specId?: unknown; rerun?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Body is not valid JSON." }, { status: 400 });
  }

  const specId = typeof body.specId === "string" ? body.specId.trim() : "";
  if (!specId) {
    return NextResponse.json({ error: "SPEC_REQUIRED", message: "specId is required." }, { status: 400 });
  }

  const spec = getDb().select().from(schema.strategySpecs).all().find((row) => row.id === specId);
  if (!spec) {
    return NextResponse.json({ error: "SPEC_NOT_FOUND", message: `No strategy ${specId}.` }, { status: 404 });
  }

  // Evidence first: a completed experiment reopens from its ledger. `rerun: true` runs a NEW
  // experiment against the store's current snapshot — deliberately explicit, never implicit.
  // The chart draws trades against store bars at the spec's own resolution; parse failure just
  // means no chart, never a blocked report.
  let chartResolution: string | null = null;
  try {
    const universe = (JSON.parse(spec.dsl) as { universe?: { resolution?: string } }).universe;
    chartResolution = universe?.resolution ?? null;
  } catch {
    chartResolution = null;
  }

  if (body.rerun !== true) {
    const held = latestExperiment(specId);
    if (held) {
      return NextResponse.json({
        specName: spec.name,
        servedFrom: "ledger",
        resolution: chartResolution,
        experimentId: held.experiment.id,
        trades: held.trades,
        summary: held.experiment.summary,
        execution: null,
        provenance: {
          datasetSnapshotId: held.experiment.datasetSnapshotId,
          fingerprint: held.snapshot?.fingerprint ?? null,
          barCount: held.snapshot?.barCount ?? null,
          instruments: held.snapshot ? (JSON.parse(held.snapshot.instruments) as string[]).length : null,
          engineVersion: held.experiment.engineVersion,
          recordedAt: held.experiment.createdAt,
          note: "Served from the experiment's stored trade ledger. No provider or store read occurred; this evidence cannot drift.",
        },
      });
    }
  }

  const parsed = StrategyDslSchema.safeParse(JSON.parse(spec.dsl));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "DSL_INVALID", message: "The stored specification no longer parses against the current compiler." },
      { status: 409 },
    );
  }

  const snapshot = snapshotFromStore(parsed.data.universe.market, parsed.data.universe.resolution, "inspection");
  if (!snapshot.ok) {
    // Missing canonical history is a deterministic evidence refusal, not a broken server. A 5xx
    // makes Chromium and monitoring report an application failure even though the UI can state the
    // exact ingestion remedy. Keep real infrastructure failures in the 5xx class.
    return NextResponse.json({ error: snapshot.code, message: snapshot.message }, { status: 422 });
  }

  const report = inspectTrades(spec.name, parsed.data, snapshot.dataset);
  if (!report.ok) {
    return NextResponse.json({ error: report.code, message: report.message }, { status: 422 });
  }

  const experimentId = recordExperiment({
    specId,
    snapshotId: snapshot.snapshotId,
    kind: "inspection",
    engineVersion: COMPILER_VERSION,
    executionProfileId: report.execution?.profileId ?? null,
    summary: report.summary,
    trades: report.trades,
    actor: "inspection-route",
  });

  return NextResponse.json({
    specName: spec.name,
    servedFrom: "fresh",
    resolution: parsed.data.universe.resolution,
    experimentId,
    trades: report.trades,
    summary: report.summary,
    execution: report.execution,
    provenance: {
      datasetSnapshotId: snapshot.snapshotId,
      fingerprint: snapshot.fingerprint,
      barCount: snapshot.barCount,
      instruments: snapshot.instruments.length,
      engineVersion: COMPILER_VERSION,
      recordedAt: new Date().toISOString(),
      note: "Built from the canonical store only. The live provider was not consulted and cannot alter this experiment later.",
    },
  });
}
