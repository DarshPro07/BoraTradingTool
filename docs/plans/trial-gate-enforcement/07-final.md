# The registered campaign gate governed nothing

**Verdict: VERIFIED.** P0 scientific-governance defect, found 2026-08-17 while checking whether
AUTO work alone could flip the campaign.

## The defect

`evaluateTrialActivation` — the pre-registered gate, hashed `19e571a36128b1ef`, whose criteria were
declared and argued over before any strategy result was seen — was imported by exactly **one** file:

```
app/brain/page.tsx:125    ← a display page
```

The authorization path that spends a permanent statistical trial never consulted it:

```
withAuthorizedTrial → authorizeTrial → owner switch → candidate eligible → freeze → budget
```

So this belief was false of the code:

> `MARKETPULSE_AUTONOMOUS_TRIALS = 0` **until** the frozen gate evaluator says every criterion is
> satisfied

The env switch was not a second lock in front of the gate. It was the **only** lock. Setting it to
`1` would have authorized spending at 18/60 breadth, 38% sector classification, and **zero**
strategies in the ready pool.

Each layer was individually correct — the gate computed honestly, the governor guarded honestly —
and the wire between them was never run. That is this repository's signature failure mode, named in
`CLAUDE.md`: *a declared resolution ignored in three separate layers*. Unit tests could not see it,
because the gap was **between** units.

The safety model was **safe by configuration** rather than **safe by invariant**. For a permanent
statistical budget, only the second is acceptable.

## The fix

One fail-closed wire at the choke point, `authorizeTrial` — not in a caller, for the same reason
the OHLC coherence check belongs in `persistCandles`: an upstream check is bypassed by the next
caller somebody adds.

```
1. owner switch enabled
2. registered campaign gate satisfied     ← added
3. candidate eligible
4. research freeze allows
5. budget available
```

Fails closed on every path: unsatisfied criteria, an evaluator that throws, a reading that cannot
be obtained, or a criteria hash that no longer matches `19e571a36128b1ef`. **A failure to establish
permission never becomes permission.**

The gate is evaluated **live inside the authorization path**, never passed in. A green verdict
computed on `/brain` minutes ago must not authorize a spend now — the display can be stale, and the
spend is permanent.

## Campaign-wide, not per-family — deliberately

`criteriaSatisfied` is conjunctive across all five families, as registered. Switching to per-family
activation would be a material change to the experimental protocol *after* registration and *after*
seed results were observed — reintroducing exactly the multiplicity problem the declaration exists
to control. If intraday-only research later becomes worth running while swing waits on licensed
classification, that is a **new campaign declaration** with its own hash, budget and accounting —
not a reinterpretation of QC-001.

## Three facts, named as three facts

`switchOn` encouraged the misreading that cost this defect. Now:

```
ownerSwitchEnabled     is the owner's switch set?          (only that)
criteriaSatisfied      do the registered criteria hold?
effectiveActivation    both — and this is what authorizes
```

`/brain` renders all three separately rather than one ON/OFF.

## Evidence

Fail-first: all eight gate tests red before the change. The seven-row matrix holds —

| owner switch | campaign gate | result |
|---|---|---|
| OFF | false | DENY |
| OFF | true | DENY (`LANE_DISABLED`) |
| **ON** | **false** | **DENY (`CAMPAIGN_GATE_BLOCKED`)** |
| ON | evaluator throws | DENY |
| ON | hash mismatch | DENY |
| ON | reading unobtainable | DENY |
| ON | true | proceeds to the pre-existing checks |

Plus a **composition** test through the real entry point — `runAutonomousGauntlet` with the real
switch set and the real live gate — asserting zero trials, zero reservations, zero selection
trials. And a source-level guard that no production caller supplies its own `gate`, because the
seam that makes the branches testable is also the seam that could reopen the hole, and it would
look reasonable in review.

Full suite **182 files / 2035 passed / 2 skipped / 0 failed**, tsc clean. Verified against live
production state: owner switch ON → `CAMPAIGN_GATE_BLOCKED`.

## Unchanged, on instruction

Campaign criteria · the 80% classification floor · the family conjunction · the campaign hash ·
trial budgets · DSR/PBO thresholds · the family list. Only the declaration already registered was
made to actually govern.
