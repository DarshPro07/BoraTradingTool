"""
NSE daily history from the exchange's own bhavcopy, via jugaad-data.

## Why this exists beside the live Yahoo feed

The app already fetches NSE daily bars through Yahoo. Yahoo is a redistributor: it maps Indian
symbols onto its own tickers, applies its own adjustment policy, and occasionally disagrees with
the exchange on a split or a bonus date. `jugaad-data` reads the **NSE bhavcopy** — the exchange's
own end-of-day publication — so the bars are the ones the exchange printed.

## What was measured, not assumed

Four free NSE sources were probed from this machine on 2026-08-09 (`quant/probe_nse_depth.py`).
Only this one returned data:

    jugaad-data   621 daily bars, 2024-02-20 -> 2026-08-06   WORKS
    openchart     "No data received from the API" at every interval and window
    PKNSETools    documented entry point absent from the installed package
    Indian-Stock-Market-API   snapshots only, and a third-party host wrapping Yahoo

The README of each promised more than it delivered here. Depth is a property of the running
service, not of its documentation, so it is measured before anything is built on it.

## What this deliberately does not do

It does not fetch intraday. jugaad-data serves the bhavcopy, which is end-of-day by construction;
the intraday problem is solved separately by `lib/market/intraday-accumulator.ts`, which keeps the
live feed's sliding window before it slides. Pretending otherwise would put a daily bar into an
intraday series, which nothing downstream could detect.

Usage:
    python quant/nse_history.py --symbols RELIANCE,TCS --days 900 --out data/quantcore/nse-daily.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# NSE trades 09:15-15:30 IST. A daily bar is stamped at the session open in UTC so it lands on the
# same instant the rest of the system uses for an Indian daily bar.
IST_OFFSET_SECONDS = 5 * 3600 + 1800
SESSION_OPEN_SECONDS = 9 * 3600 + 15 * 60


def bar_time(day: date) -> int:
    """Unix seconds at the Indian session open for a calendar day."""
    midnight_utc = datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp()
    return int(midnight_utc + SESSION_OPEN_SECONDS - IST_OFFSET_SECONDS)


def fetch(symbol: str, days: int) -> list[dict]:
    from jugaad_data.nse import stock_df

    to_date = date.today()
    from_date = to_date - timedelta(days=days)
    frame = stock_df(symbol=symbol, from_date=from_date, to_date=to_date, series="EQ")
    if frame is None or len(frame) == 0:
        return []

    bars: list[dict] = []
    for row in frame.to_dict("records"):
        try:
            stamp = row["DATE"]
            day = stamp.date() if hasattr(stamp, "date") else datetime.fromisoformat(str(stamp)).date()
            candle = {
                "time": bar_time(day),
                "open": float(row["OPEN"]),
                "high": float(row["HIGH"]),
                "low": float(row["LOW"]),
                "close": float(row["CLOSE"]),
                "volume": float(row["VOLUME"]),
            }
        except (KeyError, TypeError, ValueError):
            # A row the exchange published in a shape this mapper does not understand is dropped,
            # never guessed at. A fabricated bar is indistinguishable from a real one downstream.
            continue

        if any(not math.isfinite(candle[key]) for key in ("open", "high", "low", "close")):
            continue
        if candle["high"] < candle["low"]:
            continue
        bars.append(candle)

    # Oldest first, and de-duplicated: the bhavcopy occasionally repeats a session across requests.
    seen: dict[int, dict] = {}
    for candle in bars:
        seen.setdefault(candle["time"], candle)
    return sorted(seen.values(), key=lambda item: item["time"])


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch NSE daily history from the bhavcopy.")
    parser.add_argument("--symbols", default="RELIANCE,TCS,HDFCBANK,ICICIBANK,INFY,ITC")
    parser.add_argument("--days", type=int, default=900)
    parser.add_argument("--out", default=str(REPO_ROOT / "data" / "quantcore" / "nse-daily.json"))
    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    series: dict[str, list[dict]] = {}
    failures: dict[str, str] = {}

    for symbol in symbols:
        try:
            bars = fetch(symbol, args.days)
        except Exception as caught:  # noqa: BLE001 - one symbol must not end the run
            failures[symbol] = f"{type(caught).__name__}: {str(caught)[:120]}"
            print(f"  {symbol}: FAILED {failures[symbol]}", file=sys.stderr)
            continue

        if not bars:
            failures[symbol] = "no bars returned"
            print(f"  {symbol}: no bars", file=sys.stderr)
            continue

        # The instrument id the app uses, so the importer needs no symbol table of its own.
        series[f"IN:XNSE:{symbol}"] = bars
        span = (bars[-1]["time"] - bars[0]["time"]) // 86_400
        print(f"  {symbol}: {len(bars)} bars over {span} days")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "source": "NSE bhavcopy via jugaad-data",
                "licence": "NSE terms apply to the underlying data; jugaad-data is MIT",
                "adjusted": False,
                "resolution": "D",
                "fetchedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "series": series,
                "failures": failures,
            },
            indent=2,
        ),
        encoding="utf8",
    )

    total = sum(len(v) for v in series.values())
    print(f"{total} bars across {len(series)} instrument(s) -> {out}")
    if failures:
        print(f"{len(failures)} symbol(s) failed; they are recorded in the file, not dropped silently.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
