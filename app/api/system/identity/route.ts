import { NextResponse } from "next/server";
import { systemIdentity } from "@/lib/system/identity";

export const dynamic = "force-dynamic";

/**
 * Which build, process, schema and database is serving this request.
 *
 * Unauthenticated, matching `/api/system/status`. What it discloses is bounded on purpose: a commit
 * hash, a PID, a start time, a migration filename and a one-way hash. No path, no credential, no
 * configuration — the database is identified by fingerprint precisely so that proving identity never
 * requires publishing filesystem layout.
 */
export async function GET() {
  return NextResponse.json(systemIdentity());
}
