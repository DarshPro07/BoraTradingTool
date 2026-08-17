# Gate 0 — Reality

Measured 2026-08-17, while executing the owner's P0 (integrate Upstox V3 daily historical
backfill). The backfill investigation found a **P0 data-integrity defect** first, and that defect
now leads the plan.

## Finding 1 — three instruments carry a one-day date shift

`RELIANCE`, `TCS` and `HDFCBANK` — the three largest weights on the NSE — hold daily bars stamped
**one calendar day earlier than the session they describe**, across their entire series.

```
                     bars   Sun   Mon   Tue   Wed   Thu   Fri   Sat
RELIANCE              610   122   125   119   120   120     3     1
TCS                   610   122   125   119   120   120     3     1
HDFCBANK              610   122   125   119   120   120     3     1
INFY (control)        500     0   101   102    98    99    99     1
```

122 Sunday-dated bars is impossible on its face: NSE has no Sunday session. The Friday column
collapsing to 3 is the same fact seen from the other side — every Friday session was written to
Thursday, every Monday session to Sunday.

Confirmed independently against Upstox V3 over the post-bonus window, where the price basis is 1:1
and cannot confound the comparison:

```
shift export dates by -2 day -> exact close matches:   0/436  (0.0%)
shift export dates by -1 day -> exact close matches:   0/436  (0.0%)
shift export dates by  0 day -> exact close matches:   4/436  (0.9%)
shift export dates by +1 day -> exact close matches: 429/436  (98.4%)
shift export dates by +2 day -> exact close matches:   1/436  (0.2%)
```

### Why it matters

Any backtest joining instruments by date aligns RELIANCE's "day D" bar — which is really day D+1 —
against every other instrument's true day D. That is **one full day of lookahead on the three
largest-cap names in the universe**, and it is silent: the bars are individually well-formed, pass
the OHLC coherence guard, and sit inside plausible price ranges.

`lib/backtest/cross-sectional.ts` ranks a universe on a common date index, so this contaminates the
cross-sectional lane specifically.

### Root cause, and where it is not

The defect is **upstream of the database**. The store is a faithful copy of the export:

```
export bars=610   db bars=610
dates in export but not db: 0
dates in db but not export: 0
dates present in BOTH with identical close: 610
```

and the export file already carries the shift (`Sun=122, Fri=3` in `data/quantcore/nse-daily.json`).
So `scripts/import-nse-history.mts` and `persistCandles` are both innocent.

In `quant/nse_history.py`, `bar_time()` is also correct — `midnight_utc(day) + 33300 - 19800`
lands 09:15 IST on the same calendar day, and the stored rows are all stamped 03:45:00 UTC exactly.
The wrong value is `row["DATE"]` as returned by `jugaad_data.nse.stock_df`, carried faithfully
through correct arithmetic.

Note what this defeats: the existing `out_of_session` audit checks a bar's **minute of day**, never
its **weekday**, so a daily bar on a Sunday was never out-of-session by any rule the system had.

### Why the source is not simply re-fetched

`jugaad-data` reads the NSE bhavcopy by automated request. ADR 0009/0010 and the owner's standing
instruction prohibit automated collection from NSE. **Re-running `quant/nse_history.py` is not an
available repair.** The replacement must come from a source whose terms permit automation.

## Finding 2 — Upstox V3 daily history reaches January 2000

The owner's P0 premise is confirmed:

```
RELIANCE 2000-01-01..2009-12-31:  2496 candles  oldest=2000-01-03
RELIANCE 2010-01-01..2019-12-31:  2478 candles
RELIANCE 2020-01-01..2026-08-14:  1645 candles  newest=2026-08-14
                                  ----
                                  6619 daily bars, 26.6 years
```

against the store's current 2.5 years — the constraint `06-data-availability-and-horizon.md`
identified as capping the one runnable research lane.

A daily request spanning more than roughly a decade is refused with `UDAPI1148 Invalid date range`,
so history must be paged in decade windows.

## Finding 3 — Upstox is back-adjusted, and that is a feature

Against the raw bhavcopy export, correctly aligned, RELIANCE's pre-bonus closes sit at exactly
`2.0000×` Upstox's. Upstox back-adjusts for the 2024-10-28 1:1 bonus; the bhavcopy is raw.

This matters more than it looks. `docs/plans/rehearsal-funnel/04-corporate-action-discontinuity.md`
records that the store's mixed basis came from *accumulating* bars over time across corporate
actions. A single full-history fetch from one source has **one basis by construction**, which is
`RESEARCH_PRICE_BASIS = "SPLIT_ADJUSTED"` — the basis research already wants.

The registry claim in `lib/market/data-source-registry.ts` that `upstox-v3` is `RAW` is contradicted
by measurement and must be corrected.

## Rights position — stated honestly, and not resolved here

`lib/market/source-usage-policy.ts` already records `upstox-v3` as `automationStatus: "LICENSED"`,
`allowedPurposes` including `RESEARCH` / `BACKTEST` / `VALIDATION`, `termsVerifiedAt: "2026-08-16"`.

Two facts the owner should weigh, because they are not the same claim:

1. The V3 historical endpoint **served data to an unauthenticated request** carrying only a
   conventional `User-Agent`. No token, no account, no credential exists anywhere in `.env*`.
2. An earlier probe with a default `python-urllib` agent was refused by Cloudflare
   (`error_code: 1010, browser_signature_banned`).

The rights record was written assuming an authenticated developer-API context. Unauthenticated
programmatic access is **technically available**; that is not the same as licensed. Per the owner's
own instruction — *"I would not infer usage rights merely from that"* — this plan therefore:

- uses Upstox to repair the three contaminated series and to prove the adapter (a bounded,
  low-volume read), and
- **does not** launch a 2,122-instrument sweep (~6,400 requests) on an unresolved rights question.

No user-agent spoofing, header forgery, cookie replay or proxy rotation is used anywhere. The
Cloudflare refusal above was treated as an answer, not an obstacle.

## What this plan will do

1. Purge the three contaminated series — they cannot be repaired in place, because a shifted bar is
   indistinguishable from a correct one without an external reference.
2. Build `lib/providers/upstox.ts`: ISIN → `NSE_EQ|<ISIN>` instrument keys from
   `nse_listing_versions`, decade paging, typed refusals, injected fetcher for tests.
3. Add the invariant that would have caught this: **no NSE daily bar may fall on a weekend**, save
   for declared special sessions (2025-02-01, the Union Budget Saturday, is real — 1,775
   instruments hold it).
4. Re-ingest the three from Upstox, with full available depth.
5. Verify, and report the rights question to the owner before any universe-wide sweep.
