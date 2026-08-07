import { analystDesk } from "@/lib/dashboard/queries";
import { EmptyState, EpistemicBadge, Panel, StatTile } from "@/components/system/Panel";

export const dynamic = "force-dynamic";

function evidencePreview(value: unknown): string {
  const serialized = JSON.stringify(value);
  return (serialized ?? String(value)).slice(0, 160);
}

const STANCE_TONE: Record<string, string> = {
  bullish: "text-gain",
  bearish: "text-loss",
  neutral: "text-muted-foreground",
  abstain: "text-amber",
};

export default async function AnalystPage() {
  const { analyses, lessons, curriculum, mastery, concepts } = await analystDesk();

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">ANALYST &amp; TUTOR</h1>
        <span className="text-xs text-muted-foreground">
          Analysis is produced by Claude Code over the MCP server and recorded here with citations.
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Analyses" value={analyses.length} />
        <StatTile label="Lessons" value={lessons.length} />
        <StatTile label="Concepts" value={concepts.length} />
        <StatTile label="Due to review" value={curriculum.length} tone={curriculum.length > 0 ? "warn" : "good"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="ANALYSES" className="lg:col-span-2">
          {analyses.length === 0 ? (
            <EmptyState>
              Nothing recorded yet. In Claude Code, call <code>marketpulse_record_analysis</code> after reviewing an
              instrument&apos;s evidence.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {analyses.map((analysis) => (
                <li key={analysis.id} className="border border-panel bg-panel-alt p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm">{analysis.instrumentId}</span>
                    <span className={`text-xs ${STANCE_TONE[analysis.stance] ?? ""}`}>
                      {analysis.stance.toUpperCase()} · conviction {(analysis.conviction * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed">{analysis.summary}</p>

                  <div className="mt-2 grid gap-2 sm:grid-cols-3 text-[11px]">
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Bull</div>
                      <ul className="text-gain space-y-0.5">
                        {analysis.record.debate.bull.map((point) => <li key={point}>· {point}</li>)}
                        {analysis.record.debate.bull.length === 0 ? <li className="text-muted-foreground">—</li> : null}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Bear</div>
                      <ul className="text-loss space-y-0.5">
                        {analysis.record.debate.bear.map((point) => <li key={point}>· {point}</li>)}
                        {analysis.record.debate.bear.length === 0 ? <li className="text-muted-foreground">—</li> : null}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Neutral</div>
                      <ul className="text-muted-foreground space-y-0.5">
                        {analysis.record.debate.neutral.map((point) => <li key={point}>· {point}</li>)}
                        {analysis.record.debate.neutral.length === 0 ? <li>—</li> : null}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-2">
                    <div className="text-[10px] uppercase text-muted-foreground mb-1">Evidence</div>
                    <ul className="space-y-1 text-[11px]">
                      {analysis.record.evidence.map((item) => (
                        <li key={item.statement} className="flex flex-wrap items-center gap-2">
                          <EpistemicBadge status={item.epistemicStatus} />
                          <span>{item.statement}</span>
                          {item.citation ? (() => {
                            const source = analysis.evidencePackage.items.find((entry) => entry.id === item.citation);
                            return source ? (
                              <span className="text-muted-foreground" title={evidencePreview(source.value)}>
                                [{source.label}: {evidencePreview(source.value)}]
                              </span>
                            ) : null;
                          })() : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {analysis.record.invalidation.length > 0 ? (
                    <div className="mt-2 text-[11px]">
                      <span className="text-[10px] uppercase text-muted-foreground">Invalidated if: </span>
                      <span className="text-amber">{analysis.record.invalidation.join("; ")}</span>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="STUDY NEXT">
            {curriculum.length === 0 ? (
              <EmptyState>Nothing due. Add concepts through lessons to build a curriculum.</EmptyState>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {curriculum.map((item) => (
                  <li key={item.conceptId} className="flex justify-between border-b border-panel pb-1">
                    <span>{item.name}</span>
                    <span className="text-muted-foreground text-[10px]">{item.reason.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="MASTERY">
            {mastery.length === 0 ? (
              <EmptyState>No concepts recorded yet.</EmptyState>
            ) : (
              <ul className="space-y-2 text-xs">
                {mastery.map((entry) => (
                  <li key={entry.plane}>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{entry.plane.replace(/_/g, " ")}</span>
                      <span>
                        {entry.studied}/{entry.concepts}
                      </span>
                    </div>
                    <div className="h-1 bg-panel-alt mt-1">
                      <div
                        className="h-1 bg-[var(--green)]"
                        style={{ width: `${entry.concepts === 0 ? 0 : (entry.studied / entry.concepts) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="LESSONS">
            {lessons.length === 0 ? (
              <EmptyState>No lessons yet.</EmptyState>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {lessons.slice(0, 8).map((lesson) => (
                  <li key={lesson.id} className="border-b border-panel pb-1">
                    <div>{lesson.title}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {lesson.level} · {(JSON.parse(lesson.citations) as string[]).length} citation(s)
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
