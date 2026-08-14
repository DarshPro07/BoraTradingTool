import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { ingestNseInstruments } from "@/lib/market/nse-connector";

export const dynamic = "force-dynamic";

/**
 * Ingest NSE instrument data from Yahoo Finance.
 *
 * POST /api/ingest
 * Body: { instruments?: ["IN:XNSE:RELIANCE", "IN:XNSE:SBIN"] }
 *
 * If no instruments specified, ingests a default list of liquid NSE names.
 */
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { instruments?: string[] };

  const defaults = [
    "IN:XNSE:RELIANCE",
    "IN:XNSE:TCS",
    "IN:XNSE:HDFCBANK",
    "IN:XNSE:INFY",
    "IN:XNSE:ICICIBANK",
    "IN:XNSE:KOTAKBANK",
    "IN:XNSE:LT",
    "IN:XNSE:SBIN",
    "IN:XNSE:BHARTIARTL",
    "IN:XNSE:ITC",
  ];

  const instruments = body.instruments ?? defaults;
  const results = await ingestNseInstruments(instruments);

  return NextResponse.json({
    ok: true,
    results: results.map((r) => ({
      instrumentId: r.instrumentId,
      ok: r.ok,
      barsIngested: r.barsIngested,
      reason: r.reason,
    })),
  });
}
