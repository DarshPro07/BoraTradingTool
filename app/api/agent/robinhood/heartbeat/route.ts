import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { executionCapabilities } from "@/lib/trading/capabilities";

export const dynamic = "force-dynamic";

// The agent calls POST after verifying the Robinhood MCP is live (e.g. it just
// ran getAccount()). This is what unlocks the real-money controls. Optional
// { account } labels the connection in the UI.
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  return disabled();
}

export async function GET() {
  return NextResponse.json({ connected: false, ...executionCapabilities });
}

// Agent disconnecting, or user forcing the gate shut.
export async function DELETE(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  return disabled();
}

function disabled() {
  return NextResponse.json(
    { error: executionCapabilities.reason, message: "Broker heartbeat is disabled." },
    { status: 503 },
  );
}
