import type { SectorPerformance } from "@/lib/providers/types";

interface Props {
  sectors: SectorPerformance[];
}

function intensity(pct: number) {
  const abs = Math.abs(pct);
  if (abs > 2) return 0.9;
  if (abs > 1.5) return 0.7;
  if (abs > 1) return 0.5;
  if (abs > 0.5) return 0.35;
  return 0.15;
}

export function SectorHeatmap({ sectors }: Props) {
  const sorted = [...sectors].sort((a, b) => b.changePct - a.changePct);

  return (
    <div className="terminal-panel rise-2 p-4">
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Sector Performance</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {sorted.map((s) => {
          const isGain = s.changePct >= 0;
          const alpha = intensity(s.changePct);
          const bg = isGain ? `rgba(0,204,102,${alpha})` : `rgba(204,51,51,${alpha})`;
          return (
            <div
              key={s.sector}
              className="rounded p-2.5 text-center"
              style={{ background: bg }}
            >
              <div className="text-xs font-semibold leading-tight text-foreground">{s.sector}</div>
              <div className={`text-sm font-bold font-mono mt-1 ${isGain ? "text-gain" : "text-loss"}`}>
                {isGain ? "+" : ""}{s.changePct.toFixed(2)}%
              </div>
            </div>
          );
        })}
        {!sorted.length && (
          <p className="col-span-full py-8 text-center text-xs text-muted-foreground">
            Sector breadth is unavailable for this market source.
          </p>
        )}
      </div>
    </div>
  );
}
