import { getDb, schema } from "@/lib/db";
import { Panel } from "@/components/system/Panel";
import { StateBody } from "@/components/system/PanelState";
import { buildStarMap, familyOf, type StarInput } from "@/lib/strategy/star-map";

/**
 * The Star Map — every strategy variant at once, clustered by family.
 *
 * A registry table shows twenty rows and hides the shape of the search. This shows that a family
 * has sixty variants and two survivors, which *is* the multiple-testing problem — and that
 * problem is invisible in any list.
 *
 * Server-rendered SVG. Hover gives the variant, its family, its status and its result; there is
 * no client JavaScript, because a tooltip is what `<title>` is for.
 */
export function StarMap() {
  const db = getDb();
  const specs = db.select().from(schema.strategySpecs).all();

  if (specs.length === 0) {
    return (
      <Panel title="STAR MAP">
        <StateBody
          state="empty"
          reason="No strategies exist yet. Author one above and it appears here — the map is a view of the registry, not a separate record."
        />
      </Panel>
    );
  }

  const results = db.select().from(schema.validationResults).all();
  const pnlBySpec = new Map<string, number>();
  for (const row of results) {
    // Screen P&L is not stored directly; out-of-sample profit factor is the closest honest
    // stand-in the ledger holds, and it is labelled as such rather than dressed up as money.
    const value = typeof row.oosProfitFactor === "number" ? row.oosProfitFactor : null;
    if (value !== null) pnlBySpec.set(row.strategySpecId, value);
  }

  const inputs: StarInput[] = specs.map((spec) => ({
    id: spec.id,
    name: `${spec.name} v${spec.version}`,
    family: familyOf(spec.name),
    status: spec.status,
    pnl: pnlBySpec.get(spec.id) ?? null,
    trades: 0,
  }));

  const map = buildStarMap(inputs, 880, 380);

  return (
    <Panel title="STAR MAP">
      <div className="flex flex-wrap items-center gap-2 mb-2 text-[10px] text-muted-foreground">
        <span>{map.total} variants</span>
        <span>·</span>
        <span>{map.constellations.length} families</span>
        <span>·</span>
        <span>widest search {map.largestFamily}</span>
        <span>·</span>
        <span className={map.brightnessUnavailable ? "text-amber" : ""}>
          {map.brightnessUnavailable
            ? "brightness carries no information — nothing has been validated yet"
            : "brightness = out-of-sample profit factor"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 mb-2" data-testid="star-families">
        {map.constellations.map((constellation) => (
          <span key={constellation.family} className="border border-panel bg-panel-alt px-1.5 py-0.5 text-[10px]">
            {constellation.family.replace(/_/g, " ").toUpperCase()} · {constellation.count}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <svg
          width={map.width}
          height={map.height}
          viewBox={`0 0 ${map.width} ${map.height}`}
          role="img"
          aria-label={`Star map: ${map.total} strategy variants in ${map.constellations.length} families`}
          className="star-map"
          data-testid="star-map"
        >
          <defs>
            <radialGradient id="star-glow">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>

          {map.constellations.map((constellation) => (
            <g key={constellation.family}>
              {constellation.links.map((link, index) => (
                <line
                  key={index}
                  x1={link.x1}
                  y1={link.y1}
                  x2={link.x2}
                  y2={link.y2}
                  stroke="currentColor"
                  className="text-terminal"
                  strokeWidth={0.4}
                  strokeOpacity={0.25}
                />
              ))}

              <text
                x={constellation.x}
                y={constellation.y}
                textAnchor="middle"
                className="fill-current text-terminal"
                style={{ fontSize: 9, letterSpacing: "0.14em" }}
                opacity={0.55}
              >
                {constellation.family.toUpperCase()} · {constellation.count}
              </text>

              {constellation.stars.map((point) => (
                <g key={point.id} className={point.buried ? "text-loss" : "text-terminal"}>
                  <circle cx={point.x} cy={point.y} r={7} fill="url(#star-glow)" opacity={point.brightness * 0.55} />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={point.buried ? 1.6 : 2.1}
                    className="fill-current"
                    opacity={0.35 + point.brightness * 0.65}
                  >
                    <title>
                      {`${point.name}\n${point.family} · ${point.status}` +
                        (point.pnl !== null ? `\nOOS profit factor ${point.pnl.toFixed(2)}` : "\nnever validated")}
                    </title>
                  </circle>
                </g>
              ))}
            </g>
          ))}
        </svg>
      </div>

      <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
        Position is a family cluster, not a metric — it is stable across renders so a star keeps
        its place. Red marks a burial. A family with many variants and few survivors is a wide
        search, and every variant in it raises the bar the winner must clear.
      </p>
    </Panel>
  );
}
