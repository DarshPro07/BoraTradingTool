# Final — the three recurring intraday fetch failures

**Verdict: VERIFIED** (for the defects identified; one question is closed as permanently
unanswerable and is stated as such rather than inferred).

## Objective

Owner instruction, verbatim in intent: take the three exact failing fetches, reconstruct each from
the durable ledger, classify it, root-cause it, write a failing regression test, apply the smallest
fix, keep the cycle test network-free. **Do not guess the cause.** Never map `YFTzMissingError` to
`INSTRUMENT_DELISTED`.

## What was actually found

The reconstruction the instruction asked for **could not be performed**, and that was the finding.

`recordBarIngestion(...)` sat inside the `try` block *after* `persistCandles`, so the only path
that ever wrote to the ingestion ledger was the path that had already succeeded. A failed fetch
wrote an in-memory string and a prose sentence — `"3 fetch(es) failed"` — and nothing else. Across
three production passes (08-14, 08-15, 08-16) no instrument, resolution, status, or reason was
recorded anywhere. `cycle_runs` does not exist; the audit `detail` column is prose.

`drizzle/0023_bar_ingestions.sql` had promised the opposite **in writing** — a failed fetch "is
recorded with returned_bar_count 0 and the reason". The table could express it. Nothing asked it to.

So the failures were reproduced instead: replaying the accumulator's exact selection against a
`VACUUM INTO` snapshot surfaced `IN:XNSE:ASKAUTOLTD 5m :: The operation was aborted due to timeout`,
while **the same instrument's 15m and 60m fetches succeeded in the same pass.** Not an instrument
property. Not a mapping. Not a timezone error. A transport timeout — a seventh category the
six-part taxonomy could not express, which is precisely how it stayed unexplained.

Root cause: `lib/providers/yahoo.ts` set one 4-second budget for every request, and its comment
explains the number was chosen because *"these calls block a server render."* Correct for a quote,
wrong for a 59-day 5-minute backfill returning ~3,000 bars — the largest payload in the system
under the budget sized for the smallest. 5m fails where 15m and 60m do not because it is ~3× and
~10× their size.

## Changes

| File | Change |
|---|---|
| `lib/market/bar-audit.ts` | `FETCH_FAILED` completeness; `FetchFailureReason`; `classifyFetchFailure()`; `failedFetchAudit()` |
| `lib/market/intraday-accumulator.ts` | the `catch` now writes the ledger row it always should have |
| `lib/providers/yahoo.ts` | `candleTimeoutMs()` — the budget follows what the request asks for; bulk intraday gets 30s, render paths keep 4s |

No new migration: `completeness` has no CHECK constraint, so the vocabulary extends in code alone.
No new module, no new abstraction, no schema change.

## Evidence

**Fail-first, as required.** Both regression tests were written before the fix and observed red:

- `writes the failure to the durable ledger…` → `AssertionError: expected null not to be null`
  (11 sibling tests green, so the failure was the assertion and not the harness). The pre-existing
  test named *"records the failure and keeps going"* passed throughout — it asserts the in-memory
  report, which is exactly the gap that let this hide.
- `a bulk intraday backfill is not held to the render budget` → red, plus its sibling.

After the fix: `lib/market` + `lib/learning` + `lib/strategy` + `lib/governance` = **56 files, 670
tests, 0 failures, 31s**; `tsc --noEmit` exit 0.

**Live probe**, real provider, same 12 instruments × 3 resolutions:

| | before | after |
|---|---|---|
| failures | 1 of 36 | **0 of 36** |
| bars kept | 48,630 | **51,621** |

The +2,991 delta is the 5m fetch that previously aborted. Ledger rows for the pass: 21 COMPLETE,
27 SESSION_GAPS, 19 PARTIAL, 9 OUT_OF_SESSION, 0 FETCH_FAILED.

**Network-free cycle test preserved.** The `lib/learning` suite runs inside the 31s above; the
injectable `accumulate` seam is untouched.

## Stated as unknown, not inferred

Only one of the three production failures was reproduced. The other two were never recorded and
**cannot** be reconstructed after the fact — that is the defect, and fixing it does not
retroactively create the evidence. Whether all three were timeouts is `UNKNOWN`. The next
production pass answers it from the ledger instead of from inference, which is the whole point.

One clean 36/36 pass is not proof that timeouts are eliminated; a transient failure cannot be
disproven by one success. The mechanism is confirmed and the delta matches exactly, and recurrence
is now *countable by kind* rather than visible only as a number in a sentence.

## Not done, deliberately

- The timeout was not raised globally. That would trade a background failure for a slow page, and
  the four-second comment is right about which is worse.
- No retry was added. `persistCandles` is idempotent and the accumulator runs every session, so a
  timed-out fetch already self-heals on the next pass. Adding a retry before the ledger could show
  whether one is needed would be building on an assumption.
- No architecture changed, per the 80/20 build freeze. This was a bug exposed by the quant
  program, and it is fixed as one.
