import { sourceCoverage } from "@/lib/research/sources";
import { EmptyState, Panel } from "@/components/system/Panel";

/**
 * What the system is *supposed* to be reading, against what it has actually read.
 *
 * `sourceCoverage()` was written and then called from nowhere — the same shape as `runGauntlet`,
 * which was fully implemented and reachable only from the test suite. A registry with no screen
 * is decoration: it states a target nobody can check.
 *
 * The distinction this panel exists to draw: an **empty** pipeline reports its own gap, an
 * **undefined** one cannot, and the two look identical from the archive table alone. Eleven
 * declared sources with zero archived items is a measurable backlog. Eleven sources nobody
 * declared is not.
 */
export function SourceCoveragePanel() {
  const report = sourceCoverage();
  const busiest = report.coverage.reduce((most, entry) => Math.max(most, entry.archived), 0);

  return (
    <Panel
      title="SOURCE COVERAGE"
      action={
        <span className="text-[10px] text-muted-foreground">
          {report.active}/{report.declared} producing
        </span>
      }
    >
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{report.summary}</p>

      {report.coverage.length === 0 ? (
        <EmptyState>No sources are declared. The registry lives in lib/research/sources.ts.</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {report.coverage.map((entry) => (
            <li key={entry.source.id} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <a
                  href={entry.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-amber truncate"
                  title={entry.source.why}
                >
                  {entry.source.name}
                </a>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {entry.source.kind} · {entry.source.cadence}
                  {" · "}
                  {/* Never read and read-then-yielded-nothing are different facts. */}
                  {entry.archived === 0 ? (
                    <span className="text-amber">never read</span>
                  ) : (
                    <>
                      {entry.archived} item{entry.archived === 1 ? "" : "s"}
                      {entry.lastIngestedAt ? ` · ${entry.lastIngestedAt.toLocaleDateString()}` : ""}
                    </>
                  )}
                </span>
              </div>
              {/* Only drawn once something has been read. Eleven zero-width bars read as a broken
                  renderer rather than as an untouched backlog. */}
              {busiest > 0 ? (
                <div className="mt-0.5 h-0.5 bg-panel-alt">
                  <div
                    className={entry.archived > 0 ? "h-full bg-[var(--green)]" : "h-full"}
                    style={{ width: `${Math.round((entry.archived / busiest) * 100)}%` }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {report.unregistered > 0 ? (
        <p className="mt-3 pt-2 border-t border-panel text-[10px] text-muted-foreground">
          {report.unregistered} archived item{report.unregistered === 1 ? "" : "s"} match no declared
          source. Not an error — a one-off intake is legitimate — but a registry nothing matches is
          decoration.
        </p>
      ) : null}
    </Panel>
  );
}
