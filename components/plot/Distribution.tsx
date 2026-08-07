import { histogram, positionOf } from "@/lib/ui/plot";

/**
 * A distribution, not a verdict.
 *
 * `fail` tells you the outcome; it does not tell you whether the strategy missed by a hair or
 * was never close. Two candidates with the same verdict can have completely different shapes,
 * and the shape is what says which one is worth another look.
 *
 * `reference` marks the gate the sample was judged against, so the distance between the mass of
 * the distribution and the bar is visible rather than inferred.
 */
export function Distribution({
  values,
  reference,
  referenceLabel,
  label,
  width = 260,
  height = 60,
  bins = 24,
}: {
  values: readonly number[];
  reference?: number;
  referenceLabel?: string;
  label?: string;
  width?: number;
  height?: number;
  bins?: number;
}) {
  const data = histogram(values, bins);

  if (data.count === 0) {
    return (
      <p className="text-[10px] text-muted-foreground py-2">
        No sample to plot. This is an absence of data, not a distribution centred on zero.
      </p>
    );
  }

  const barWidth = width / data.bins.length;
  const referenceX = reference !== undefined ? positionOf(reference, data.min, data.max, width) : null;

  return (
    <figure className="m-0">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label ?? "Distribution"} of ${data.count} values from ${data.min.toFixed(3)} to ${data.max.toFixed(3)}`}
      >
        {data.bins.map((bin, index) => {
          const barHeight = data.peak > 0 ? (bin.count / data.peak) * (height - 2) : 0;
          // Compared at the midpoint, not the upper edge: the bin containing the reference
          // straddles it, so `bin.to <= reference` never fired for the bin holding most of the
          // losing mass — on a series of small losses and a few large wins that painted the
          // whole distribution as passing.
          //
          // A bin that spans the reference is drawn neutral rather than picked for a side. When
          // one large outlier stretches the range, the bins near zero are wider than the values
          // they separate, and asserting a side there would be a claim the resolution cannot
          // support.
          const straddles = reference !== undefined && bin.from < reference && bin.to > reference;
          const midpoint = (bin.from + bin.to) / 2;
          const failing = reference !== undefined && !straddles && midpoint < reference;
          const tone = straddles ? "text-muted-foreground" : failing ? "text-loss" : "text-terminal";
          return (
            <rect
              key={bin.from}
              x={index * barWidth}
              y={height - barHeight}
              width={Math.max(1, barWidth - 1)}
              height={barHeight}
              className={`fill-current ${tone}`}
              opacity={straddles ? 0.5 : 0.75}
            >
              <title>
                {`${bin.from.toFixed(3)} to ${bin.to.toFixed(3)}: ${bin.count} (${(bin.share * 100).toFixed(1)}%)` +
                  (straddles ? " — spans the reference, so neither side is claimed" : "")}
              </title>
            </rect>
          );
        })}

        {referenceX !== null ? (
          <>
            <line
              x1={referenceX}
              y1={0}
              x2={referenceX}
              y2={height}
              stroke="currentColor"
              className="text-amber"
              strokeWidth={1}
              strokeDasharray="3 2"
            />
            <title>{referenceLabel ?? `Gate at ${reference}`}</title>
          </>
        ) : null}
      </svg>
      <figcaption className="text-[9px] text-muted-foreground flex justify-between">
        <span>{data.min.toFixed(2)}</span>
        <span>
          {data.count} samples
          {referenceLabel ? ` · ${referenceLabel}` : ""}
        </span>
        <span>{data.max.toFixed(2)}</span>
      </figcaption>
    </figure>
  );
}
