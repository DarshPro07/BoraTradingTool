import { NextResponse } from "next/server";
import { traceBack, traceForward } from "@/lib/knowledge/repository";
import { KnowledgeError } from "@/lib/knowledge/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nodeId = url.searchParams.get("nodeId")?.trim();
  const direction = url.searchParams.get("direction") === "forward" ? "forward" : "back";

  if (!nodeId) {
    return NextResponse.json(
      { error: "NODE_ID_REQUIRED", message: "Provide a nodeId to trace." },
      { status: 400 },
    );
  }

  try {
    const trace = direction === "forward" ? traceForward(nodeId) : traceBack(nodeId);
    return NextResponse.json({ direction, ...trace }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof KnowledgeError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 404 });
    }
    throw error;
  }
}
