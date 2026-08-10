import { Panel, StatTile } from "@/components/system/Panel";
import { StateBadge } from "@/components/system/PanelState";
import { intradayDepth } from "@/lib/market/intraday-accumulator";

/**
 * Intraday history the provider no longer serves.
 *
 * The constraint the owner set is "free, live-fetched only", and the ceiling that constraint
 * implies is real: Yahoo returns a sliding window — roughly sixty days at five minutes — so any
 * single fetch caps an intraday backtest at sixty days, and waiting does not help because the
 * window moves with you.
 *
 * Keeping what falls off the back removes the ceiling without spending anything. This panel shows
 * how far past the provider's window the store has grown, because that number is the whole point:
 * the day it exceeds the window, the system holds history that cannot be obtained any other way
 * without buying it.
 *
 * Below that threshold it is honest about being below it. A store with three weeks of bars is
 * three weeks of bars, not "intraday coverage".
 */

/** What the provider itself would return, in days, per resolution. */
const PROVIDER_WINDOW: Readonly<Record<string, number>> = Object.freeze({
  "1": 7,
  "5": 59,
  "15": 59,
  "30": 59,
  "60": 59,
});

export function IntradayDepthPanel() {
  const depth = intradayDepth();
  const totalBars = depth.reduce((total, entry) => total + entry.bars, 0);
  const beyond = depth.filter((entry) => entry.beyondProvider).length;
  const deepest = depth.reduce((max, entry) => Math.max(max, entry.spanDays ?? 0), 0);

  return (
    <Panel
      title="INTRADAY HISTORY — ACCUMULATED"
      action={<StateBadge state={depth.length === 0 ? "empty" : "current"} />}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatTile label="Series held" value={depth.length} hint="instrument × resolution" />
        <StatTile label="Bars kept" value={totalBars.toLocaleString("en-IN")} hint="settled sessions only" />
        <StatTile
          label="Deepest span"
          value={deepest > 0 ? `${deepest}d` : "—"}
          hint="oldest to newest stored bar"
        />
        <StatTile
          label="Beyond provider"
          value={beyond}
          tone={beyond > 0 ? "good" : "neutral"}
          hint={beyond > 0 ? "unobtainable in one fetch" : "still within the live window"}
        />
      </div>

      <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
        {depth.length === 0
          ? "Nothing accumulated yet. The autonomous cycle keeps settled intraday bars each pass; the store fills over days, not in one run."
          : beyond > 0
            ? `${beyond} series now hold more history than the live feed's sliding window can return — seeded by a deep fetch, then extended each session by keeping what the window drops. Neither half was purchased.`
            : `The store is still inside the provider's window, so nothing here is unobtainable yet. It becomes so once a series passes its window — 59 days at 5, 15, 30 and 60 minutes, 7 days at 1 minute.`}
      </p>

      {depth.length > 0 ? (
        <div className="mt-3">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 font-normal">Instrument</th>
                <th className="py-1 font-normal">Res</th>
                <th className="py-1 font-normal text-right">Bars</th>
                <th className="py-1 font-normal text-right">Span</th>
                <th className="py-1 font-normal text-right">vs provider</th>
              </tr>
            </thead>
            <tbody>
              {depth.slice(0, 10).map((entry) => {
                const window = PROVIDER_WINDOW[entry.resolution] ?? 59;
                const over = (entry.spanDays ?? 0) - window;
                return (
                  <tr key={`${entry.instrumentId}-${entry.resolution}`} className="border-t border-panel">
                    <td className="py-1">{entry.instrumentId}</td>
                    <td className="py-1 text-muted-foreground">{entry.resolution}m</td>
                    <td className="py-1 text-right">{entry.bars.toLocaleString("en-IN")}</td>
                    <td className="py-1 text-right">{entry.spanDays === null ? "—" : `${entry.spanDays}d`}</td>
                    <td className={`py-1 text-right ${entry.beyondProvider ? "text-gain" : "text-muted-foreground"}`}>
                      {over > 0 ? `+${over}d` : `${over}d`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {depth.length > 10 ? (
            <p className="text-[10px] text-muted-foreground mt-1">{depth.length - 10} more not listed.</p>
          ) : null}
        </div>
      ) : null}

      <p className="text-[10px] text-muted-foreground mt-3 border-t border-panel pt-2 leading-relaxed">
        Only bars from sessions that have fully elapsed are kept. A bar captured mid-session and revised
        upstream afterwards would become a permanent disagreement inside the store that nothing would ever
        reconcile — so the current session is excluded entirely, not merely the forming bar.
      </p>
    </Panel>
  );
}
