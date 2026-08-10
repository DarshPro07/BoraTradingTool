import { Panel, StatTile } from "@/components/system/Panel";
import { StateBadge } from "@/components/system/PanelState";
import { pendingForecasts } from "@/lib/forecast/live";
import { FORECAST_GATES } from "@/lib/forecast/score";
import { kronosCoverage } from "@/lib/forecast/kronos";

/**
 * Is the forecaster any good? Not "did it run" — is it better than doing nothing.
 *
 * This is the only unbiased evidence the system produces cheaply. Every other number is computed
 * over history the model or strategy was selected on; this one is not. The prediction is written
 * to disk before the outcome exists, so lookahead is structurally impossible rather than merely
 * guarded against — and it costs no capital and places no order.
 *
 * The baseline is deliberately the hardest one: persistence, "the next close equals this close".
 * It is embarrassingly difficult to beat on financial series, and it is the check a headline
 * accuracy number never survives. A model can post an excellent MAE on a quiet series while being
 * strictly worse than persistence, because most of the error it avoided was error persistence
 * never made.
 *
 * So the panel shows a verdict only once {@link FORECAST_GATES.minScoredBars} bars have resolved.
 * Below that it says how many are outstanding, which is a fact, rather than an accuracy figure,
 * which at this sample size would be a coin-flip estimate wearing three decimal places.
 */

export function ForecastValidationPanel() {
  const coverage = kronosCoverage();
  const pending = pendingForecasts();

  // Bars, not forecasts: the gate counts resolved bars, and a five-bar forecast contributes five.
  const outstandingBars = pending.reduce((total, item) => total + item.bars.length, 0);
  const enoughInFlight = outstandingBars >= FORECAST_GATES.minScoredBars;

  const earliest = pending.reduce<number | null>((min, item) => {
    const at = Date.parse(item.generatedAt);
    return min === null || at < min ? at : min;
  }, null);

  return (
    <Panel
      title="FORECAST VALIDATION — LIVE"
      action={<StateBadge state={pending.length === 0 ? "empty" : "current"} />}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatTile
          label="Awaiting a grade"
          value={pending.length}
          hint={`${outstandingBars} bar(s) in flight`}
          tone={pending.length > 0 ? "neutral" : "warn"}
        />
        <StatTile
          label="Bars needed"
          value={FORECAST_GATES.minScoredBars}
          hint={enoughInFlight ? "enough in flight" : `${FORECAST_GATES.minScoredBars - outstandingBars} short`}
          tone={enoughInFlight ? "good" : "warn"}
        />
        <StatTile label="Forecast files" value={coverage.files} hint="written by the runner" />
        <StatTile
          label="Oldest prediction"
          value={earliest === null ? "—" : new Date(earliest).toISOString().slice(0, 10)}
          hint="written before the outcome existed"
        />
      </div>

      <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
        {pending.length === 0
          ? coverage.reason
          : `${pending.length} prediction(s) are on disk waiting for the market to produce their bars. ` +
            `Each is graded against persistence — "the next close equals this close" — paired bar by bar and ` +
            `put through the same bootstrap the gauntlet uses. Lower error is not a result; lower error than ` +
            `persistence, by more than resampling explains, is a result.`}
      </p>

      {pending.length > 0 ? (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            In flight
          </div>
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 font-normal">Instrument</th>
                <th className="py-1 font-normal">Predicted at</th>
                <th className="py-1 font-normal text-right">Bars</th>
              </tr>
            </thead>
            <tbody>
              {pending.slice(0, 8).map((item) => (
                <tr key={item.file} className="border-t border-panel">
                  <td className="py-1">{item.instrumentId}</td>
                  <td className="py-1 text-muted-foreground">{item.generatedAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="py-1 text-right">{item.bars.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pending.length > 8 ? (
            <p className="text-[10px] text-muted-foreground mt-1">
              {pending.length - 8} more not listed.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-[10px] text-muted-foreground mt-3 border-t border-panel pt-2 leading-relaxed">
        A forecast is <code>not_forward_validated</code> until it is scored — a status the reader stamps
        itself and which nothing in the forecast file can claim. Grading happens in the autonomous cycle;
        no verdict appears here until the market has actually produced the bars.
      </p>
    </Panel>
  );
}
