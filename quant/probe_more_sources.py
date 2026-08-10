"""
Depth probe for the second batch of candidate NSE sources.

Same discipline as `probe_nse_depth.py`: a README is a claim about a service, not the service.
Three of the first four candidates promised intraday and delivered nothing, so nothing here is
wired into the app until it has returned bars on this machine.
"""

from __future__ import annotations

import sys
from datetime import datetime


def probe_tvdatafeed(symbol: str = "RELIANCE", exchange: str = "NSE") -> None:
    try:
        from tvDatafeed import Interval, TvDatafeed
    except Exception as exc:  # noqa: BLE001
        print(f"tvdatafeed: UNAVAILABLE ({exc})")
        return

    try:
        # Anonymous session: no credentials, which is the only mode acceptable here.
        tv = TvDatafeed()
        for label, interval, bars in (
            ("1m", Interval.in_1_minute, 5000),
            ("5m", Interval.in_5_minute, 5000),
            ("1d", Interval.in_daily, 5000),
        ):
            try:
                df = tv.get_hist(symbol=symbol, exchange=exchange, interval=interval, n_bars=bars)
                if df is None or len(df) == 0:
                    print(f"tvdatafeed {label}: 0 bars")
                    continue
                span = (df.index[-1] - df.index[0]).days
                print(f"tvdatafeed {label}: {len(df):,} bars | {df.index[0]} -> {df.index[-1]} | span {span}d")
            except Exception as exc:  # noqa: BLE001
                print(f"tvdatafeed {label}: FAILED ({type(exc).__name__}: {str(exc)[:100]})")
    except Exception as exc:  # noqa: BLE001
        print(f"tvdatafeed: session FAILED ({type(exc).__name__}: {str(exc)[:110]})")


def probe_nsepython() -> None:
    try:
        import nsepython
    except Exception as exc:  # noqa: BLE001
        print(f"nsepython: UNAVAILABLE ({exc})")
        return

    # Only intraday/history entry points matter; quote helpers duplicate what the app already has.
    candidates = [name for name in dir(nsepython) if "hist" in name.lower() or "intraday" in name.lower()]
    print(f"nsepython: history-ish entry points -> {candidates[:8] or 'NONE FOUND'}")

    for name in candidates[:3]:
        try:
            fn = getattr(nsepython, name)
            print(f"  {name}: callable={callable(fn)}")
        except Exception as exc:  # noqa: BLE001
            print(f"  {name}: {type(exc).__name__}")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    print(f"probed at {datetime.now().isoformat(timespec='seconds')}")
    if which in ("all", "tv"):
        probe_tvdatafeed()
    if which in ("all", "nse"):
        probe_nsepython()
