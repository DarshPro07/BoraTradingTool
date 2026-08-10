"""
Deep NSE history — daily and intraday — via tvdatafeed.

## Why this source, after four others did not deliver

Measured on this machine (`quant/probe_nse_depth.py`, `quant/probe_more_sources.py`):

    tvdatafeed  1m  5,000 bars over   17 days
    tvdatafeed  5m  5,000 bars over   94 days     <- past the live feed's 59-day window
    tvdatafeed  1d  5,000 bars over 7,385 days    <- roughly twenty years
    jugaad-data 1d    621 bars over  900 days
    openchart       returned nothing at every interval
    PKNSETools      documented entry point absent from the package

Twenty years of daily and ninety-four days of five-minute bars is the difference between an
intraday idea that can be explored and one that can be tested. `lib/market/intraday-accumulator.ts`
still matters — it keeps what the window drops, so the store keeps growing past 94 days — but this
gives it a running start instead of starting from zero.

## Two things to be honest about

**Anonymous access.** The library reports `you are using nologin method, data you access may be
limited`. There are no credentials here and none should be added: this is a research read of a
public chart endpoint, and it may be rate-limited, reduced, or withdrawn without notice. Treat an
empty result as the source being unavailable, never as a market with no bars.

**Provenance is not the exchange.** These bars come from a charting vendor's feed, not from the NSE
bhavcopy. For the same symbol the two can disagree on adjustments and on the exact close. The
import declares this, and `data/quantcore/nse-daily.json` from jugaad-data remains the exchange's
own record — the one to prefer where they conflict.

Usage:
    python quant/tv_history.py --symbols RELIANCE,TCS --interval 5m --bars 5000
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parents[1]

# tvdatafeed returns *naive exchange-local* timestamps. For NSE that is IST.
#
# An earlier revision stamped them `timezone.utc` and reasoned that "consistency matters more than
# absolute offset, because every consumer compares these bars only with each other". That was true
# of the JSON file and false of the candle store: these bars land in `price_candles` alongside
# Yahoo bars that *are* true UTC, for the same tickers, and the two then sat 5h30m apart in one
# series. In the 09:15-10:00Z overlap the store's UNIQUE(ticker, resolution, time) constraint
# merged a 09:15 IST bar with a 14:45 IST one and kept whichever was written first.
#
# A bar's timestamp is not an internal identifier. It is a claim about when the trade happened,
# and the rest of the system reads a session clock off it.
EXCHANGE_TZ = ZoneInfo("Asia/Kolkata")

# Interval label -> (tvDatafeed member, the resolution string the candle store uses).
INTERVALS = {
    "1m": ("in_1_minute", "1"),
    "5m": ("in_5_minute", "5"),
    "15m": ("in_15_minute", "15"),
    "1h": ("in_1_hour", "60"),
    "1d": ("in_daily", "D"),
}


def fetch(tv, Interval, symbol: str, interval: str, bars: int) -> list[dict]:
    member, _resolution = INTERVALS[interval]
    frame = tv.get_hist(
        symbol=symbol, exchange="NSE", interval=getattr(Interval, member), n_bars=bars
    )
    if frame is None or len(frame) == 0:
        return []

    candles: list[dict] = []
    for stamp, row in frame.iterrows():
        try:
            # Naive IST -> true UTC epoch. See EXCHANGE_TZ.
            time = int(stamp.replace(tzinfo=EXCHANGE_TZ).timestamp())
            candle = {
                "time": time,
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row.get("volume", 0) or 0),
            }
        except (KeyError, TypeError, ValueError):
            continue

        if any(not math.isfinite(candle[k]) for k in ("open", "high", "low", "close")):
            continue
        if candle["high"] < candle["low"]:
            continue
        candles.append(candle)

    seen: dict[int, dict] = {}
    for candle in candles:
        seen.setdefault(candle["time"], candle)
    return sorted(seen.values(), key=lambda item: item["time"])


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch deep NSE history from tvdatafeed.")
    parser.add_argument("--symbols", default="RELIANCE,TCS,HDFCBANK,ICICIBANK,INFY,ITC")
    parser.add_argument("--interval", default="5m", choices=sorted(INTERVALS))
    parser.add_argument("--bars", type=int, default=5000)
    parser.add_argument("--out", default="")
    args = parser.parse_args()

    try:
        from tvDatafeed import Interval, TvDatafeed
    except Exception as exc:  # noqa: BLE001
        print(f"tvdatafeed is not installed: {exc}", file=sys.stderr)
        return 2

    try:
        tv = TvDatafeed()
    except Exception as exc:  # noqa: BLE001
        print(f"tvdatafeed session could not be established: {exc}", file=sys.stderr)
        return 2

    resolution = INTERVALS[args.interval][1]
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    series: dict[str, list[dict]] = {}
    failures: dict[str, str] = {}

    for symbol in symbols:
        try:
            bars = fetch(tv, Interval, symbol, args.interval, args.bars)
        except Exception as caught:  # noqa: BLE001 - one symbol must not end the run
            failures[symbol] = f"{type(caught).__name__}: {str(caught)[:110]}"
            print(f"  {symbol}: FAILED {failures[symbol]}", file=sys.stderr)
            continue

        if not bars:
            failures[symbol] = "no bars returned (source may be rate-limited)"
            print(f"  {symbol}: no bars", file=sys.stderr)
            continue

        series[f"IN:XNSE:{symbol}"] = bars
        span = (bars[-1]["time"] - bars[0]["time"]) // 86_400
        print(f"  {symbol}: {len(bars)} bars over {span} days")

    out = Path(args.out) if args.out else REPO_ROOT / "data" / "quantcore" / f"nse-tv-{args.interval}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "source": f"TradingView chart feed via tvdatafeed (anonymous), NSE {args.interval}",
                "licence": "Vendor terms apply; anonymous access may be limited or withdrawn.",
                "adjusted": False,
                # Declared so an importer never has to infer it. A file without this key was
                # written by the revision that stamped IST as UTC, and the importer shifts it.
                "timeBasis": "utc",
                "resolution": resolution,
                "fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "series": series,
                "failures": failures,
            },
            indent=2,
        ),
        encoding="utf8",
    )

    total = sum(len(v) for v in series.values())
    print(f"{total} bars across {len(series)} instrument(s) at {args.interval} -> {out}")
    if failures:
        print(f"{len(failures)} symbol(s) failed; recorded in the file rather than dropped silently.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
