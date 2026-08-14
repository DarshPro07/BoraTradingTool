import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/input";
import { requireMutationAccess } from "@/lib/security/request";
import { ingestInstrumentHistory, instrumentReadiness } from "@/lib/market/ingest";

/**
 * In-product historical ingestion.
 *
 * Closes the gap that made a fresh database permanently un-researchable: `researchInstrument`
 * correctly refuses with `NO_STORED_DATA`, and until now the only way out was two manual CLI steps
 * run outside the application. A capability the user must reach through a terminal is not a
 * capability the product has.
 *
 * POST because it writes to the canonical candle store and spends a provider call, so it sits
 * behind `requireMutationAccess` (loopback + same-origin + local session + mutation header) — the
 * same boundary as every other mutating route here.
 *
 * A refusal is a 200 with `ok: false` and a code, not a transport error. "The source had no bars"
 * and "the source had too few bars" are product outcomes the UI must render truthfully; retrying
 * a 500 would tell the user nothing.
 */

export const dynamic = "force-dynamic";
/** A real history fetch across two years is slow; well under the research route's own ceiling. */
export const maxDuration = 120;

/** Readiness without side effects — how many bars are held, how many are required. */
export async function GET(req: Request) {
  const instrumentId = new URL(req.url).searchParams.get("instrumentId")?.trim();
  if (!instrumentId) {
    return NextResponse.json(
      { error: "INVALID_INSTRUMENT", message: "instrumentId is required." },
      { status: 400 },
    );
  }

  return NextResponse.json(instrumentReadiness(instrumentId), {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;

  const body = parsed.value as { instrumentId?: unknown };
  if (typeof body.instrumentId !== "string" || body.instrumentId.trim().length === 0) {
    return NextResponse.json(
      { error: "INVALID_INSTRUMENT", message: "instrumentId is required." },
      { status: 400 },
    );
  }

  const result = await ingestInstrumentHistory(body.instrumentId.trim());

  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
