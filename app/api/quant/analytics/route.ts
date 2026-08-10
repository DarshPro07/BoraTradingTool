import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { analyzeReturns } from "@/lib/quant/analytics";
import { requireMutationAccess } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * Trade returns are annualized by TRADES per year, derived from the experiment's own time span —
 * never by bar frequency. 73 trade returns treated as 5-minute periodic returns once produced a
 * naive Sharpe of 1146; the number was arithmetic, the meaning was garbage.
 */
function tradesPerYearFrom(trades: { entryTime?: number; exitTime?: number }[]): number | undefined {
  const times = trades
    .flatMap((trade) => [trade.entryTime, trade.exitTime])
    .filter((value): value is number => typeof value === "number");
  if (times.length < 4) return undefined;
  const spanSeconds = Math.max(...times) - Math.min(...times);
  if (spanSeconds <= 0) return undefined;
  const spanYears = spanSeconds / (365.25 * 86_400);
  return Math.max(1, Math.round(trades.length / spanYears));
}

/**
 * Risk/performance analytics over a strategy's recorded inspection experiment — the ledger, not
 * a recomputation. The response carries dataset identity, the versioned risk policy, estimator
 * provenance and pinned assumption fingerprints, because a metric without them is an opinion.
 */
export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;

  let body: { specId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "INVALID_JSON", message: "Body is not valid JSON." }, { status: 400 });
  }
  const specId = typeof body.specId === "string" ? body.specId.trim() : "";
  if (!specId) return NextResponse.json({ error: "SPEC_REQUIRED", message: "specId is required." }, { status: 400 });

  const db = getDb();
  const spec = db.select().from(schema.strategySpecs).where(eq(schema.strategySpecs.id, specId)).get();
  if (!spec) return NextResponse.json({ error: "SPEC_NOT_FOUND", message: `No strategy ${specId}.` }, { status: 404 });

  const experiment = db
    .select()
    .from(schema.experiments)
    .where(and(eq(schema.experiments.strategySpecId, specId), eq(schema.experiments.kind, "inspection")))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!experiment) {
    return NextResponse.json(
      {
        error: "NO_EXPERIMENT",
        message:
          "No inspection experiment exists for this strategy. Analytics read recorded evidence — run " +
          "Inspect trades first; nothing is computed from a live window.",
      },
      { status: 412 },
    );
  }

  const trades = db
    .select()
    .from(schema.experimentTrades)
    .where(eq(schema.experimentTrades.experimentId, experiment.id))
    .all()
    .map((row) => JSON.parse(row.payload) as { netReturn?: number });
  const returns = trades.map((trade) => trade.netReturn).filter((value): value is number => typeof value === "number");

  const periodsPerYear = tradesPerYearFrom(trades as { entryTime?: number; exitTime?: number }[]);

  return NextResponse.json({
    specName: spec.name,
    experimentId: experiment.id,
    datasetSnapshotId: experiment.datasetSnapshotId,
    engineVersion: experiment.engineVersion,
    tradeCount: returns.length,
    periodsPerYear: periodsPerYear ?? null,
    analytics: analyzeReturns(returns, periodsPerYear),
  });
}
