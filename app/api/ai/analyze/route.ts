import { NextResponse } from "next/server";
import { AiAnalysisRequestSchema } from "@/lib/ai/schema";
import { analyzeInstrument } from "@/lib/ai/service";
import { AiServiceError } from "@/lib/ai/provider";
import { readJsonObject } from "@/lib/http/input";
import { requireMutationAccess } from "@/lib/security/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = requireMutationAccess(request);
  if (denied) return denied;
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const parsed = AiAnalysisRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_AI_REQUEST", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    return NextResponse.json(await analyzeInstrument(parsed.data));
  } catch (error) {
    if (error instanceof AiServiceError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "AI_PROVIDER_ERROR", message: "Analysis failed." }, { status: 502 });
  }
}
