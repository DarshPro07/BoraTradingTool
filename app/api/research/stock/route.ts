import { NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/input";
import { requireMutationAccess } from "@/lib/security/request";
import { researchInstrument } from "@/lib/research/bridge";
import { latestResearchRun } from "@/lib/runtime/agent-runs";

/**
 * M5 — Research this stock.
 *
 * POST because it spends real subscription quota on the owner's machine, and
 * `requireMutationAccess` is what keeps that spend loopback-and-same-origin only. Nothing here
 * writes to the database yet: this slice proves the evidence → model → verification → envelope
 * path, and persistence into the research ledger is the next one.
 *
 * A refused run is a 200 with `ok: false` and the reason. The refusal IS the product behaviour —
 * "no provider could serve this" and "the store has no bars for this instrument" are results the
 * UI must render, not transport errors to be retried.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The last completed research run for an instrument, so a reload shows what the system actually
 * found rather than an empty panel. Read-only, hence no mutation gate.
 */
export async function GET(req: Request) {
  const instrumentId = new URL(req.url).searchParams.get("instrumentId")?.trim();
  if (!instrumentId) {
    return NextResponse.json(
      { error: "INVALID_INSTRUMENT", message: "instrumentId is required." },
      { status: 400 },
    );
  }

  const stored = latestResearchRun(instrumentId);
  return NextResponse.json(
    stored ? { found: true, ...stored } : { found: false },
    { headers: { "cache-control": "no-store" } },
  );
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

  const result = await researchInstrument(body.instrumentId.trim());

  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
