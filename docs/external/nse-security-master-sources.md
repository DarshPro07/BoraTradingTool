# Official NSE Security-Master Sources

Verified reachable on 2026-08-10.

| Class | Fixed official source | Observed rows | Import classification |
|---|---|---:|---|
| Main-board equities | `https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv` | 2,410 | `EQUITY` |
| SME equities | `https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv` | 562 | `EQUITY`, with original SME series retained |
| Exchange-traded funds | `https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv` | 342 | `ETF` |

The combined clean-database bootstrap persisted 3,314 current listings. `NIFTYBEES` resolved as `IN:XNSE:NIFTYBEES`, ISIN `INF204KB14I2`, type `ETF`.

REIT and InvIT trading-unit source files are still UNKNOWN. They must not be inferred from names or inserted as equities. Add them only after a fixed official source and parser contract are independently verified.
