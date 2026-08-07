import { traceForward } from "@/lib/knowledge/repository";
import { buildMemoryGraph } from "@/lib/knowledge/memory-graph";
import { memoryGraphRoots } from "@/lib/dashboard/queries";
import { EmptyState, Panel, StatTile } from "@/components/system/Panel";
import { MemoryMap } from "@/components/memory/MemoryMap";

export const dynamic = "force-dynamic";

const NODE_TONE: Record<string, string> = {
  source: "text-foreground",
  claim: "text-amber",
  hypothesis: "text-amber",
  strategy: "text-gain",
  trial: "text-loss",
  forward_outcome: "text-gain",
  lesson: "text-muted-foreground",
};

export default async function MemoryGraphPage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string }>;
}) {
  const { node } = await searchParams;
  const roots = memoryGraphRoots();
  const graph = buildMemoryGraph();
  const selected = node ?? roots.sources[0]?.id ?? null;

  let trace: ReturnType<typeof traceForward> | null = null;
  let error: string | null = null;
  if (selected) {
    try {
      trace = traceForward(selected);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg tracking-wider">MEMORY GRAPH</h1>
        <span className="text-xs text-muted-foreground">
          Every conclusion traces back to a source. Nothing in this system is believed without provenance.
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sources" value={roots.sources.length} />
        <StatTile label="Strategies" value={roots.strategies.length} />
        <StatTile label="Lessons" value={roots.lessonCount} />
        <StatTile
          label="Contradictions"
          value={roots.contradictions.length}
          hint={`${roots.contradictions.filter((row) => !row.resolution).length} unresolved`}
          tone={roots.contradictions.some((row) => !row.resolution) ? "warn" : "neutral"}
        />
      </div>

      <Panel title="THE WHOLE GRAPH">
        <div data-testid="memory-map">
          <MemoryMap nodes={graph.nodes} edges={graph.edges} />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="CONNECTED TO NOTHING">
          {graph.orphans.length === 0 ? (
            <EmptyState>Every node is connected to something.</EmptyState>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground mb-2">
                Ingested, then never used. A claim nobody turned into a hypothesis is not
                knowledge the system has — it is knowledge it is sitting on.
              </p>
              <ul className="space-y-1 text-xs" data-testid="memory-orphans">
                {graph.orphans.slice(0, 12).map((orphan) => (
                  <li key={orphan.id} className="flex gap-2 border-b border-panel pb-1">
                    <span className="text-[10px] uppercase text-amber w-20 shrink-0">
                      {orphan.type.replace(/_/g, " ")}
                    </span>
                    <span className="flex-1 truncate">{orphan.label}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="FAILURES SEEN MORE THAN ONCE">
          {graph.repeatedFailures.length === 0 ? (
            <EmptyState>No failure mode has recurred.</EmptyState>
          ) : (
            <ul className="space-y-1 text-xs" data-testid="memory-repeated-failures">
              {graph.repeatedFailures.slice(0, 12).map((failure) => (
                <li key={failure.failureMode} className="flex gap-2 border-b border-panel pb-1">
                  <span className="text-loss w-10 shrink-0">×{failure.occurrences}</span>
                  <span className="flex-1 truncate">{failure.failureMode.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="ROOTS">
          {roots.sources.length === 0 ? (
            <EmptyState>No sources archived yet.</EmptyState>
          ) : (
            <ul className="space-y-1 text-xs">
              {roots.sources.map((source) => (
                <li key={source.id}>
                  <a
                    href={`/memory?node=${encodeURIComponent(source.id)}`}
                    className={`block border-b border-panel pb-1 hover:text-amber ${
                      source.id === selected ? "text-amber" : ""
                    }`}
                  >
                    {source.title}
                    <span className="block text-[10px] text-muted-foreground">{source.kind}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="DOWNSTREAM" className="lg:col-span-2">
          {error ? (
            <p className="text-xs text-loss">{error}</p>
          ) : !trace ? (
            <EmptyState>Select a source to trace what it produced.</EmptyState>
          ) : trace.nodes.length <= 1 ? (
            <EmptyState>
              This source is archived but has produced nothing yet — no claims, no hypotheses, no strategies.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              <ol className="space-y-2 text-xs">
                {trace.nodes.map((graphNode) => (
                  <li key={graphNode.id} className="flex flex-wrap items-baseline gap-2 border-b border-panel pb-1.5">
                    <span
                      className={`text-[10px] uppercase tracking-wider border border-panel px-1.5 py-0.5 ${
                        NODE_TONE[graphNode.type] ?? ""
                      }`}
                    >
                      {graphNode.type.replace(/_/g, " ")}
                    </span>
                    <span className="flex-1 min-w-[200px]">{graphNode.label}</span>
                    {graphNode.status ? (
                      <span className="text-[10px] text-muted-foreground">{graphNode.status}</span>
                    ) : null}
                  </li>
                ))}
              </ol>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Edges</div>
                <ul className="text-[11px] text-muted-foreground space-y-0.5">
                  {trace.edges.map((edge) => (
                    <li key={`${edge.from}-${edge.to}-${edge.relation}`}>
                      {edge.from.slice(0, 12)}… <span className="text-amber">{edge.relation}</span> →{" "}
                      {edge.to.slice(0, 12)}…
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
