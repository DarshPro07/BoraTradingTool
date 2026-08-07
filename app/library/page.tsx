import { researchLibrary } from "@/lib/dashboard/queries";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";
import { SourceCoveragePanel } from "@/components/research/SourceCoverage";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const sources = researchLibrary();
  const withoutLicense = sources.filter((source) => !source.license).length;

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">RESEARCH LIBRARY</h1>
        <span className="text-xs text-muted-foreground">
          Every source is content-hashed, so the same paper cannot enter the system twice.
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sources" value={sources.length} />
        <StatTile label="Claims extracted" value={sources.reduce((total, source) => total + source.claims, 0)} />
        <StatTile
          label="Yielded nothing"
          value={sources.filter((source) => source.claims === 0).length}
          hint="archived but unmined"
          tone="warn"
        />
        <StatTile
          label="Licence unknown"
          value={withoutLicense}
          hint="check before reuse"
          tone={withoutLicense > 0 ? "warn" : "good"}
        />
      </div>

      <SourceCoveragePanel />

      <Panel title="ARCHIVE">
        {sources.length === 0 ? (
          <EmptyState>
            Nothing archived. Use <code>marketpulse_record_source</code> from Claude Code, or queue an ingestion job.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                  <th className="pb-1">Title</th>
                  <th className="pb-1">Kind</th>
                  <th className="pb-1">Claims</th>
                  <th className="pb-1">Licence</th>
                  <th className="pb-1">Status</th>
                  <th className="pb-1">Archived</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id} className="border-t border-panel">
                    <td className="py-1.5">
                      {source.url ? (
                        <a href={source.url} target="_blank" rel="noreferrer" className="hover:text-amber">
                          {source.title}
                        </a>
                      ) : (
                        source.title
                      )}
                      {source.rejectionReason ? (
                        <div className="text-[10px] text-loss">rejected: {source.rejectionReason}</div>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-muted-foreground">{source.kind}</td>
                    <td className={`py-1.5 ${source.claims === 0 ? "text-amber" : ""}`}>{source.claims}</td>
                    <td className="py-1.5 text-muted-foreground">
                      {source.license ?? <span className="text-amber">unknown</span>}
                    </td>
                    <td className="py-1.5 text-muted-foreground">{source.status}</td>
                    <td className="py-1.5 text-muted-foreground">
                      {new Date(source.ingestedAt).toLocaleDateString()}
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
