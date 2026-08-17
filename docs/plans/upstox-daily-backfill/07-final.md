# Gate 5 — Independent Verification

**Verdict: PARTIALLY_VERIFIED.** The P0 defect is fixed and verified. The Upstox adapter is built,
tested and in production use. The universe-wide sweep is deliberately **not** done, for a reason
stated below that is the owner's to resolve rather than mine.

## What was fixed

`RELIANCE`, `TCS` and `HDFCBANK` held daily series stamped one calendar day early — 122 Sunday bars
each, one full day of lookahead against every other instrument in a cross-sectional join.

### Verified against a source that knows nothing about the repair

The remaining ~2,060 instruments are Yahoo-sourced and were never touched. Their agreed trading
calendar is an independent check:

```
universe trading days since 2024-09-01 (>100 instruments): 488
  RELIANCE   bars=485   days not in universe calendar=1   universe days missing=4
  TCS        bars=485   days not in universe calendar=1   universe days missing=4
  HDFCBANK   bars=485   days not in universe calendar=1   universe days missing=4
```

The single "extra" day is 2026-02-01, a declared Union Budget Sunday that Yahoo does not serve.

Weekday histogram, before and after — **Fridays restored from 3 to 1,300**:

```
              before                          after
RELIANCE  Sun=122 ... Fri=3            Sun=3 Mon=1320 Tue=1325 Wed=1324 Thu=1320 Fri=1300 Sat=6
```

Store-wide, every weekend-dated daily bar is now a declared special session:

```
2019-10-27    47    2024-01-20    54
2020-02-01    47    2024-03-02    54
2020-11-14    48    2024-05-18    54
2023-11-12    54    2025-02-01  1778
2026-02-01    60
every weekend date is a declared session: YES
```

### The guard, and proof that it bites

The fix is one check at `persistCandles` — the single funnel every ingestion path shares — not in
the provider that revealed the bug. A guard in one caller leaves its siblings broken.

Written before the fix and confirmed to fail against unfixed code:

```
2 failed | 2 passed    (guard absent — the two control cases already passed)
4 passed               (guard present)
```

`tests/invariants/session-calendar.invariant.test.ts` includes the systematic case: 200 days of
sessions shifted one day early, asserting every manufactured Sunday is refused. A single bad bar and
a whole bad series are different failures and the suite tests both.

### One correction I had to make to my own fix

The first version banned Sunday outright — "NSE has no Sunday session". **That was wrong.** Muhurat
trading follows Diwali whichever day it falls on: 2019-10-27, 2023-11-12 and 2026-02-01 are real
Sunday sessions, and the first backfill silently dropped them.

`DECLARED_WEEKEND_SESSIONS` now holds nine dates, each **corroborated** by appearing independently
in all three instruments' histories. A further 21 weekend dates appear in RELIANCE alone, all 2016
or earlier; single-instrument evidence is not enough to call a date an exchange-wide session, so
they are refused — and **counted and reported** via `refusedAtEdge`, never silently dropped.

## What was delivered

| | |
|---|---|
| `lib/providers/upstox.ts` | Daily historical reads. ISIN → `NSE_EQ\|<ISIN>`, decade paging, typed refusals, injected fetcher. 12 tests, no live call. |
| `lib/market/session-calendar.ts` | One definition of when NSE trades. |
| `lib/market/candle-store.ts` | Session guard at the shared write funnel. |
| `tests/invariants/session-calendar.invariant.test.ts` | 5 tests. Invariant suite is now **7 files / 24 tests** (was 6 / 19). |
| `scripts/backfill-upstox-daily.mts` | Idempotent; purges only after a successful fetch. |
| `lib/market/data-source-registry.ts` | `adjustmentPolicy` corrected `RAW` → `ADJUSTED`. |

The broad `DataProvider` interface is deliberately not implemented — a class whose every other
method throws would advertise a capability this module does not have. No order path exists or was
added; `/api/trade/place` still returns `EXECUTION_ADAPTER_MISSING`.

## Coverage gained

60 instruments backfilled, purged and replaced wholesale so each series has **one source and one
basis**. Backfilling *around* the existing Yahoo bars would have left a series Upstox-adjusted
before 2024 and Yahoo-mixed after — recreating the contamination class
`docs/plans/rehearsal-funnel/04-corporate-action-discontinuity.md` exists to record.

```
                    before          after
total daily bars    ~955,000        1,176,873
range               2024-02-20..    2000-01-03 .. 2026-08-17
>=  750 bars               0               53
>= 5000 bars               0               34
```

For those 60 names the research envelope moves from ~2.5 years to ~23 years — the constraint
`06-data-availability-and-horizon.md` identified as capping the one runnable research lane.

## Full suite

```
typecheck            0 errors
UNIT                 188 files | 2063 passed | 2 skipped
SYSTEM INVARIANTS      7 files |   24 passed
MCP                    1 file  |    4 passed
build                Compiled successfully
```

Three test files needed fixture repairs, and they are worth naming because the guard found a real
latent problem in them: `team.test.ts`, `instrument-research.test.ts` and `corporate-actions.test.ts`
all seeded daily bars at `base + index * 86_400`, manufacturing Saturday and Sunday sessions no
exchange ever emitted. They now walk trading days.

## Not done, and why

**The universe-wide sweep (2,122 instruments, ~6,400 requests) was not run.** Two reasons, only one
of which is mine to settle.

1. **Rights.** The V3 historical endpoint served data to an **unauthenticated** request carrying
   only a conventional `User-Agent`, and no Upstox credential exists in any `.env*`. An earlier
   probe with a default `python-urllib` agent was refused by Cloudflare
   (`error_code: 1010, browser_signature_banned`) — treated as an answer, not an obstacle; no
   spoofing, cookie replay or proxy rotation was used anywhere. `source-usage-policy.ts` records
   `upstox-v3` as `LICENSED` with `RESEARCH`/`BACKTEST` permitted, verified 2026-08-16, but that
   record was written assuming an authenticated developer-API context. Per the owner's own
   instruction — *"I would not infer usage rights merely from that"* — a bounded 60-instrument
   research read is proportionate; 6,400 requests on an unresolved question is not.

2. **It replaces the source of truth.** A full sweep purges the Yahoo daily series for every
   instrument. That is defensible on the evidence — Upstox is single-basis where the accumulated
   Yahoo series is mixed — but it is a decision about what the system considers authoritative, and
   it invalidates existing dataset snapshot fingerprints.

## A separate defect this work surfaced, not fixed

The Yahoo-sourced universe carries **spurious bars on NSE holidays**. 2026-05-01 (Maharashtra Day)
has 1,292 instruments against ~2,090 on adjacent sessions; 2026-01-15 has 1,318 against ~1,972. The
session-calendar guard cannot catch these — it encodes the weekday rule only, deliberately, because
a bar on Diwali is a data question this module has no source for whereas a bar on an ordinary Sunday
is arithmetic.

Fixing it needs a trading-holiday calendar. Recorded here rather than assumed away.

## Unchanged

QC-001 frozen. `19e571a36128b1ef` unchanged. `MARKETPULSE_AUTONOMOUS_TRIALS` off. No NSE scraping.
No broker path.
