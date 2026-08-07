import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { executionCapabilities } from "@/lib/trading/capabilities";

export const dynamic = "force-dynamic";

// Retired live-order compatibility surface. It is intentionally fail-closed.
export async function POST(req: Request) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  return NextResponse.json(
    {
      error: executionCapabilities.reason,
      message: "Live broker execution is not installed. Use Paper Research Mode.",
    },
    { status: 503 },
  );
}
