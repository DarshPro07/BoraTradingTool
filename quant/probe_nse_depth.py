"""
How much intraday history does each free NSE source actually serve?

The single number that decides whether an intraday strategy can be validated here. Every source
below is advertised as free and unauthenticated; none documents its depth, and the depth is what
matters. Measured rather than assumed.
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta


def probe_openchart(symbol: str = "RELIANCE", interval: str = "1m", days: int = 400) -> None:
    try:
        from openchart import NSEData
    except Exception as exc:  # noqa: BLE001
        print(f"openchart: UNAVAILABLE ({exc})")
        return

    try:
        # Signature verified by introspection rather than taken from the README, which documents
        # an `exchange=` argument and a `download()` call this build does not have.
        nse = NSEData()
        end = datetime.now()
        start = end - timedelta(days=days)
        df = nse.historical(symbol=symbol, segment="EQ", start=start, end=end, interval=interval)
        if df is None or len(df) == 0:
            print(f"openchart {interval}: 0 bars (asked {days}d)")
            return
        first, last = df.index[0], df.index[-1]
        span = (last - first).days
        print(f"openchart {interval}: {len(df):,} bars | {first} -> {last} | span {span}d (asked {days}d)")
    except Exception as exc:  # noqa: BLE001
        print(f"openchart {interval}: FAILED ({type(exc).__name__}: {str(exc)[:120]})")


def probe_jugaad(symbol: str = "RELIANCE", days: int = 900) -> None:
    try:
        from datetime import date

        from jugaad_data.nse import stock_df
    except Exception as exc:  # noqa: BLE001
        print(f"jugaad-data: UNAVAILABLE ({exc})")
        return

    try:
        to_date = date.today()
        from_date = to_date - timedelta(days=days)
        df = stock_df(symbol=symbol, from_date=from_date, to_date=to_date, series="EQ")
        if df is None or len(df) == 0:
            print(f"jugaad-data daily: 0 bars (asked {days}d)")
            return
        print(
            f"jugaad-data daily: {len(df):,} bars | {df['DATE'].min()} -> {df['DATE'].max()} "
            f"(asked {days}d)"
        )
    except Exception as exc:  # noqa: BLE001
        print(f"jugaad-data daily: FAILED ({type(exc).__name__}: {str(exc)[:120]})")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "openchart"):
        for interval in ("1m", "5m", "1d"):
            probe_openchart(interval=interval)
    if which in ("all", "jugaad"):
        probe_jugaad()
