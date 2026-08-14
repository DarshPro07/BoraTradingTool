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
  // A non-empty unscoped search (global navigation) must be ISIN-backed. The static catalog can
  // answer symbol hits without the master, but those rows carry no security identity (ISIN/series);
  // serving them silently would hide a master outage. An empty query is a pure listing of the
  // pinned snapshot and stays available offline — it must not trigger a network bootstrap.
  // A STALE master still serves ISIN provenance (its rows are real security identities, just not
  // freshly observed); only an UNAVAILABLE master forces a live bootstrap. Blocking a page load
  // on a live exchange download for a STALE-but-usable master was a real regression: it timed out
  // analyze-page renders in the acceptance matrix.
  const requiresMaster = query.length > 0 && securityMaster.state === "UNAVAILABLE";
  if (requiresMaster) {
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
