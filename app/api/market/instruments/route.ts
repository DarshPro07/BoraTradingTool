import { NextResponse } from "next/server";
import { searchInstruments } from "@/lib/market/catalog";
import { ensureNseSecurityMasterReady } from "@/lib/market/security-master-bootstrap";
import { searchCurrentNseInstruments, securityMasterStatus } from "@/lib/market/security-master";
import type { Exchange } from "@/lib/market/types";

const EXCHANGES = new Set<Exchange>(["XNAS", "XNYS", "XNSE", "XBOM"]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").slice(0, 80);
  const requestedExchange = params.get("exchange") as Exchange | null;
  const exchange = requestedExchange && EXCHANGES.has(requestedExchange) ? requestedExchange : undefined;
  let securityMaster = securityMasterStatus();

  if (exchange === "XNSE") {
    if (securityMaster.state === "UNAVAILABLE" || securityMaster.missingSourceKinds.length > 0) {
      const readiness = await ensureNseSecurityMasterReady();
      securityMaster = readiness.securityMaster;
      if (!readiness.ok) {
        return NextResponse.json(
          {
            error: "NSE_SECURITY_MASTER_UNAVAILABLE",
            message: readiness.message,
            securityMaster,
          },
          { status: 503 },
        );
      }
    }
    const numberParam = (name: string, fallback: number) => {
      const parsed = Number(params.get(name));
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
    };
    const result = searchCurrentNseInstruments(query, {
      series: params.get("series") ?? undefined,
      limit: numberParam("limit", 25),
      offset: numberParam("offset", 0),
    });
    return NextResponse.json({
      instruments: result.items,
      pagination: { total: result.total, limit: result.limit, offset: result.offset },
      securityMaster,
    });
  }

  let instruments = searchInstruments(query, exchange);
  if (securityMaster.state === "UNAVAILABLE" && instruments.length === 0) {
    const readiness = await ensureNseSecurityMasterReady();
    securityMaster = readiness.securityMaster;
    if (!readiness.ok) {
      return NextResponse.json(
        {
          error: "NSE_SECURITY_MASTER_UNAVAILABLE",
          message: readiness.message,
          securityMaster,
        },
        { status: 503 },
      );
    }
    instruments = searchInstruments(query, exchange);
  }
  return NextResponse.json({
    instruments,
    pagination: { total: instruments.length, limit: 25, offset: 0 },
    securityMaster,
  });
}
