"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A completed trade drawn against the canonical store's bars (master item 14).
 *
 * Entry and exit are markers on the exact bars the experiment traded; dashed price lines carry
 * the fill prices. The bars come from `/api/research-data/bars` — the store only, never the live
 * provider — so what this chart shows can be reconciled bar-for-bar against the experiment's
 * snapshot. If the store cannot serve the window, the chart says so and shows nothing.
 */

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  ticker: string;
  /** DSL resolution — "D" | "1m" | "5m" | "15m". */
  resolution: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  exitReason: string;
}

const RESOLUTION_SECONDS: Record<string, number> = { D: 86_400, "1m": 60, "5m": 300, "15m": 900 };
/** Context on each side of the trade, in bars. Enough to see the setup, small enough to load fast. */
const CONTEXT_BARS = 40;

export function TradeChart({ ticker, resolution, entryTime, exitTime, entryPrice, exitPrice, exitReason }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const seconds = RESOLUTION_SECONDS[resolution];
    if (!seconds) {
      setError(`Resolution ${resolution} has no chartable bar length.`);
      return;
    }
    const from = entryTime - CONTEXT_BARS * seconds;
    const to = exitTime + CONTEXT_BARS * seconds;
    let cancelled = false;
    fetch(`/api/research-data/bars?ticker=${encodeURIComponent(ticker)}&resolution=${resolution}&from=${from}&to=${to}`)
      .then(async (response) => {
        const body = (await response.json()) as { bars?: Bar[]; note?: string; error?: string; message?: string };
        if (cancelled) return;
        if (!response.ok || !Array.isArray(body.bars)) {
          setError(body.message ?? "Bars unavailable.");
          return;
        }
        setBars(body.bars);
        setNote(body.note ?? "");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Request failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, resolution, entryTime, exitTime]);

  useEffect(() => {
    if (!containerRef.current || !bars || bars.length === 0) return;
    let cleanup: (() => void) | undefined;

    import("lightweight-charts").then((lc) => {
      if (!containerRef.current) return;

      const chart = lc.createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: 220,
        layout: { background: { color: "#111111" }, textColor: "#a0a0a0", fontSize: 10 },
        grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
        rightPriceScale: { borderColor: "#2a2a2a" },
        timeScale: { borderColor: "#2a2a2a", timeVisible: resolution !== "D" },
      });

      type LCTime = import("lightweight-charts").Time;
      const series = chart.addSeries(lc.CandlestickSeries, {
        upColor: "#00cc66",
        downColor: "#cc3333",
        borderUpColor: "#00cc66",
        borderDownColor: "#cc3333",
        wickUpColor: "#00cc66",
        wickDownColor: "#cc3333",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(bars.map((bar) => ({ time: bar.time as LCTime, open: bar.open, high: bar.high, low: bar.low, close: bar.close })));

      // The trade itself: markers on the entry and exit bars, price lines at the fills.
      lc.createSeriesMarkers(series, [
        { time: entryTime as LCTime, position: "belowBar", color: "#00cc66", shape: "arrowUp", text: `ENTRY ${entryPrice.toFixed(2)}` },
        { time: exitTime as LCTime, position: "aboveBar", color: "#ffcc00", shape: "arrowDown", text: `EXIT ${exitPrice.toFixed(2)} (${exitReason})` },
      ]);
      series.createPriceLine({ price: entryPrice, color: "#00cc66", lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: "entry" });
      series.createPriceLine({ price: exitPrice, color: "#ffcc00", lineWidth: 1, lineStyle: lc.LineStyle.Dashed, axisLabelVisible: true, title: "exit" });

      chart.timeScale().fitContent();

      const ro = new ResizeObserver(() => {
        if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
      });
      ro.observe(containerRef.current);
      cleanup = () => {
        ro.disconnect();
        chart.remove();
      };
    });

    return () => cleanup?.();
  }, [bars, entryTime, exitTime, entryPrice, exitPrice, exitReason, resolution]);

  if (error) {
    return (
      <div className="text-[10px] text-amber" data-testid="trade-chart-error">
        CHART UNAVAILABLE — {error}
      </div>
    );
  }
  if (!bars) return <div className="text-[10px] text-muted-foreground">Loading bars from the canonical store…</div>;
  if (bars.length === 0) {
    return (
      <div className="text-[10px] text-amber" data-testid="trade-chart-error">
        CHART UNAVAILABLE — {note}
      </div>
    );
  }
  return (
    <div data-testid="trade-chart">
      <div ref={containerRef} className="w-full" />
      <div className="text-[9px] text-muted-foreground mt-1">{note}</div>
    </div>
  );
}
