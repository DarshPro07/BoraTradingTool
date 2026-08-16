# Gate 0 — Reality: the three recurring intraday fetch failures

Owner instruction: *reconstruct each failure from the durable ledger — do not guess the cause.*

The first finding is that **the reconstruction was impossible**, and that is the defect.

---

## What was asked for, and what the ledger could actually answer

The owner asked for, per failing fetch: instrument id, canonical symbol, provider symbol,
requested interval/start/end, HTTP status, exception code, returned identity, returned bar count,
previous successful fetch, consecutive failure count.

| Field | Available? |
|---|---|
| every field above | **NO — for a failed fetch, no row exists anywhere** |

`OBSERVED`. `lib/market/intraday-accumulator.ts` calls `recordBarIngestion(...)` **inside the
`try`, after `persistCandles`**. A fetch that throws skips it. The `catch` writes
`result.error` to an in-memory field, and `markAccumulated` persists only a prose summary:

```
Intraday accumulation: kept 1146 settled bar(s) the provider's window will drop, 3 fetch(es) failed.
```

Three passes, three failures each — 08-14 10:56 (161 bars), 08-15 07:11 (344), 08-16 03:12 (1,146) —
and in none of them is the failing instrument, resolution, or reason recorded. `cycle_runs` does
not exist. The audit `detail` column is prose, not JSON.

This contradicts the ledger's own documented contract. `drizzle/0023_bar_ingestions.sql` states a
failed identity check "is recorded with returned_bar_count 0 and the reason". **No code path
writes such a row.** The table can express failure; nothing ever asks it to.

---

## Reproduction

`REPRODUCED`. Two independent probes, both replaying the accumulator's exact selection
(`intradayBackfillQueue(NSE_QC_001.families, …, 12, intradayQueueStrata())` — 12 instruments ×
`ACCUMULATED_RESOLUTIONS` `["5","15","60"]` = 36 fetches):

1. **Fetch only, no persistence** — 0 failures of 36.
2. **The real `accumulateIntraday`, against a `VACUUM INTO` snapshot** — 1 failure of 36:

```
FAIL IN:XNSE:ASKAUTOLTD   5m fetched=0 inserted=0  :: The operation was aborted due to timeout
     IN:XNSE:ASKAUTOLTD  15m fetched=1009 inserted=1009
     IN:XNSE:ASKAUTOLTD  60m fetched=283  inserted=283
```

The same instrument succeeded at 15m and 60m **in the same pass**. So the failure is not a
property of the instrument.

## Classification

Against the owner's taxonomy: **none of the six categories fits.** It is not `RANGE_INVALID`,
`PROVIDER_MAPPING`, `TIMEZONE_METADATA_FAILURE`, `EMPTY_VALID_RESPONSE`, `RATE_BLOCK_COOKIE`, or
`TRUE_INSTRUMENT_STATE`. It is a transport timeout — a seventh category the taxonomy did not
anticipate, which is exactly the kind of thing an unrecorded failure hides.

## Root cause

`STATICALLY_CONFIRMED` + `REPRODUCED`. `lib/providers/yahoo.ts:25`:

```ts
const YAHOO_TIMEOUT_MS = 4_000;
```

Its own comment explains the number: *"These calls block a server render, so the timeout is what
the operator waits… a page that hangs for ten seconds per instrument… is the single largest
source of the product feeling slow."*

That reasoning is correct **for a quote**. The budget is then applied unchanged to every request
the provider makes, including the heaviest one in the system: 59 days of 5-minute bars, ~3,000
bars, several hundred KB of JSON. A background accumulation job with nobody waiting on it
inherits a render-latency budget.

The failure lands on 5m and not 15m/60m because 5m is ~3× and ~10× the payload respectively.
That is the whole pattern: **the largest request under the smallest budget.**

## Two defects, not one

| | Defect | Severity |
|---|---|---|
| **D1** | A failed fetch is recorded nowhere. The owner's requested reconstruction is impossible, and the migration's documented contract is unimplemented. | The real one — it hid D1 *and* D2 for three passes |
| **D2** | A render-latency timeout governs a bulk background fetch. | Causes the observed failures |

D1 is primary. Without it, the 3-per-pass count was the only signal, and a count cannot be
diagnosed — which is why this investigation had to reproduce rather than read.

## Deliberately NOT concluded

- Nothing here says these instruments are delisted, unmapped, or unavailable. A timeout is a
  statement about the network, not the instrument.
- No claim that 3 failures per production pass were *all* timeouts. One reproduced as a timeout;
  the other two were never recorded and cannot be reconstructed after the fact. Once D1 is fixed,
  the next pass answers this from evidence instead of inference. `UNKNOWN`, stated as unknown.
