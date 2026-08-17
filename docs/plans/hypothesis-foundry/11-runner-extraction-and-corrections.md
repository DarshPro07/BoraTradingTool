# Shared probe runner — and two defects it found

2026-08-17. The extraction was meant to be behaviour-preserving housekeeping before S01. It was not:
it found two real bugs, and one of them moves V01's headline number across the significance
threshold. That makes this the most carefully-worded document in the programme.

## What was extracted

`lib/research/cross-sectional-runner.ts` owns the point-in-time universe, liquidity cohort, cohort
benchmark, portfolio accounting, costs, decision units, HAC/bootstrap inference and era splitting.
A probe supplies only what makes it a different hypothesis: formation features, the
ranking/classification rule, its predeclared legs, its statistic definitions and its primary.

The rule that is now structural rather than remembered:

> Every cross-sectional leg is evaluated relative to the same eligible cohort on the same rebalance
> date. `cohortReturn` is handed to every statistic definition, so a probe cannot benchmark
> differently by omission.

## Verification: M02 is byte-for-byte identical

The first extraction attempt **changed M02 from 221 to 226 rebalances**. Cause: the runner handed
features a compacted window whose first element was the oldest *available* bar, where the originals
required the bar at that *exact* session. A nearer substitute silently measures a shorter formation
window than the contract declares. Fixed by indexing the window by session (`back(n)`), after which
M02 reproduces exactly — same rebalance count, same statistics, same era table, same verdict.

That check is the reason the two defects below are trustworthy rather than suspicious. The
machinery provably reproduces one probe unchanged; where it does not reproduce the others, the
difference is attributable.

## Defect 1 — X01 did not honour its own declared liquidity window

X01's contract declares `liquidityLookbackSessions: 20`. Its code collected traded value inside the
**formation** loop instead — 22 sessions — so the conditioning variable was measured over a window
the contract never specified. M02 and V01 used the declared window. Three copies hid the
disagreement.

```
             before    after
spread        78.0      83.4  bps/month
HAC t         1.71      1.87
highVsCohort  49.5      54.8
```

**X01's verdict is unchanged: REJECTED.** t = 1.87 is still below 2, the sign still flips across
eras, and net is still ~7 bps against 76 bps of friction.

## Defect 2 — V01 paired each bar's volume with a different bar's close

```js
const traded = baseline.map((v, i) => v * (byDate.get(allDates[baselineStart + i]!)?.close ?? 0));
```

`baseline` is compacted — only present bars are pushed — but it is indexed against the *i-th
session*. Whenever a bar is missing, one bar's volume multiplies another bar's close, and the
missing session contributes a traded value of **0**, dragging the median down. The liquidity cohort
was therefore selected on a corrupted proxy.

```
                      before    after
interaction            114.1     127.0  bps/month
HAC t                   1.74      2.12
normalVolumeSpread    -130.4    -142.1
cell.negNormal          96.0      98.3   (t 3.01 -> 3.10)
eras                +62/+68/+103/+198   ->   +156/+67/+96/+202
```

## The uncomfortable part, stated plainly

**V01's pre-registered primary now clears its own predeclared rule**: |t| = 2.12 > 2, clears
friction, sign-stable in all four eras. Under the policy that a primary is judged against its own
rule and not penalised for diagnostics, that is a pass.

It is still **not a finding**, for reasons that have nothing to do with the arithmetic:

1. **This is the second execution of the contract, by an analyst who had already seen the first.**
   The decision to extract the runner was itself downstream of V01's output. A clean pre-registered
   test is executed once; this was executed twice with a code change in between.
2. **The fix moved the number in the favourable direction.** The defect is objectively verifiable by
   inspection and the fix is correct regardless of which way it pushed — but "we changed the code
   and it started passing" is the shape of motivated reasoning even when it isn't, and the only
   honest response is more scrutiny, not less.
3. **It sits on `DISCOVERY_DATA`.** `canPromote` returns false structurally, whatever the t.
4. **Against the discovery family it is nowhere near significant.** The ledger now holds 18 looks:

```
V01r.cell.negNormal.corrected      t  3.10   raw .0019   Holm .0348
V01.cell.negNormal                 t  3.01   raw .0026   Holm .0444
V01r.normalVolumeSpread.corrected  t -2.21   raw .0271   Holm .4337
V01r.interaction.corrected         t  2.12   raw .0340   Holm .5101
```

Holm-adjusted, V01's primary sits at **p = 0.51**.

### Disposition

V01 moves from `REJECTED` to **`INCONCLUSIVE — HIGH-PRIORITY LEAD, REQUIRES INDEPENDENT
CONFIRMATION`**. Not "survives". The probe script now prints that distinction rather than letting
"survives the kill check" stand alone.

Nothing about this licenses testing V01 again on the same cohort and calling the result
confirmation. The 358-name universe has now taught the Foundry what to try next four times.

## The ledger did its job

This is the first episode the discovery ledger was built for, and it worked: the re-execution was
recorded as **additional looks** rather than replacing the originals, because a second run informed
by the first is more search, not a correction of the search. The counter went 13 → 18.

```
registeredTrialCount    0
probeDiscoveryLooks    18
probes                  M02, V01, V01r, X01, X01r
```

Had the ledger not existed, the corrected V01 would have read as "t = 2.12, pre-registered, passes"
with no record that the same data had been searched seventeen other ways first.

## Records corrected

`08-x01-result.md` and `09-v01-result.md` state the pre-correction numbers. Both are superseded by
this document rather than rewritten, so the original figures and the reason they changed both remain
readable — a corrected number with no trace of the correction is its own kind of dishonesty.

## Still open

- Probe-level multiple testing now has a ledger but no automatic gate: nothing *stops* a probe
  running, it is only counted.
- H08's provenance needs the immutable-`postHocOrigin` / mutable-`confirmationStatus` split.
- No independent confirmation data exists, which is the binding constraint on every result here.
