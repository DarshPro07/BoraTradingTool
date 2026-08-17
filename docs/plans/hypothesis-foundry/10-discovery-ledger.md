# The probe discovery ledger — making the search countable

2026-08-17. Built **before** S01, because V01 produced concrete evidence of an uncounted-selection
hole, and that is the class of defect that interrupts the queue.

## The hole

After three probes the system could truthfully report:

```
registeredTrialCount = 0
```

while having inspected **thirteen market statistics on one historical dataset**. Both statements
were true and together they misled. V01 made it concrete: its pre-registered primary missed at
t = 1.74, and a subsidiary cell came in at t = 3.01. With no count, the second number is
indistinguishable from a discovery.

PBO and DSR exist in this system only at the registered-campaign stage, and they answer a different
question — *which strategy survived a declared search*. This answers the one before it: **how many
chances have we already given ourselves on this same data?**

Both numbers now travel together:

```
registeredTrialCount   0
probeDiscoveryLooks   13
probes                 M02, V01, X01
```

## What counts

A statistic counts if it **could cause a new hypothesis to be created**. That is the operative test,
not whether anyone called it a result — and `SECONDARY_PREDECLARED` counts, because declaring in
advance that you will look at seven things does not make looking at seven things free.

`CONTROL` is excluded, and the exclusion is principled rather than convenient: a control's outcome
is engineered to validate the measuring apparatus, and detecting a planted effect gives no licence
to believe a real one. Counting controls would also penalise the discipline that has now caught
three fixture defects.

## The family, adjusted

Holm for family-wise error, BH for ranking leads only. Holm rather than plain Bonferroni because
these statistics are strongly correlated — V01's four cells sit on overlapping cohorts on the same
dates — and treating them as independent is needlessly conservative.

```
statistic                     t      raw p     Holm p      BH q   promotable
V01.cell.negNormal           3.01   0.0026    0.0340    0.0340        NO
V01.normalVolumeSpread      -1.92   0.0549    0.6583    0.1972        NO
X01.highVsCohort             1.81   0.0703    0.7733    0.1972        NO
V01.interaction              1.74   0.0819    0.8186    0.1972        NO
X01.spread                   1.71   0.0873    0.8186    0.1972        NO
M02.longOnly                 1.69   0.0910    0.8186    0.1972        NO
```

Nothing is promotable, and not because of a threshold. **Every look sits on `DISCOVERY_DATA`.**

## A correction to how I stated this yesterday

I wrote that Bonferroni "takes p from 0.0028 to ~0.036 — still under 0.05", which reads as though
surviving the adjustment were the point. It is not. The correct statement:

> A crude 13-look screen would still leave the cell below .05, **and the cell remains post-hoc and
> is therefore not confirmatory evidence.**

An adjusted p-value is not a retroactive pre-registration machine. Reusing one historical
realisation for both discovery and inference contaminates the inference, and no arithmetic applied
afterwards undoes that.

## Two correction policies, deliberately different

**A pre-registered primary is judged against its own predeclared rule.** V01's interaction missed at
t = 1.74 and is rejected on that basis alone. It is *not* penalised further for the diagnostics that
were also computed — the protocol was fixed before the result, which is the whole point of fixing it.

**Discovery among secondary and post-hoc statistics is judged against the programme-level family.**
That is where the thirteen live.

## `canPromote` — a structural rule, not a threshold

```
POST_HOC_DISCOVERY                                    -> never, at any p-value
measured on DISCOVERY_DATA                            -> never
primary not declared in advance                       -> never
predeclared primary on INDEPENDENT_CONFIRMATION_DATA  -> permitted
```

Tested with a deliberately spectacular post-hoc look (t = 12, +900 bps) to confirm the rule does not
bend for a good number.

## H08 — the lead, with its genealogy attached

`negNormal` is preserved as a hypothesis, neither discarded nor promoted:

```
V01
 └── cell.negNormal   +96.0 bps, t = 3.01, n = 261
      └── H08  normal-volume negative-shock reversal
               postHoc: true
               derivedFromProbeId: V01
               parentObservationId: V01:cell.negNormal
               evidenceBasis: PRIOR_MARKETPULSE_RESULT
```

`postHoc: true` is permanent and cannot be cleared by a later good result. Its falsification
condition is written accordingly: **the effect does not appear on data that took no part in its
discovery.** The 358-instrument cohort has already been used to find it and cannot also confirm it.

The economic story is genuine — a sharp fall on ordinary volume is price pressure and reverts; the
same fall on heavy volume is information and does not. That is why it is worth keeping. It is not
why it would be believed.

## The data is becoming a training set

The same 420-name cohort has now taught the Foundry what to try next three times. Introduced as a
first-class status:

```
DISCOVERY_DATA                  this cohort. Generates hypotheses. Cannot confirm them.
INDEPENDENT_CONFIRMATION_DATA   does not yet exist here.
```

Every look recorded so far is `DISCOVERY_DATA`, which is why `canPromote` returns false for all
thirteen. Acquiring genuinely independent evidence — a different period, a different universe, or an
authenticated data basis — is now a precondition for *any* Foundry result reaching validation, and
that is a data problem rather than a statistical one.

## Not built

No PBO engine, no optimiser, no new statistical framework. The search is now countable; that was the
whole scope.

Known debt unchanged: `probe-m02` / `probe-x01` / `probe-v01` duplicate month-end derivation, cohort
selection and leg statistics. And the ledger lives in `audit_events` rather than its own table,
because `lib/db/migrate.ts` is owner-reviewed and no migration was authorised — a dedicated
`probe_discovery_ledger` table is the upgrade path if it grows.

**Next: S01**, with the standing caveat that it shares X01's lottery-preference mechanism, so a
similar result is one finding about lottery demand in NSE equities rather than two independent ones.
