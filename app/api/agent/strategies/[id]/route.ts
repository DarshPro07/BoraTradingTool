import { NextResponse } from "next/server";
import { updateStrategy, deleteStrategy } from "@/lib/trading/config";
import { requireOwnerMutationAccess } from "@/lib/security/request";
import { readBoundedString, readEnum, readFiniteNumber, readJsonObject } from "@/lib/http/input";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireOwnerMutationAccess(req);
  if (denied) return denied;
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "invalid strategy id" }, { status: 400 });
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  const patch: { name?: string; prompt?: string; riskProfile?: string; maxPositionPct?: number | null } = {};
  if (body.name !== undefined) {
    const value = readBoundedString(body.name, { min: 1, max: 80 });
    if (!value) return NextResponse.json({ error: "invalid name" }, { status: 400 });
    patch.name = value;
  }
  if (body.prompt !== undefined) {
    const value = readBoundedString(body.prompt, { min: 1, max: 8_000 });
    if (!value) return NextResponse.json({ error: "invalid prompt" }, { status: 400 });
    patch.prompt = value;
  }
  if (body.riskProfile !== undefined) {
    const value = readEnum(body.riskProfile, ["low", "medium", "high"] as const);
    if (!value) return NextResponse.json({ error: "invalid riskProfile" }, { status: 400 });
    patch.riskProfile = value;
  }
  if (body.maxPositionPct !== undefined) {
    const value = body.maxPositionPct === null
      ? null
      : readFiniteNumber(body.maxPositionPct, { min: 0.1, max: 100 });
    if (body.maxPositionPct !== null && value === null) {
      return NextResponse.json({ error: "invalid maxPositionPct" }, { status: 400 });
    }
    patch.maxPositionPct = value;
  }
  const updated = updateStrategy(numericId, patch);
  if (!updated) return NextResponse.json({ error: "strategy not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireOwnerMutationAccess(req);
  if (denied) return denied;
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "invalid strategy id" }, { status: 400 });
  }
  const ok = deleteStrategy(numericId);
  if (!ok) {
    return NextResponse.json(
      { error: "cannot delete (default strategy or not found)" },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}
