import { NextResponse } from "next/server";
import { getAgentConfig, updateAgentConfig, getActiveStrategy, type AgentConfigPatch } from "@/lib/trading/config";
import { executionCapabilities } from "@/lib/trading/capabilities";
import { requireOwnerMutationAccess } from "@/lib/security/request";
import { readFiniteNumber, readJsonObject } from "@/lib/http/input";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getAgentConfig();
  // Never leak the bot token to the client; report only whether it's set.
  const { telegramBotToken, ...safe } = config;
  return NextResponse.json({
    ...safe,
    telegramTokenSet: false,
    telegramConfigured: false,
    activeStrategy: getActiveStrategy(),
    mode: "paper",
    capabilities: executionCapabilities,
  });
}

export async function PATCH(req: Request) {
  const denied = requireOwnerMutationAccess(req);
  if (denied) return denied;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const patch: AgentConfigPatch = {};

  if (typeof body.mode === "string") {
    if (body.mode !== "off" && body.mode !== "paper") {
      return NextResponse.json(
        { error: "LIVE_EXECUTION_DISABLED", message: "Only Paper Research Mode is available." },
        { status: 410 },
      );
    }
    patch.mode = "off";
  }
  if (typeof body.halt === "boolean") patch.halt = body.halt;
  if (typeof body.watchlistOnly === "boolean") patch.watchlistOnly = body.watchlistOnly;
  if (body.pollMinutes != null) {
    const value = readFiniteNumber(body.pollMinutes, { min: 1, max: 1440, integer: true });
    if (value === null) return bad("pollMinutes");
    patch.pollMinutes = value;
  }
  if (body.maxPositionPct != null) {
    const value = readFiniteNumber(body.maxPositionPct, { min: 0.1, max: 100 });
    if (value === null) return bad("maxPositionPct");
    patch.maxPositionPct = value;
  }
  if (body.dailyTradeCap != null) {
    const value = readFiniteNumber(body.dailyTradeCap, { min: 0, max: 1000, integer: true });
    if (value === null) return bad("dailyTradeCap");
    patch.dailyTradeCap = value;
  }
  if (body.activeStrategyId != null) {
    const value = readFiniteNumber(body.activeStrategyId, { min: 1, integer: true });
    if (value === null) return bad("activeStrategyId");
    patch.activeStrategyId = value;
  }
  const updated = updateAgentConfig(patch);
  const { telegramBotToken, ...safe } = updated;
  return NextResponse.json({
    ...safe,
    telegramTokenSet: false,
    mode: "paper",
    capabilities: executionCapabilities,
  });
}

function bad(field: string) {
  return NextResponse.json({ error: `invalid ${field}` }, { status: 400 });
}
