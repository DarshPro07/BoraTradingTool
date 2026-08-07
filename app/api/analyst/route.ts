import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { readJsonObject } from "@/lib/http/input";
import { AnalystError, listAnalyses, listAnalysesForInstrument, recordAnalysis } from "@/lib/analyst/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const instrumentId = url.searchParams.get("instrumentId")?.trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? "25");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 25;

  const analyses = instrumentId ? listAnalysesForInstrument(instrumentId, limit) : listAnalyses(limit);
  return NextResponse.json(
    { analyses, count: analyses.length, advisoryOnly: true },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;

  try {
    const stored = recordAnalysis(parsed.value);
    return NextResponse.json({ recorded: true, analysis: stored }, { status: 201 });
  } catch (error) {
    if (error instanceof AnalystError) {
      return NextResponse.json({ recorded: false, error: error.code, message: error.message }, { status: 422 });
    }
    throw error;
  }
}
