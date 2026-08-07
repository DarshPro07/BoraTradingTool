import { NextResponse } from "next/server";
import { requireMutationAccess } from "@/lib/security/request";
import { executionCapabilities } from "@/lib/trading/capabilities";

export const dynamic = "force-dynamic";

// Retired external-fill compatibility surface. It is intentionally fail-closed.
export async function POST(req: Request, _context: { params: Promise<{ id: string }> }) {
  const denied = requireMutationAccess(req);
  if (denied) return denied;
  return NextResponse.json(
    { error: executionCapabilities.reason, message: "External fill reports are disabled." },
    { status: 503 },
  );
}
