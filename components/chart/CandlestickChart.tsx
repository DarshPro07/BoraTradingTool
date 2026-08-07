"use client";

import { useEffect, useRef, useState } from "react";
import type { Candle } from "@/lib/providers/types";

type Timeframe = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "5Y";

interface Props {
  ticker: string;
  initialCandles: Candle[];
  quotePrice: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  /** Who produced the initial series. Provenance is a fact; it is never inferred from prices. */
  candleProvider?: "YAHOO" | "FINNHUB" | "INDIAN_API" | "TEST_FIXTURE";
}

const TIMEFRAME_CONFIG: Record<Timeframe, { resolution: string; days: number }> = {
  "1D": { resolution: "5", days: 1 },
  "5D": { resolution: "15", days: 5 },
  "1M": { resolution: "60", days: 30 },
  "6M": { resolution: "D", days: 180 },
  "YTD": { resolution: "D", days: new Date().getMonth() * 30 + new Date().getDate() },
  "1Y": { resolution: "D", days: 365 },
  "5Y": { resolution: "W", days: 1825 },
};

function computeSMA(candles: Candle[], period: number): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const avg = candles.slice(i - period + 1, i + 1).reduce((sum, c) => sum + c.close, 0) / period;
    result.push({ time: candles[i].time, value: +avg.toFixed(2) });
  }
  return result;
}

/** Beyond this the candle series and the live quote cannot be describing the same instrument. */
const DIVERGENCE_LIMIT = 0.3;

type Divergence = { state: "aligned" } | { state: "unknown" } | { state: "diverged"; pct: number };

/**
 * How far the last candle sits from the live quote.
 *
 * This used to be called `isSimulated`, and a divergence over 30% printed "chart shows
 * simulated price history". That was never what the number measured, and it has not been
 * possible since the mock provider was removed — `EmptyProvider.getCandles()` returns an empty
 * array, so no fabricated candle enters the app at all. What a large gap actually indicates is
 * a stale series, a symbol that resolved to a different listing, or an unadjusted corporate
 * action. Those are worth showing. Calling them "simulated" told the user the data was fake
 * when it was real, and hid the live-quote price line as a side effect.
 */
function divergence(candles: Candle[], quotePrice: number): Divergence {
  // A zero or non-finite quote makes the ratio NaN, and `NaN > 0.3` is false — which used to
  // read as "aligned". Unknown must never fall through to reassurance.
  if (candles.length === 0 || !Number.isFinite(quotePrice) || quotePrice <= 0) return { state: "unknown" };
  const lastClose = candles[candles.length - 1].close;
  if (!Number.isFinite(lastClose)) return { state: "unknown" };
  const pct = Math.abs(lastClose - quotePrice) / quotePrice;
  return pct > DIVERGENCE_LIMIT ? { state: "diverged", pct } : { state: "aligned" };
}

