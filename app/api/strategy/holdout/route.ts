import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireMutationAccess } from "@/lib/security/request";
import { readJsonObject } from "@/lib/http/input";
import { createSeal, listSeals } from "@/lib/research-data/holdout-seal";
import { GATES } from "@/lib/strategy/gauntlet";

export const dynamic = "force-dynamic";

/** The sealed-holdout surface: list definitions + results; seal a new window. */
export async function GET() {
  const results = getDb()
    .select()
    .from(schema.holdoutResults)
    .orderBy(desc(schema.holdoutResults.evaluatedAt))
    .limit(20)
    .all()
    .map((row) => ({
      id: row.id,
      holdoutId: row.holdoutId,
      strategySpecId: row.strategySpecId,
      strategyFamilyId: row.strategyFamilyId,
      tradeCount: row.tradeCount,
      netProfitFactor: row.netProfitFactor,
      degradationRatio: row.degradationRatio,
      passed: row.passed === 1,
      reasonCodes: JSON.parse(row.reasonCodes) as string[],
      detail: row.detail,
      evaluatedAt: row.evaluatedAt,
    }));

  return NextResponse.json({ seals: listSeals(), results }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as { market?: unknown; resolution?: unknown; startTime?: unknown; endTime?: unknown };

  if (body.market !== "NSE" && body.market !== "US" && body.market !== "BSE") {
    return NextResponse.json({ error: "INVALID_MARKET", message: "market must be NSE, BSE or US." }, { status: 400 });
  }
  if (typeof body.resolution !== "string" || body.resolution.length === 0) {
    return NextResponse.json({ error: "INVALID_RESOLUTION", message: "resolution is required (e.g. D, 5m)." }, { status: 400 });
  }

  // The decision rule is PINNED HERE, from the same declared gates the gauntlet enforces — a
  // copy at seal time, so a later gate change never moves a sealed bar.
  const sealed = await createSeal({
    market: body.market,
    resolution: body.resolution,
    decisionRule: {
      minNetProfitFactor: GATES.minOutOfSampleProfitFactor,
      minTrades: GATES.minTradesForEvidence,
    },
    actor: "owner:api",
    startTime: typeof body.startTime === "number" ? body.startTime : undefined,
    endTime: typeof body.endTime === "number" ? body.endTime : undefined,
  });

  if (!sealed.ok) {
    const status = sealed.code === "ACTIVE_SEAL_EXISTS" ? 409 : sealed.code === "NO_STORED_DATA" ? 404 : 422;
    return NextResponse.json({ error: sealed.code, message: sealed.message }, { status });
  }
  return NextResponse.json({ seal: sealed.seal }, { status: 201 });
}
