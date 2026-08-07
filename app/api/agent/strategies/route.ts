import { NextResponse } from "next/server";
import { listStrategies, createStrategy } from "@/lib/trading/config";
import { requireOwnerMutationAccess } from "@/lib/security/request";
import { readBoundedString, readEnum, readFiniteNumber, readJsonObject } from "@/lib/http/input";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listStrategies());
}

export async function POST(req: Request) {
  const denied = requireOwnerMutationAccess(req);
  if (denied) return denied;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  const name = readBoundedString(body.name, { min: 1, max: 80 });
  const prompt = readBoundedString(body.prompt, { min: 1, max: 8_000 });
  if (!name || !prompt) {
    return NextResponse.json({ error: "name and prompt required" }, { status: 400 });
  }
  const riskProfile = readEnum(body.riskProfile ?? "medium", ["low", "medium", "high"] as const);
  const maxPositionPct = body.maxPositionPct == null
    ? null
    : readFiniteNumber(body.maxPositionPct, { min: 0.1, max: 100 });
  if (!riskProfile || (body.maxPositionPct != null && maxPositionPct === null)) {
    return NextResponse.json({ error: "invalid strategy limits" }, { status: 400 });
  }
  const strategy = createStrategy({
    name,
    prompt,
    riskProfile,
    maxPositionPct,
  });
  return NextResponse.json(strategy, { status: 201 });
}
