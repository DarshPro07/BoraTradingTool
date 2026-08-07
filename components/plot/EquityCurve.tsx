import { drawdown, lineSeries } from "@/lib/ui/plot";

/**
 * Equity and the drawdown beneath it.
 *
 * Drawn together because they answer different questions and one without the other misleads: a
 * curve that ends higher than it started looks like a success until you see it spent four months
 * forty percent below its peak. The drawdown strip is measured against the running peak, so
 * "still above where I started" never counts as "no pain".
 */
export function EquityCurve({
  equity,
  width = 320,
  height = 70,
  currency = "",
}: {
  equity: readonly number[];
  width?: number;
  height?: number;
  currency?: string;
}) {
  if (equity.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground py-3 text-center" data-testid="equity-empty">
        No closed trades yet, so there is no realised curve to draw. An open position that is down
        is not a loss until it is closed.
      </p>
    );
  }

  const strip = Math.round(height * 0.3);
  const main = height - strip;
  const line = lineSeries(equity, width, main);
  const decline = drawdown(equity);
  const declineLine = lineSeries(decline.series, width, strip);
  const last = equity[equity.length - 1];
  const first = equity[0];
  const up = last >= first;

  return (
    <figure className="m-0" data-testid="equity-curve">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Equity from ${first.toFixed(2)} to ${last.toFixed(2)}, worst drawdown ${(decline.max * 100).toFixed(1)} percent`}
      >
        <g className={up ? "text-gain" : "text-loss"}>
          <path d={line.area} className="fill-current" opacity={0.12} />
          <path d={line.path} className="stroke-current" fill="none" strokeWidth={1.25} />
        </g>

        <g transform={`translate(0 ${main})`} className="text-loss">
          <line x1={0} y1={0} x2={width} y2={0} stroke="currentColor" opacity={0.2} strokeWidth={0.5} />
          <path d={declineLine.area} className="fill-current" opacity={0.18} />
        </g>
      </svg>
      <figcaption className="text-[9px] text-muted-foreground flex justify-between">
        <span>{equity.length} closed</span>
        <span className={up ? "text-gain" : "text-loss"}>
          {up ? "+" : ""}
          {(last - first).toFixed(2)} {currency}
        </span>
        <span className="text-loss">worst DD {(decline.max * 100).toFixed(1)}%</span>
      </figcaption>
    </figure>
  );
}
