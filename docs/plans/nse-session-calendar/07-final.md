# NSE session calendar, and the research universe — verification

2026-08-17. **Verdict: VERIFIED** for the calendar and the universe backfill. Edge discovery has
not started; nothing here is evidence of an edge.

## The defect

The store held **6,435 daily bars for four days the NSE was closed**:

```
2026-01-15  Municipal Corporation Election   1,261 instruments
2026-05-01  Maharashtra Day                  1,236
2026-05-28  Bakri Id / Eid-ul-Adha           1,966
2026-06-26  Muharram                         1,972
```

All four confirmed NSE-closed by the Upstox market-holidays API. These are not stale or imprecise
bars: the exchange did not trade, so no such price exists. A backtest reading them fills at a quote
for a session that never happened, and a return series gains a fabricated observation between two
real ones.

**This corrects a claim made earlier the same day.** `upstox-daily-backfill/07-final.md` called
2026-05-28 and 2026-06-26 "genuine small Upstox gaps" on the grounds that only ~70 instruments were
missing relative to neighbouring sessions. That reasoning was backwards. Upstox was right and the
Yahoo-sourced universe was wrong — ~1,970 instruments each carried a fabricated bar.

## The calendar is generated, not curated

The owner's requirement was a durable exchange-session source rather than "Monday-Friday plus
hand-discovered exceptions". Two sources, each covering what the other cannot:

1. **Derived from price data.** Instruments backfilled from Upstox span 2000-01-03 onward and define
   6,598 real sessions. A weekday on which not one of them traded is a day the exchange was shut.
   This is the only source reaching back to 2000 — the holidays API holds no record before ~2023.
2. **The Upstox market-holidays API**, authoritative for the current year, supplying six 2026
   holidays beyond where price data yet reaches.

`scripts/sync-nse-calendar.mts` regenerates `lib/market/nse-calendar-data.ts`: **362 trading
holidays, 10 weekend sessions, 6,598 sessions**.

### Verification

**Sampled against the API** — 29 dates: 5 confirmed NSE-closed, **0 contradictions**, 24 with no API
record (all pre-2023).

**Consensus never contradicted the API.** For 2026, zero dates where the derived calendar claims a
session and the API says NSE was closed. The only API special sessions absent from consensus were
2026-08-26 and 2026-11-08 — future dates with no price data yet.

**Stability under an 8x larger reference.** Regenerated with **358** reference instruments instead
of 53, the calendar is byte-identical: same 6,598 sessions, same 362 holidays, same 10 weekend
sessions. A calendar that does not move when its evidence base grows sevenfold is not a small-sample
artifact.

## The guard, and why it fails open

`isPlausibleSessionDate` refuses a weekend day unless it is a declared session, and a weekday if it
is a known holiday. It **fails open on dates the calendar does not cover**, deliberately: a guard
refusing everything past its own coverage would silently halt ingestion the first time the calendar
went unsynced, turning a stale lookup table into data loss.

`auditAgainstCalendar` is what makes that safe. It reads what is already stored and names bars that
should never have got in — including bars written before the guard existed, which no write-time
check can reach. `scripts/purge-impossible-bars.mts` reports by default and records the removal in
`audit_events` when applied, so a drop in row count is itself evidence.

Store now audits clean: **0 impossible dates, 0 bars affected.**

## Two mistakes caught during this work

**A weekend predicate that selected Friday.** `getUTCDay()` is Sun=0..Sat=6, so `>= 5` means Friday
and Saturday. The first generator run reported **1,306 weekend sessions**; the true number is 10.
Caught only because the number was absurd on its face — which is the argument for printing counts
rather than trusting a transformation.

**A test asserting an exact reject count.** `catches a whole series stamped one day early` asserted
`rejected === sundays`, which broke once the guard also refused weekday holidays. Rewritten to
assert the fault itself — no Sunday bar survives, real weekday sessions do — so it tests the shift
rather than the calendar's contents.

## Research universe

367 further instruments backfilled, purged and replaced wholesale so each series carries one source
and one basis. 367/367 succeeded, no refusals.

```
                       session start        now
total daily bars           ~955,000     2,304,318
instruments                    2,122         2,122
span                  2024-02-20..     2000-01-03 .. 2026-08-17

>=  250 bars                   1,891         1,888
>=  500 bars                      27           373
>=  750 bars                       0           358
>= 1250 bars                       0           334
>= 2500 bars                       0           265
>= 5000 bars                       0           175
```

**265 instruments now hold 10+ years of daily history**, against zero holding even three years this
morning. That clears the constraint `rehearsal-funnel/06-data-availability-and-horizon.md` named as
capping the one runnable research lane: the defensible envelope was "3-6 month formation with 1-3
month holds"; regime diversity is no longer the binding limit for these names.

## Upstox posture, per the owner

Recorded at the granularity that has to be reasoned about, because one flat "disabled" would be
false in both directions:

```
DAILY HISTORICAL   in use — documented V3 endpoint, needs no token, 420 instruments backfilled
EVERYTHING ELSE    AUTH_REQUIRED — intraday, quotes, streaming, orders need an OAuth app
                   and access token. No owner credential exists.
```

Owner decision 2026-08-17: keep the integration, do not open an account under time pressure. No
account was created, no credential requested, no order path exists.

## Suite

```
typecheck            0 errors
UNIT                 188 files | 2065 passed | 2 skipped
SYSTEM INVARIANTS      7 files |   26 passed   (19 this morning)
MCP                    1 file  |    4 passed
build                Compiled successfully
```

## Unchanged

QC-001 frozen. `19e571a36128b1ef` unchanged. `MARKETPULSE_AUTONOMOUS_TRIALS` off. No NSE scraping.
No broker path — `/api/trade/place` still returns `EXECUTION_ADAPTER_MISSING`.

## What this does not establish

A clean calendar and 10 years of history are preconditions for research, not results of it. No
hypothesis has been tested against the deeper data, and no candidate has positive gross expectancy.
The next work is the hypothesis programme, not more infrastructure.