export function CandlestickChart({ ticker, initialCandles, quotePrice, candleProvider }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [candles, setCandles] = useState<Candle[]>(initialCandles);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const gap = divergence(candles, quotePrice);
  const fixture = candleProvider === "TEST_FIXTURE";

  async function loadCandles(tf: Timeframe) {
    setLoading(true);
    setLoadError(null);
    try {
      const { days, resolution } = TIMEFRAME_CONFIG[tf];
      const to = Math.floor(Date.now() / 1000);
      const from = to - days * 86400;
      const res = await fetch(`/api/candles?ticker=${ticker}&resolution=${resolution}&from=${from}&to=${to}`);
      const data = await res.json();
      // Falling back to `initialCandles` silently re-drew the 1Y series under a highlighted 5D
      // button — the chart then showed a different timeframe than it claimed. Say so instead.
      if (!res.ok || !Array.isArray(data.candles)) {
        setLoadError(`${tf} data unavailable${data.error ? `: ${String(data.error).slice(0, 120)}` : ""}. Still showing the previous range.`);
        return;
      }
      if (data.candles.length === 0) {
        setLoadError(`No candles returned for ${tf}. Still showing the previous range.`);
        return;
      }
      setCandles(data.candles);
    } catch (error) {
      setLoadError(`${tf} request failed: ${error instanceof Error ? error.message : "unknown error"}. Still showing the previous range.`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;

    let cleanup: (() => void) | undefined;

    import("lightweight-charts").then((lc) => {
      if (!chartRef.current) return;

      const chart = lc.createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height: 420,
        layout: { background: { color: "#111111" }, textColor: "#a0a0a0" },
        grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
        crosshair: { mode: lc.CrosshairMode.Normal },
        rightPriceScale: { borderColor: "#2a2a2a" },
        timeScale: { borderColor: "#2a2a2a", timeVisible: true },
      });

      const candleSeries = chart.addSeries(lc.CandlestickSeries, {
        upColor: "#00cc66",
        downColor: "#cc3333",
        borderUpColor: "#00cc66",
        borderDownColor: "#cc3333",
        wickUpColor: "#00cc66",
        wickDownColor: "#cc3333",
        // Hide the default last-candle price line + axis label; we draw our own at the live
        // quote so daily timeframes reflect the latest (extended-hours) price instead of the
        // regular-session close. Keep the default when the quote cannot be trusted to belong
        // to this series — fixture data, or a series that has diverged from the quote.
        priceLineVisible: fixture || gap.state !== "aligned",
        lastValueVisible: fixture || gap.state !== "aligned",
      });

      const volumeSeries = chart.addSeries(lc.HistogramSeries, {
        color: "#26a69a",
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const sma20Series = chart.addSeries(lc.LineSeries, { color: "#3399ff", lineWidth: 1, priceLineVisible: false });
      const sma50Series = chart.addSeries(lc.LineSeries, { color: "#ffcc00", lineWidth: 1, priceLineVisible: false });
      const sma200Series = chart.addSeries(lc.LineSeries, { color: "#ff6600", lineWidth: 1, priceLineVisible: false });

      type LCTime = import("lightweight-charts").Time;
      const candleData = candles.map((c) => ({ time: c.time as LCTime, open: c.open, high: c.high, low: c.low, close: c.close }));
      const volData = candles.map((c) => ({ time: c.time as LCTime, value: c.volume, color: c.close >= c.open ? "#00cc6640" : "#cc333340" }));

      candleSeries.setData(candleData);
      volumeSeries.setData(volData);

      // Current-price line at the live (extended-hours) quote, consistent across
      // all timeframes and matching the header.
      if (!fixture && gap.state === "aligned") {
        candleSeries.createPriceLine({
          price: quotePrice,
          color: "#e0e0e0",
          lineWidth: 1,
          lineStyle: lc.LineStyle.Dashed,
          axisLabelVisible: true,
          title: "",
        });
      }
      sma20Series.setData(computeSMA(candles, 20).map((d) => ({ ...d, time: d.time as LCTime })));
      sma50Series.setData(computeSMA(candles, 50).map((d) => ({ ...d, time: d.time as LCTime })));
      sma200Series.setData(computeSMA(candles, 200).map((d) => ({ ...d, time: d.time as LCTime })));

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth });
      });
      ro.observe(chartRef.current);

      cleanup = () => {
        ro.disconnect();
        chart.remove();
      };
    });

    return () => cleanup?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  return (
    <div className="bg-panel border border-panel rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Price Chart</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-3 h-0.5 bg-[#3399ff] inline-block" /> SMA20
            <span className="w-3 h-0.5 bg-[#ffcc00] inline-block" /> SMA50
            <span className="w-3 h-0.5 bg-[#ff6600] inline-block" /> SMA200
          </div>
          <div className="flex gap-1">
            {(Object.keys(TIMEFRAME_CONFIG) as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => { setTimeframe(tf); loadCandles(tf); }}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  timeframe === tf ? "bg-terminal text-black font-bold" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>
      {fixture && (
        <div
          className="mb-2 px-2 py-1.5 bg-amber/10 border border-amber/30 rounded text-xs text-amber flex items-center gap-2"
          data-testid="chart-fixture-warning"
        >
          <span>⚠</span>
          <span>Fixture data. This series came from the test provider, not a market feed.</span>
        </div>
      )}
      {!fixture && gap.state === "diverged" && (
        <div
          className="mb-2 px-2 py-1.5 bg-amber/10 border border-amber/30 rounded text-xs text-amber flex items-center gap-2"
          data-testid="chart-divergence-warning"
        >
          <span>⚠</span>
          <span>
            The last candle closes {(gap.pct * 100).toFixed(0)}% away from the live quote. The
            series may be stale, unadjusted for a corporate action, or for a different listing —
            it is not fabricated.
          </span>
        </div>
      )}
      {!fixture && gap.state === "unknown" && (
        <div className="mb-2 px-2 py-1.5 border border-panel rounded text-xs text-muted-foreground">
          No live quote to compare this series against, so alignment is unknown — not confirmed.
        </div>
      )}
      {loadError && (
        <div
          className="mb-2 px-2 py-1.5 bg-amber/10 border border-amber/30 rounded text-xs text-amber"
          data-testid="chart-load-error"
        >
          {loadError}
        </div>
      )}
      <div className="relative">
        <div ref={chartRef} className="w-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-panel/80">
            <span className="text-xs text-muted-foreground">Loading...</span>
          </div>
        )}
      </div>
    </div>
  );
}
