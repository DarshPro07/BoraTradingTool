import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { executionCapabilities } from "@/lib/trading/capabilities";

export const dynamic = "force-dynamic";

// Retired remote-decision compatibility surface. It is intentionally fail-closed.
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  return NextResponse.json(
    { error: executionCapabilities.reason, message: "Telegram trade decisions are disabled." },
    { status: 503 },
  );
}
