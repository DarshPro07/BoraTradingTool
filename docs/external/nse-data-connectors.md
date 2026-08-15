# NSE data connectors — the approved roster, with probe evidence (2026-08-16)

Owner ruling: multiple connectors behind ONE `DataConnector` contract
(`lib/market/data-connector.ts`), with health detection, provenance, quarantine, fallback and
deduplication. Nothing here is wired into strategies directly — everything flows
Provider → Connector → quarantine/validation → canonical store → dataset snapshot.

## Tiering (owner, 2026-08-16)

| Tier | Source | Role | Status here |
|---|---|---|---|
| 0 | NSE official archives | canonical IDENTITY (the security master's five lists) | LIVE (the sync) |
| 1 | Upstox Historical V3 | historical minute candles from Jan 2022 (intervals 1–300m) | AVAILABLE, needs owner credentials — not configured |
| 1 | **Yahoo chart API** | daily history (5y) AND historical intraday within trailing retention (~60d for 5m) | **LIVE — the working path** |
| 2 | `marketcalls/openchart` (MIT) | historical NSE/NFO 1m–1M | **BROKEN as probed tonight** (see log) — health-gated, re-probe |
| 2 | `jugaad-py/jugaad-data` | daily/bhavcopy-class NSE history, caching | next daily fallback candidate; not wired yet |
| 2 | `DrChandrakant/NSEazy` | public NSE OHLCV wrappers | fallback/research candidate; older project |
| 2* | `aeron7/nsepython` | quotes, option chain, events, holidays | **capability-limited**: historical equity endpoint 404s (its issue #74, Jan 2026) and an index endpoint returns non-JSON (#78, Jul 2026) — NEVER a historical-equity source |
| 3 | `aeron7/nifty-banknifty-intraday-data` (offline 1m archive), `rajgmishra/nifty50-15min-ohlc` (15m + engineered features, Zerodha-sourced) | RESEARCH-ONLY datasets | may train/challenge models; **must never silently become validation or holdout truth** — classified at import via the dataset-source machinery |
| ref | `aaryansinha16/AI-trader` | ARCHITECTURE/QUANT REFERENCE (TimescaleDB, tick replay) — uses paid TrueData | study, never a data provider |

## Probe log (all from this machine, 2026-08-16 ~01:15 IST)

- **openchart 0.2.0** (pip-installed into the configured Python312; MIT confirmed from
  dist-info): `search()` returns the SAME default 20-row index list for every query and segment
  (five payload shapes probed — the endpoint ignores the query), and
  `historical()`/`historical_direct()` return `{"status":true,"data":[]}` for every variant
  probed including NIFTY 50 daily with its known scripcode 26000, seconds and millisecond
  epochs. The charting API is REACHABLE but its contract has drifted from the library.
  Additional hazard for future wiring: the library's "use first search result" fallback would
  silently fetch NIFTY 50 for an unmatched equity query — any future openchart connector MUST
  refuse non-exact symbol matches at quarantine.
- **Yahoo (the fix instead of a new dependency)**: raw probe `range=55d&interval=5m` for TCS.NS
  → 4,125 bars / 55 sessions; through the repo's own `getYahooCandles` after the window fix →
  2,903 bars / 39 sessions in one call. This also exposed and fixed a REAL defect: the intraday
  accumulator has always requested 59-day windows, but the provider's range shortcut built
  `range=1d` regardless, silently truncating 59 days to one — which is why intraday coverage
  grew one session per day. The shortcut now keys on the requested window (≤5 days = live range
  semantics, unchanged; wider = period-based backfill).

## Standing rules

- Health probes gate every Tier-2 connector; a broken capability is disabled and reported
  (`RESOLVABLE_VIA_ALTERNATIVE`), never retried blindly.
- Tier-3 datasets are imported only with an explicit research-only classification.
- Rate limits are respected by construction: the accumulator runs once a session over a bounded
  instrument set (a past rate-limiting incident is recorded in `lib/learning/cycle.ts`); any
  widening of that set is a deliberate decision, not a loop.
- Values and issue links recorded from owner-supplied sources 2026-08-16; re-verify before
  wiring a new connector.
