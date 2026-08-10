# System coherence — status

**Slug:** `system-coherence` · **2026-08-09** · **Verdict: VERIFIED**

Three fixes that together turn a loop which could not succeed into one that can.

## Gate 0 — reality, by running it

A full `evolving` cycle was executed against a copy of the owner database. It did a great deal
correctly: refreshed artifacts, introspected memory, ran the promotion ladder, discovered 81
sources, rehearsed 7 candidates, archived 15 forecasts, bred 100 candidates.

And every strategy failed one guard:

```
sma_cross_20_50   eligible=false  failing: tradable_at_capital
f1_gen_* (×5)     eligible=false  failing: ..., tradable_at_capital
```

## The deadlock

`baseDsl` asked `costsForCapital` for **INTRADAY** costs — all ₹1,000 can trade — then omitted
`resolution`, so the schema defaulted it to `"D"`. Candidates were **priced as intraday and shaped
as delivery**. `tradable_at_capital` read the resolution, saw DELIVERY, refused.

Nothing could reach `validated` → nothing reached paper forward → nothing reached owner review →
the trade board was empty **by construction**. No exception, no failing test, no wrong number. Two
modules disagreed about which product the owner trades and neither could see the other.

## Fixed, in three parts

| # | Fix | Evidence |
|---|---|---|
| 1 | Breeder breeds at the resolution the capital can trade, declares a spread, drops `afterDays` (it counts bars) | `tradability.test.ts` ×4, **mutation-proven** |
| 2 | Hypothesis → draft strategy, with refusals recorded | live: 1 authored, 2 refused |
| 3 | Learning metrics: activity separated from progress | wired into every cycle |

Plus a fourth occurrence of the resolution defect, found by fixing the first: the factory screened
5-minute candidates against **daily** bars, and then against a 73-bar provider window. Now reads the
30,000 stored 5-minute bars.

## Result on the live system

- The scheduler ran a cycle on its own and **authored a strategy from a hypothesis** — the first
  non-null `hypothesisId` this registry has ever held.
- 2 of 9 strategies now pass `tradable_at_capital` (was 0 of 8).
- The factory screens 67 intraday candidates on real bars; **0 survive**, which is the honest
  result for randomly bred rules against a real cost floor.

## Verification

typecheck clean · **1,260 unit tests, 98 files, 0 failed** · **66 browser tests, 0 failed** ·
`next build` exit 0 · every probe run against a database **copy**.

## Exact next action

Kite adapter behind forward-evidence promotion (ADR 0006 decision 1), then broker execution
profiles and per-instrument capital feasibility. See `docs/MASTER_SOURCE_OF_TRUTH.md` Part 5.

---

## Addendum — CI determinism, same session

**The problem.** Three browser tests asserted on content that only exists in a populated database.
They passed for months against the owner's database and failed against a fresh one — CI red on a
correct codebase, which is worse than no test because it teaches people to ignore the suite.

**Two different causes, two different fixes:**

1. **The two promotion-ladder tests** needed a strategy to exist. They now **author one through the
   real API** in `beforeAll`, accepting 201 or 409. The state they assert on is state they create,
   so a failure is a real failure of the authoring path rather than a missing fixture.

2. **The cost-and-capital test was simply wrong.** It asserted `"NONE"` and `"below every floor"` —
   the answer for the owner's stated ₹1,000. But the panel reports the **paper account balance**,
   which seeds at ₹1,00,00,000 on a fresh database, so it correctly showed DELIVERY instead. The
   panel was right in both states and even warns about the mismatch itself; the test was asserting
   a state-dependent number as though it were an invariant.

   It now asserts the **capital ladder** — ₹1,000 refused, ₹2,000 INTRADAY, 0.106% round trip —
   which is pure arithmetic from the published fee schedule and therefore identical on every
   database.

**Result: 66 browser tests pass on a genuinely fresh database.** CI is green for the first time.
