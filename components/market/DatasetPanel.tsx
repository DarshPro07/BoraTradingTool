import { importedDatasets, storedCoverage } from "@/lib/market/candle-store";
import { EmptyState, Panel } from "@/components/system/Panel";

/**
 * What historical data has been imported, and how far it may be trusted.
 *
 * Two facts sit here because they are only meaningful together. Coverage says how many bars
 * exist; fitness says whether a backtest built on them may be called evidence. A screen showing
 * only the first would report "1.2 million bars" about a dataset that cannot legitimately
 * produce a single trial — which is exactly the impression this system exists not to give.
 */

function when(seconds: number | null): string {
  if (seconds === null) return "—";
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** Bars per day, for turning a count into a span someone can judge. */
function spanLabel(bars: number, firstTime: number | null, lastTime: number | null): string {
  if (firstTime === null || lastTime === null) return `${bars} bars`;
  const days = Math.max(1, Math.round((lastTime - firstTime) / 86_400));
  return `${bars.toLocaleString()} bars across ${days} day${days === 1 ? "" : "s"}`;
}

export function DatasetPanel() {
  const coverage = storedCoverage();
  const datasets = importedDatasets(20);
  const unfit = datasets.filter((dataset) => dataset.unfitForValidation);

  return (
    <div className="space-y-4">
      <Panel
        title="IMPORTED DATASETS"
        action={
          <span className="text-[10px] text-muted-foreground">
            {datasets.length} imported · {unfit.length} not usable for validation
          </span>
        }
      >
        {datasets.length === 0 ? (
          <EmptyState>
            Nothing imported. Backtests read live candles, which reach about sixty days at
            1-minute resolution — enough to explore an intraday idea, not enough to validate one.
            Import a declared dataset to go deeper.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {datasets.map((dataset) => (
              <li key={dataset.id} className="text-xs border-t border-panel pt-2 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono">{dataset.source}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {dataset.importedAt.toLocaleDateString()} · {dataset.inserted.toLocaleString()} bars
                    {dataset.skipped > 0 ? ` · ${dataset.skipped.toLocaleString()} already held` : ""}
                    {dataset.rejected > 0 ? ` · ${dataset.rejected.toLocaleString()} rejected` : ""}
                  </span>
                </div>

                {dataset.declaration ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span>
                      prices:{" "}
                      {/* `unknown` is amber, not neutral. It is a gap in what anyone checked, and
                          rendering it as calmly as `raw` would be the whole mistake. */}
                      <span className={dataset.declaration.adjustment === "raw" ? "text-gain" : "text-amber"}>
                        {dataset.declaration.adjustment}
                      </span>
                    </span>
                    <span>
                      delisted included:{" "}
                      <span className={dataset.declaration.includesDelisted === true ? "text-gain" : "text-amber"}>
                        {dataset.declaration.includesDelisted === null
                          ? "not stated"
                          : String(dataset.declaration.includesDelisted)}
                      </span>
                    </span>
                    <span>
                      licence:{" "}
                      <span className={dataset.declaration.license ? "" : "text-amber"}>
                        {dataset.declaration.license ?? "unrecorded"}
                      </span>
                    </span>
                    <span>resolution: {dataset.declaration.resolution}</span>
                  </div>
                ) : null}

                {dataset.unfitForValidation ? (
                  // The reason, not a badge. "Unfit" tells you nothing you can act on; "prices are
                  // back-adjusted, so each bar contains information from after it" tells you to go
                  // and find a raw series.
                  <p className="mt-1 text-[10px] text-amber leading-relaxed">
                    Explore only — cannot produce a trial: {dataset.unfitForValidation}
                  </p>
                ) : (
                  <p className="mt-1 text-[10px] text-gain">
                    Declaration permits use in validation.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="LOCAL BAR COVERAGE"
        action={<span className="text-[10px] text-muted-foreground">{coverage.length} series</span>}
      >
        {coverage.length === 0 ? (
          <EmptyState>
            No bars are stored locally. This is not an error — every backtest currently fetches
            live, which is correct for daily strategies and the limit for intraday ones.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                  <th className="pb-1">Instrument</th>
                  <th className="pb-1">Resolution</th>
                  <th className="pb-1">Held</th>
                  <th className="pb-1">From</th>
                  <th className="pb-1">To</th>
                  <th className="pb-1">Backtest source</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((entry) => (
                  <tr key={`${entry.ticker} ${entry.resolution}`} className="border-t border-panel">
                    <td className="py-1.5 font-mono">{entry.ticker}</td>
                    <td className="py-1.5">{entry.resolution}</td>
                    <td className="py-1.5">{spanLabel(entry.bars, entry.firstTime, entry.lastTime)}</td>
                    <td className="py-1.5 text-muted-foreground">{when(entry.firstTime)}</td>
                    <td className="py-1.5 text-muted-foreground">{when(entry.lastTime)}</td>
                    {/* The 250-bar floor made visible. A partial import that silently shortened
                        every backtest would fail as INSUFFICIENT_BARS and read as a strategy
                        problem, so which source is actually in use has to be legible. */}
                    <td className={`py-1.5 ${entry.bars >= 250 ? "text-gain" : "text-muted-foreground"}`}>
                      {entry.bars >= 250 ? "stored" : "live (too few stored)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
