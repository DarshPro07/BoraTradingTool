import { NextResponse } from "next/server";
import { systemReadiness } from "@/lib/product/readiness";

export const dynamic = "force-dynamic";

/** The P0 System Readiness contract: what works, what is partial, what is missing, why, and
 * which job fixes it. Screens consume this instead of independently discovering emptiness. */
export async function GET() {
  return NextResponse.json(systemReadiness());
}
