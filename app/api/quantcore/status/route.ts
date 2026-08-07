import { NextResponse } from "next/server";
import { quantCoreStatus } from "@/lib/quantcore/client";
import { getLearningMode } from "@/lib/governance/runtime";
import { executionCapabilities } from "@/lib/trading/capabilities";

export const dynamic = "force-dynamic";

export async function GET() {
  const quantCore = await quantCoreStatus();

  return NextResponse.json(
    {
      quantCore,
      learningMode: getLearningMode(),
      execution: executionCapabilities,
      // The quant core reporting live execution would contradict this system's design.
      // Surface it as a fault rather than treating it as a capability.
      fault: quantCore.liveExecution
        ? {
            code: "UNEXPECTED_LIVE_EXECUTION",
            message:
              "The quant core reports live execution enabled. This system has no execution path; investigate the quant core before continuing.",
          }
        : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
