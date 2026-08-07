import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { executionCapabilities } from "@/lib/trading/capabilities";

export const dynamic = "force-dynamic";

// The UI polls this: connection liveness + the latest pushed snapshot. The page
// shows "real trading not available" until robinhood.connected is true, then
// renders the snapshot once the agent has pushed one.
export async function GET() {
  return NextResponse.json({
    broker: null,
    snapshot: null,
    ...executionCapabilities,
  });
}

// The agent pushes the Agentic account's portfolio here after reading it from
// the Robinhood MCP. Only one snapshot is kept (the active agentic account).
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  return disabled();
}

export async function DELETE(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  return disabled();
}

function disabled() {
  return NextResponse.json(
    { error: executionCapabilities.reason, message: "Broker portfolio mutation is disabled." },
    { status: 503 },
  );
}
