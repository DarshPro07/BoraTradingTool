import { NextResponse } from "next/server";
import { fetchQuantResource } from "@/lib/quantcore/client";
import { QUANT_RESOURCES, type QuantResource } from "@/lib/quantcore/contract";

export const dynamic = "force-dynamic";

const HTTP_STATUS: Record<string, number> = {
  QUANT_CORE_UNAVAILABLE: 503,
  RESOURCE_NOT_PROVIDED: 501,
  RESOURCE_MALFORMED: 502,
  CONTRACT_VERSION_MISMATCH: 502,
  RESOURCE_STALE: 200,
};

function isQuantResource(value: string): value is QuantResource {
  return (QUANT_RESOURCES as readonly string[]).includes(value);
}

export async function GET(_req: Request, context: { params: Promise<{ resource: string }> }) {
  const { resource } = await context.params;

  if (!isQuantResource(resource)) {
    return NextResponse.json(
      {
        ok: false,
        code: "UNKNOWN_RESOURCE",
        message: `Unknown quant-core resource "${resource}".`,
        available: QUANT_RESOURCES,
      },
      { status: 404 },
    );
  }

  const result = await fetchQuantResource(resource);
  if (result.ok) {
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(result, {
    status: HTTP_STATUS[result.code] ?? 503,
    headers: { "cache-control": "no-store" },
  });
}
