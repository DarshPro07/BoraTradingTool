import Link from "next/link";
import { commandCenter } from "@/lib/dashboard/queries";
import { DataState, EmptyState, Panel, Provenance, StatTile } from "@/components/system/Panel";
import { ActivityFeed } from "@/components/learning/ActivityFeed";
import { RunCycleButton } from "@/components/learning/RunCycleButton";
import { inspectMemory } from "@/lib/learning/introspection";
import { NextStep } from "@/components/guide/NextStep";

export const dynamic = "force-dynamic";

export default async function CommandCenterPage() {
  const data = await commandCenter();
  const { board, counts, quantCore } = data;
  const introspection = inspectMemory();
  const needsAttention = introspection.findings.filter((finding) => finding.severity === "attention");

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">COMMAND CENTER</h1>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-amber">EXECUTION DISABLED</span>
          <span className="text-muted-foreground">·</span>
          <span>
            LEARNING <span className="text-amber">{data.learningMode.toUpperCase()}</span>
          </span>
        </div>
      </header>

      {quantCore.liveExecution ? (
        <div className="inline-notice-warning border px-3 py-3 text-xs">
          <strong className="text-loss">UNEXPECTED LIVE EXECUTION.</strong> The quant core reports execution
          enabled. This system has no execution path — investigate the quant core before continuing.
        </div>
      ) : null}

      {/* Before anything else: what to do next. Every other panel reports state; this one is
          the only element that tells someone who has not traded before what to do about it. */}
      <NextStep />

      {/* Then the two questions the owner opens this page to answer:
          what did it do, and what is waiting on me. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          title="WHAT IT DID"
          action={<RunCycleButton />}
        >
          <ActivityFeed limit={10} />
        </Panel>

        <Panel title="WHAT NEEDS ME">
          {needsAttention.length === 0 ? (
            <EmptyState>Nothing is waiting on you. {introspection.summary}</EmptyState>
          ) : (
            <ul className="space-y-1.5 text-xs" data-testid="needs-me">
              {needsAttention.map((finding, index) => (
                <li key={`${finding.kind}-${index}`} className="border border-panel bg-panel-alt px-2.5 py-1.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-amber">
                      {finding.kind.replace(/_/g, " ")}
                    </span>
                    <span className="flex-1 min-w-[180px]">{finding.summary}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                    → {finding.suggestedWork}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sources" value={counts.sources} hint={`${counts.claims} claims extracted`} />
        <StatTile
          label="Hypotheses"
          value={counts.hypotheses}
          hint={`${counts.duplicateHypotheses} rejected as duplicates`}
        />
        <StatTile
          label="Strategies"
          value={counts.strategies}
          hint={`${counts.paperChallengers} paper challengers`}
          tone={counts.paperChallengers > 0 ? "good" : "neutral"}
        />
        <StatTile
          label="Trials"
          value={counts.trials}
          hint={`${counts.failedTrials} failed — kept on record`}
          tone={counts.trials > 0 ? "neutral" : "warn"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="LIVE OPPORTUNITIES"
          action={<Link href="/scanner" className="text-[10px] text-muted-foreground hover:text-foreground">SCANNER →</Link>}
        >
          {board.ok ? (
            board.data.candidates.length === 0 ? (
              <EmptyState>The quant core returned no candidates for this session.</EmptyState>
            ) : (
              <>
                <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[420px]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground text-left">
                      <th className="pb-1">Symbol</th>
                      <th className="pb-1">Setup</th>
                      <th className="pb-1">Verdict</th>
                      <th className="pb-1">Blockers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.data.candidates.slice(0, 8).map((candidate) => (
                      <tr key={`${candidate.symbol}-${candidate.setup}`} className="border-t border-panel">
                        <td className="py-1">{candidate.symbol}</td>
                        <td className="py-1 text-muted-foreground">{candidate.setup ?? "—"}</td>
                        <td className={`py-1 ${candidate.verdict === "PAPER_CANDIDATE" ? "text-gain" : "text-amber"}`}>
                          {candidate.verdict}
                        </td>
                        <td className="py-1 text-muted-foreground">{candidate.blockers.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <Provenance
                  source={board.source}
                  generatedAt={board.generatedAt}
                  transport={board.transport}
                  stale={board.stale}
                />
              </>
            )
          ) : (
            <DataState code={board.code} message={board.message} source={board.source} />
          )}
        </Panel>

        <Panel title="FORWARD EVIDENCE">
          {board.ok ? (
            <>
              <div className="space-y-1.5 text-xs">
                {Object.entries(board.data.gates).map(([gate, value]) => (
                  <div key={gate} className="flex justify-between border-b border-panel pb-1">
                    <span className="text-muted-foreground">{gate.replace(/_/g, " ")}</span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Historical</div>
                  <div>
                    <span className="text-gain">{board.data.outcomeAudit.historicalWins}W</span>
                    {" / "}
                    <span className="text-loss">{board.data.outcomeAudit.historicalLosses}L</span>
                    {" / "}
                    <span className="text-muted-foreground">{board.data.outcomeAudit.historicalExpired}E</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Live resolved</div>
                  <div>{board.data.outcomeAudit.liveResolved}</div>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
                Historical outcomes are in-sample. Only live resolved observations are unbiased evidence, and
                there are {board.data.outcomeAudit.liveResolved} of them.
              </p>
            </>
          ) : (
            <DataState code={board.code} message={board.message} source={board.source} />
          )}
        </Panel>

        <Panel
          title="RESEARCH FACTORY"
          action={<Link href="/edge-factory" className="text-[10px] text-muted-foreground hover:text-foreground">FACTORY →</Link>}
        >
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {Object.entries(data.queue).map(([status, count]) => (
              <div key={status} className="border border-panel px-2 py-1">
                <div className="text-[10px] uppercase text-muted-foreground">{status}</div>
                <div className={count > 0 && status === "dead" ? "text-loss" : ""}>{count}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Evolution proposals</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.proposals).map(([status, count]) => (
                <span key={status} className="border border-panel px-1.5 py-0.5 text-[10px]">
                  {status.replace(/_/g, " ")}: {count}
                </span>
              ))}
            </div>
          </div>
        </Panel>

        <Panel
          title="SYSTEM HEALTH"
          action={<Link href="/data-quality" className="text-[10px] text-muted-foreground hover:text-foreground">DATA →</Link>}
        >
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between border-b border-panel pb-1">
              <span className="text-muted-foreground">Quant core</span>
              <span className={quantCore.reachable ? "text-gain" : "text-loss"}>
                {quantCore.reachable ? `${quantCore.transport.toUpperCase()}${quantCore.stale ? " (STALE)" : ""}` : "UNREACHABLE"}
              </span>
            </div>
            <div className="flex justify-between border-b border-panel pb-1">
              <span className="text-muted-foreground">Quant core mode</span>
              <span>{quantCore.mode ?? "—"}</span>
            </div>
            <div className="flex justify-between border-b border-panel pb-1">
              <span className="text-muted-foreground">Broker execution</span>
              <span className="text-amber">{data.execution.reason}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Learning mode</span>
              <span className="text-amber">{data.learningMode}</span>
            </div>
          </div>
          {!quantCore.reachable && quantCore.message ? (
            <p className="mt-2 text-[10px] text-muted-foreground">{quantCore.message}</p>
          ) : null}
        </Panel>
      </div>

      <Panel
        title="RECENT ANALYSES"
        action={<Link href="/analyst" className="text-[10px] text-muted-foreground hover:text-foreground">ANALYST →</Link>}
      >
        {data.recentAnalyses.length === 0 ? (
          <EmptyState>
            No analyses recorded yet. Connect Claude Code to the MarketPulse MCP server and record one.
          </EmptyState>
        ) : (
          <ul className="space-y-2 text-xs">
            {data.recentAnalyses.map((analysis) => (
              <li key={analysis.id} className="border-b border-panel pb-2">
                <div className="flex justify-between gap-2">
                  <span>{analysis.instrumentId}</span>
                  <span
                    className={
                      analysis.stance === "bullish"
                        ? "text-gain"
                        : analysis.stance === "bearish"
                          ? "text-loss"
                          : "text-muted-foreground"
                    }
                  >
                    {analysis.stance.toUpperCase()} · {(analysis.conviction * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5">{analysis.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
