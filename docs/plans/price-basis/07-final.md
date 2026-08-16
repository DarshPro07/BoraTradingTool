# Final — the four scientific-integrity fixes

**Verdict: VERIFIED.** Owner directive 2026-08-16: fix the corporate-action discontinuity using
option 3, clean the research universe, make the pinned families executable, and separate freshness
from readiness — before NSE-QC-001 spends its first autonomous trial.

All four were discovered by the quant program itself, with `MARKETPULSE_AUTONOMOUS_TRIALS = 0`. No
permanent statistical budget was spent on split artifacts, test fixtures, unreproducible verdicts
or inexpressible families.

---

## 1. Corporate-action price basis (`f9346b5`)

The canonical daily series held **two adjustment bases at once**: Yahoo retroactively adjusts its
whole history at a split, while `persistCandles` is idempotent by `(ticker, resolution, time)` and
never revisits a stored bar. So bars written before an action kept the old basis forever.

```
RELIANCE  2024-10-24 = 2655.70  beside  2024-10-27 = 1334.35
HDFCBANK  2025-08-24 = 1964.10  beside  2025-08-25 =  973.40
```

**Option 3, as directed.** The store keeps RAW traded prices — execution simulation needs the
numbers that were on the tape, and rewriting bars in place is how the mixture happened. Actions go
to an append-only ledger, and a continuous series is reconstructed at read time into an explicitly
declared basis: `RAW | SPLIT_ADJUSTED | TOTAL_RETURN`. Every snapshot states its basis, the basis
is part of the fingerprint, and `normalizationVersion` is bumped — a reconstructed series is a new
generation, not a revision. Existing snapshots are backfilled to `MIXED_CONTAMINATED` rather than
assumed RAW.

**Verify before accept.** Knowing an action occurred is not authority to apply it. The store is
"raw as of ingestion date", so an instrument fetched entirely after a split is already continuous
and back-adjusting it would halve a correct past. The normalizer measures whether *this* series
steps at that boundary, then applies / skips-as-already-adjusted / flags-ambiguous.

Two production findings changed the implementation mid-flight, both caught by verification rather
than by reasoning:

1. Yahoo dates RELIANCE's split `2024-10-28`; our store steps between `10-24` and `10-27`.
   Measuring at the nominal instant landed inside the post-split half, read 0.996, and skipped
   **all 26** affected instruments. The boundary is now *located* within a 6-day window — and must
   still match the declared ratio.
2. 13 of 26 had **no declared split at all**: Indian issuers use bonus issues, which Yahoo does not
   report for `.NS`. Those are inferred from our own prices only when the step lands near a
   plausible action ratio, under the distinct source `detected:store` so the difference in
   authority stays visible forever.

**The guarantee.** A snapshot now *quarantines* any instrument whose normalized series still steps
unexplained. Research data contains no unexplained discontinuity; withheld instruments are named
and return the moment their seam is explained.

| production, measured | |
|---|---|
| discontinuities detected | 40 (14 stale-junction) |
| provider actions synced | 123 |
| actions inferred (`detected:store`) | 22 |
| non-stale discontinuities removed | **25 of 26** |
| NSE daily snapshot | SPLIT_ADJUSTED, 2,062 instruments, 930,815 bars |
| quarantined | 14 — 13 placeholder junctions + TRIVENI (1.711, matches no plausible ratio) |

Zero holdout definitions existed, so the authorized invalidation cost nothing.

---

## 2. Research universe cleanliness (`db2c4f2`)

14 of 22 specs were Playwright artifacts, and the gate counted two of them toward "ready to spend a
trial". Classify, do not delete — destroying audit history to improve a number is the wrong trade.
Origin is **derived**, so a fixture written tomorrow classifies correctly without anyone setting a
flag: `PRODUCTION_RESEARCH` / `E2E_FIXTURE` / `UNSUPPORTED_MARKET`.

The second category matters as much as the first. `sma_cross_20_50` is a US strategy whose
`would_pass` is dated 2026-08-09 and cannot be reproduced — the store holds no US daily bars. The
cycle preserves it on purpose (`if (outcome.dataMissing) continue`), but that test is by reason
TYPE, never duration, so a permanent absence reads as a transient outage forever. A US strategy is
not waiting for data; it is out of scope. **PERMANENT.**

Measured after: 13 `E2E_FIXTURE`, 6 `UNSUPPORTED_MARKET`, 3 `PRODUCTION_RESEARCH`. The pool went
from "2 ready" to **0 research-eligible** — both were the US pair. That is the truthful number.

---

## 3. Family executability (`40a317f`)

All five declared families held zero specs, and the factory is a breeder that refuses to invent a
family — so none could ever begin.

**The engine could express one of five.** The grammar has comparisons and no arithmetic, and the
fix is not a general-purpose trading language: it is to *derive* the composites the declared
mechanisms already name in words — `high_20d`/`low_20d`, `prior_session_high`/`_low`,
`atr_stretch_sma20`, `return_5d`, `return_5d_in_vol`, `rsi2`. The grammar is untouched.

**Canonical seeds**, one per expressible family, every parameter inside its declared variant space
and near the *centre* of each range rather than its most flattering end — tuning before the search
is the bias the campaign exists to prevent. Each carries a rationale mapping its values back to the
dimensions that permitted them.

`fam_qc001_xsec_momentum` is deliberately un-seeded and says so **in data**: it declares a
universe-level ranking, the DSL is per-instrument by construction, and approximating a rank with an
absolute threshold would be a materially different, much looser strategy. A test asserts every
declared family is either seeded or listed as un-seeded, so a forgotten family cannot masquerade as
a deferred one.

Executed against the real store: ORB 14 instruments/251 trades, RVOL 14/204, intraday MR 14/259,
swing MR **2,065 instruments/578 trades** over the newly split-adjusted daily universe. All four
mean-negative — the honest outcome, now measurable rather than assumed.

---

## 4. Freshness ≠ readiness (`db2c4f2`)

`planUniverseIngestion` filtered on `!researchReady`, so an instrument left the worklist the moment
it had *enough* history and nothing returned it on freshness grounds. Self-reinforcing: the better
covered a name was, the sooner it stopped being updated.

`historyReady` and `freshnessReady` are now separate, with `lastDailyBar` recorded. Staleness is
measured against the **universe's** newest bar, not the wall clock, so holidays and weekends move
the whole market together and never raise a false alarm.

Measured: exactly 3 instruments were history-ready but stale — RELIANCE, HDFCBANK, TCS, the three
largest NSE weights, last bar 2026-08-06 against a universe at 08-14. All three now plan as
"refresh, not backfill".

---

## Evidence

Fail-first on every behavioural change. Full suite **179 files / 1994 passed / 2 skipped / 0
failed**, `tsc --noEmit` clean. Migration `0025_corporate_actions.sql` registered and applied.

## Deliberately not done

- **Cross-sectional IR** for `fam_qc001_xsec_momentum`. It needs a universe-level representation —
  factor per instrument → rank → select top/bottom N → rebalance — which is a different IR, not a
  feature. Named, not approximated.
- **Deleting** fixtures, the 36 impossible bars, or the XBOM orphans. All are audit history;
  classification and quarantine achieve the research goal without destroying it.
- **Re-adjusting stored prices.** The store stays RAW by design.

## Caveat worth carrying forward

The running server must be restarted for any of this to take effect in production — the first
seed verdicts came back `FEATURE_NOT_AVAILABLE` because the process predated the features. Restarted
2026-08-16 12:45Z. A verdict is only ever as current as the process that produced it.
