import { NextResponse } from "next/server";
import { getBrainState } from "@/lib/brain/kernel";

export const dynamic = "force-dynamic";

/**
 * GET /api/brain — full Brain state including lanes, providers, capabilities, events.
 */
export async function GET() {
  try {
    const state = await getBrainState();
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: "BRAIN_ERROR", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
