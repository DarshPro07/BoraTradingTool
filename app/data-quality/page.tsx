import { dataQuality } from "@/lib/dashboard/queries";
import { DatasetPanel } from "@/components/market/DatasetPanel";
import { DataState, Panel, Provenance, StatTile } from "@/components/system/Panel";
import { kronosCoverage } from "@/lib/forecast/kronos";
import { StateBadge } from "@/components/system/PanelState";
import { stateFromErrorCode, worstState, type PanelState } from "@/lib/ui/panel-state";
import type { QuantResource } from "@/lib/quantcore/contract";

export const dynamic = "force-dynamic";

function ResourceRow({
  name,
  result,
}: {
  name: QuantResource;
  result: Awaited<ReturnType<typeof dataQuality>>[keyof Awaited<ReturnType<typeof dataQuality>>];
}) {
  return (
    <div className="border border-panel bg-panel-alt p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wider">{name}</span>
        {/* The code and the badge come from one mapping, so a refusal cannot be shown as OK. */}
        <StateBadge state={result.ok ? (result.stale ? "stale" : "current") : stateFromErrorCode(result.code)} />
      </div>
      {result.ok ? (
        <Provenance
          source={result.source}
          generatedAt={result.generatedAt}
          transport={result.transport}
          stale={result.stale}
        />
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">{result.message}</p>
      )}
    </div>
  );
}

export default async function DataQualityPage() {
  const resources = await dataQuality();
  const coverage = kronosCoverage();
  const overall: PanelState = worstState(
    Object.values(resources).map((result) =>
      result.ok ? (result.stale ? "stale" : "current") : stateFromErrorCode(result.code),
    ),
  );
  const entries = Object.entries(resources) as [string, (typeof resources)["health"]][];
  const provided = entries.filter(([, result]) => result.ok).length;
  const stale = entries.filter(([, result]) => result.ok && result.stale).length;

  return (
    <div className="p-4 space-y-4">
      {/* Imported history sits on the data-quality screen rather than its own, because whether a
          dataset may be trusted is the same question the rest of this page answers. */}
      <DatasetPanel />

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg tracking-wider">DATA QUALITY</h1>
          <span data-testid="overall-state">
            <StateBadge state={overall} detail="worst of all resources" />
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          Missing data is reported as missing. It is never rendered as zero.
        </span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Resources provided" value={`${provided}/${entries.length}`} />
        <StatTile label="Stale" value={stale} tone={stale > 0 ? "warn" : "good"} />
        <StatTile
          label="Not provided"
          value={entries.filter(([, result]) => !result.ok && result.code === "RESOURCE_NOT_PROVIDED").length}
          hint="open bridge requests"
        />
        <StatTile
          label="Malformed"
          value={entries.filter(([, result]) => !result.ok && result.code === "RESOURCE_MALFORMED").length}
          tone="bad"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([name, result]) => (
          <ResourceRow key={name} name={name as QuantResource} result={result} />
        ))}
      </div>

      <Panel title="FORECAST MODEL — KRONOS">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <span className="text-[11px] text-muted-foreground">
            Decoder-only foundation model over candlestick tokens (MIT, AAAI 2026). See
            docs/adr/0004.
          </span>
          <span data-testid="kronos-status">
            <StateBadge
              state={coverage.available ? "current" : "unavailable"}
              detail={coverage.available ? `${coverage.files} delivered` : undefined}
            />
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{coverage.reason}</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed mt-2">
          A delivered forecast is <span className="text-amber">not_forward_validated</span> and
          stays that way until it beats the persistence baseline — &ldquo;the next close equals
          this close&rdquo; — by more than resampling explains. A published benchmark result is a
          reason to look, never a reason to skip the gauntlet.
        </p>
      </Panel>

      <Panel title="QUANT CORE DATA STATUS">
        {resources.health.ok ? (
          <div className="space-y-1.5 text-xs">
            {Object.entries(resources.health.data.dataStatus).map(([key, value]) => (
              <div key={key} className="flex justify-between border-b border-panel pb-1 gap-4">
                <span className="text-muted-foreground">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                <span className="text-right">{value === null ? <span className="text-amber">not reported</span> : String(value)}</span>
              </div>
            ))}
          </div>
        ) : (
          <DataState code={resources.health.code} message={resources.health.message} source={resources.health.source} />
        )}
      </Panel>
    </div>
  );
}
