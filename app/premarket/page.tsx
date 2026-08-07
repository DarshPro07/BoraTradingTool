import Link from "next/link";
import { AlertTriangle, Clock, EyeOff } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { buildPreMarketReport } from "@/lib/premarket/report";
import type { Market } from "@/lib/market/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Pre-market Command Center.
 *
 * Two markets side by side, each showing which phase it is actually in — India's pre-open is
 * three distinct phases, not one — and what the system could not see. The unavailable panel is
 * not boilerplate: it is the difference between "nothing was banned" and "we cannot check".
 */
export default async function PreMarketPage() {
  const markets: Market[] = ["IN", "US"];
  const reports = await Promise.all(markets.map((market) => buildPreMarketReport(market)));

  return (
    <div className="min-h-screen bg-background">
      <AutoRefresh intervalMs={60_000} />
      <div className="max-w-screen-2xl mx-auto px-4 py-5 space-y-4">
        <section className="market-hero rise-1">
          <div>
            <p className="terminal-kicker">PRE-MARKET / INDIA &amp; UNITED STATES</p>
            <h1>Pre-market Command Center</h1>
            <p>Where each market is in its session, what moved overnight, and what could not be seen.</p>
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {reports.map((report) => (
            <section
              key={report.market}
              className="terminal-panel p-4 rise-2"
              data-testid={`premarket-${report.market}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-xs font-bold uppercase tracking-wider">
                  {report.market === "IN" ? "India (NSE)" : "United States"}
                </h2>
                <span
                  className="text-[11px] uppercase tracking-wider text-terminal"
                  data-testid={`phase-${report.market}`}
                >
                  {report.phase.phase.replace(/_/g, " ")}
                </span>
              </div>

              <div className="border border-panel bg-panel-alt px-3 py-2 mb-3">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  <Clock className="w-3 h-3" />
                  {report.phase.localTime} · {report.phase.timezone}
                  {report.phase.isEarlyClose ? <span className="text-amber">· EARLY CLOSE</span> : null}
                </div>
                <p className="text-[11px] leading-relaxed">{report.phase.knowable}</p>
                {report.phase.minutesToNextBoundary !== null ? (
                  <p className="text-[10px] text-muted-foreground mt-1" data-testid={`next-${report.market}`}>
                    {report.phase.minutesToNextBoundary} min to {String(report.phase.nextPhase).replace(/_/g, " ")}
                  </p>
                ) : report.phase.nextSessionOpen ? (
                  <p className="text-[10px] text-muted-foreground mt-1" data-testid={`next-${report.market}`}>
                    Opens {report.phase.nextSessionOpen.weekday} {report.phase.nextSessionOpen.date} at{" "}
                    {report.phase.nextSessionOpen.localTime} ·{" "}
                    {report.phase.nextSessionOpen.phase.replace(/_/g, " ")}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                  ["Advancing", report.breadth.advancing, "text-gain"],
                  ["Declining", report.breadth.declining, "text-loss"],
                  ["Unchanged", report.breadth.unchanged, ""],
                  ["Median", `${report.breadth.medianGapPct.toFixed(2)}%`, ""],
                ].map(([label, value, tone]) => (
                  <div key={String(label)} className="stat-tile border border-panel bg-panel-alt px-2 py-1">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
                    <div className={`text-sm ${tone}`}>{value}</div>
                  </div>
                ))}
              </div>

              {report.gaps.length ? (
                <div className="space-y-1" data-testid={`gaps-${report.market}`}>
                  {report.gaps.slice(0, 8).map((row) => (
                    <Link
                      key={row.instrumentId}
                      href={`/analyze/${encodeURIComponent(row.instrumentId)}`}
                      className="flex items-center justify-between gap-2 border border-panel bg-panel-alt px-3 py-1.5 hover:border-terminal transition-colors"
                    >
                      <span className="text-[11px]">{row.symbol}</span>
                      <span className="text-[10px] text-muted-foreground flex-1 truncate">{row.name}</span>
                      <span className={`text-[11px] ${row.gapPct >= 0 ? "text-gain" : "text-loss"}`}>
                        {row.gapPct >= 0 ? "+" : ""}
                        {row.gapPct.toFixed(2)}%
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-3 text-center">
                  No usable quotes were returned for this market.
                </p>
              )}

              {report.missingQuotes.length ? (
                <p className="text-[10px] text-amber mt-2">
                  {report.missingQuotes.length} instrument(s) returned no usable quote:{" "}
                  {report.missingQuotes.slice(0, 6).join(", ")}
                </p>
              ) : null}

              <div className="mt-3 pt-3 border-t border-panel" data-testid={`unavailable-${report.market}`}>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  <EyeOff className="w-3 h-3" />
                  Not visible to this deployment
                </div>
                <ul className="space-y-1">
                  {report.unavailable.map((entry) => (
                    <li key={entry.input} className="text-[10px] text-muted-foreground leading-relaxed">
                      <span className="text-amber">{entry.input}</span> — {entry.why}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">{report.caveat}</p>
            </section>
          ))}
        </div>

        <div className="inline-notice inline-notice-warning">
          <AlertTriangle className="w-4 h-4" />
          Overnight-move summary only. Auction imbalance, ban lists and price bands require licensed
          exchange feeds this deployment does not have — their absence is listed, never assumed benign.
        </div>
      </div>
    </div>
  );
}
