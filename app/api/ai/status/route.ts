import { NextResponse } from "next/server";
import { getAiStatus } from "@/lib/ai/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAiStatus());
}
