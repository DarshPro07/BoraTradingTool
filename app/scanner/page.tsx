import { fetchQuantResource } from "@/lib/quantcore/client";
import { DataState, EmptyState, Panel, Provenance, StatTile } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

export default async function ScannerPage() {
  const [board, regime] = await Promise.all([fetchQuantResource("board"), fetchQuantResource("regime")]);

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">SCANNER</h1>
        <span className="text-xs text-muted-foreground">
          Candidates come from the deterministic quant core, not from a model.
        </span>
      </header>

      {board.ok ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Candidates" value={board.data.candidates.length} />
            <StatTile
              label="Paper candidates"
              value={board.data.candidates.filter((candidate) => candidate.verdict === "PAPER_CANDIDATE").length}
              hint="cleared the forward gate"
              tone="good"
            />
            <StatTile
              label="Research only"
              value={board.data.candidates.filter((candidate) => candidate.verdict === "RESEARCH_ONLY").length}
              hint="gate not open"
              tone="warn"
            />
            <StatTile label="Scenarios active" value={board.data.scenarios.active} />
          </div>

          <Panel title="CANDIDATES">
            {board.data.candidates.length === 0 ? (
              <EmptyState>The quant core produced no candidates for this session.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[560px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                      <th className="pb-1">Symbol</th>
                      <th className="pb-1">Side</th>
                      <th className="pb-1">Setup</th>
                      <th className="pb-1">Score</th>
                      <th className="pb-1">Verdict</th>
                      <th className="pb-1">Blockers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.data.candidates.map((candidate) => (
                      <tr key={`${candidate.symbol}-${candidate.setup}`} className="border-t border-panel">
                        <td className="py-1.5">{candidate.symbol}</td>
                        <td className="py-1.5 text-muted-foreground">{candidate.side}</td>
                        <td className="py-1.5 text-muted-foreground">{candidate.setup ?? "—"}</td>
                        <td className="py-1.5">{candidate.score ?? <span className="text-muted-foreground">not scored</span>}</td>
                        <td className={`py-1.5 ${candidate.verdict === "PAPER_CANDIDATE" ? "text-gain" : "text-amber"}`}>
                          {candidate.verdict}
                        </td>
                        <td className="py-1.5 text-muted-foreground">{candidate.blockers.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Provenance source={board.source} generatedAt={board.generatedAt} transport={board.transport} stale={board.stale} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="STRATEGY GATES">
              <div className="space-y-1.5 text-xs">
                {Object.entries(board.data.strategies).map(([strategy, state]) => (
                  <div key={strategy} className="flex justify-between border-b border-panel pb-1">
                    <span className="text-muted-foreground">{strategy.replace(/_/g, " ")}</span>
                    <span>{state}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="MARKET REGIME">
              {regime.ok ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between border-b border-panel pb-1">
                    <span className="text-muted-foreground">State</span>
                    <span>{regime.data.state}</span>
                  </div>
                  <div className="flex justify-between border-b border-panel pb-1">
                    <span className="text-muted-foreground">As of</span>
                    <span>{regime.data.asOf}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Confidence</span>
                    <span>{regime.data.confidence ?? "—"}</span>
                  </div>
                </div>
              ) : (
                <DataState code={regime.code} message={regime.message} source={regime.source} />
              )}
            </Panel>
          </div>
        </>
      ) : (
        <DataState code={board.code} message={board.message} source={board.source} />
      )}
    </div>
  );
}
