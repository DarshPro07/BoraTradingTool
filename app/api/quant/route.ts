import { NextResponse } from "next/server";
import { DEFERRED_INDICATORS, INDICATOR_REGISTRY } from "@/lib/quant/indicator-registry";
import { listModelAssumptions } from "@/lib/quant/model-assumptions";

export const dynamic = "force-dynamic";

/** The quant contract surface: registered indicators (with conventions) and model assumptions. */
export async function GET() {
  return NextResponse.json({
    indicators: INDICATOR_REGISTRY.map((spec) => ({
      id: spec.id,
      version: spec.version,
      inputs: spec.inputs,
      parameters: spec.parameters,
      outputs: spec.outputs,
      warmup: spec.warmup,
      missingData: spec.missingData,
      applicability: spec.applicability,
      requiresContext: spec.requiresContext ?? [],
      conventions: spec.conventions ?? {},
    })),
    deferred: DEFERRED_INDICATORS,
    assumptions: listModelAssumptions(),
  });
}
