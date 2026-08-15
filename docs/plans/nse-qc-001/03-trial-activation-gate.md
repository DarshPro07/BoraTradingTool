# NSE-QC-001 — the trial-activation gate, PRE-REGISTERED 2026-08-16

**Declared before any family was tested.** Every intraday family sat at 6 qualified instruments
and no trial had been spent when these criteria were fixed. Deciding when to start spending
permanent statistical trials *after* seeing which families look promising is the same selection
bias the campaign apparatus exists to prevent — moved one level up — so the rule is registered
like a trial protocol, before enrolment.

Declaration: `lib/strategy/trial-activation.ts` · criteria hash **`5254d36998262f10`**, pinned
literally in `trial-activation.test.ts`. (It was `0f86755bbbebcaec` when first registered at
03:48; the liquidity-bucket VERSION and floors joined the pin at 04:50 — see the addendum. No
threshold changed.) Changing a threshold changes the hash and fails that
test by design: loosening the bar is permitted, but only as a deliberate, visible act.

## The criteria (conjunctive — every one must hold)

| Criterion | Threshold | Why this number |
|---|---|---|
| Family-ready breadth, INTRADAY families | 60 qualified instruments | The smallest cross-section over which a per-instrument intraday edge can be told from a handful of lucky names; ~3% of the main board rather than a round percentage. |
| Family-ready breadth, DAILY families | 150 | Higher because cross-sectional momentum RANKS its universe — a ranking over a thin universe measures the universe, not the signal. |
| Liquidity representation | all 3 buckets | An edge existing only in the most liquid tercile is a different claim from a market-wide one and must not masquerade as one. Buckets are fixed rupee floors on median daily turnover (≥₹10cr HIGH, ≥₹1cr MEDIUM, below LOW) — quantiles of the ready set would always yield three buckets and could never fail. |
| Sector representation | 5 distinct sectors | So no single sector's regime can carry a family's result. |
| READY_FOR_GAUNTLET pool | 10 strategies | So the first trials are drawn from a real candidate set rather than whatever compiled first. |

Deliberately NOT "coverage > 10% → ON": a smaller but diverse sample is scientifically more
useful than a larger concentrated one.

## Fails closed

A criterion the system cannot MEASURE is **not satisfied**. Sector classification WAS exactly
that when this gate was written, and the gate reported `UNMEASURABLE` and stayed shut rather than
passing on absence — which is what made the gap visible and got it closed the same night (see the
addendum: sector is now measured, at 4 of 5). Inventing a sector map to make a gate pass would
have been the most expensive kind of convenience; refusing instead is what produced the fix.

The owner's switch and the criteria are **independent facts**, and the decision says which is
which — including the honest "ON BY SWITCH while the pre-registered criteria are NOT satisfied"
case, which the gate will state rather than hide.

## First live evaluation (production copy, 2026-08-16 03:48 IST)

```
GATE: OFF — the pre-registered criteria are not satisfied.
criteria hash 0f86755bbbebcaec · readyForGauntlet 2

· pool: 2 strategy(ies) standing ready to spend a trial; 10 required
· Opening Range Breakout — family-ready breadth: 6 qualified; 60 required
· Opening Range Breakout — liquidity representation: 1 of 3 buckets represented (HIGH)
· Opening Range Breakout — sector representation: UNMEASURABLE (no classification ingested)
  … same for RVOL and intraday MR
```

**The gate earned its place on day one.** The liquidity criterion revealed that all six
ORB-ready instruments sit in the HIGH bucket alone — precisely the concentration bias that makes
a coverage percentage a misleading trigger. A naive "10% coverage" rule would eventually have
opened on a sample that measures large-cap liquidity rather than the hypothesis.

Family-ready at the same moment, with the quality ladder applied: ORB / RVOL / intraday MR **6**
each (162 blocked on intraday), swing momentum **148**, swing MR **152** — the swing families
grew from 77/78 six hours earlier as the daily planner worked.

## The quality ladder behind those numbers

DATA PRESENT → SESSION COMPLETE → QUALITY PASS → FAMILY READY. Sessions now count only when they
hold ≥80% of a full day's bars, and the families that trade the open (ORB, RVOL) additionally
require a populated opening window — a session missing its first bars is useless to them however
complete the rest of the day is. Session dates come from the market's own timezone via
`sessionStamps`, not a UTC slice that would misfile every afternoon bar.

Measured effect on the live data: of the 14 main-board instruments holding any 5m data, **all 14
have complete sessions and populated opening windows** — the accumulated data is clean, so the
ladder cost nothing here while guaranteeing that future half-empty days cannot inflate a count.

## Verification

Units **171 files / 1887 passed / 2 skipped / 0 failed**; tsc silent; live e2e green on a fresh
DB and a production copy; the pinned hash asserted literally. `MARKETPULSE_AUTONOMOUS_TRIALS`
remains 0.

## Addendum 2026-08-16 04:50 — sector became measurable, and the planner stopped reinforcing the bias

**Sector ingestion (the one code gap the gate exposed).** NSE's index constituent CSVs carry an
`Industry` column beside the ISIN — probed and recorded in
`docs/external/nse-sector-classification.md`. Ingested by `lib/market/sector-classification.ts`
into an effective-dated ledger with full provenance (source, sourceUrl, sourceEffectiveDate,
fetchedAt, identityVerification), matched by ISIN, superseding rather than overwriting when NSE
reclassifies. Live against a production copy: **750 of 752 classified ISINs matched, 22 distinct
sectors, zero symbol mismatches**, 2 ISINs unknown to the master correctly not written.

Effect on the gate — sector moved from UNMEASURABLE to a real near-miss:

```
Opening Range Breakout: ready 6/60
   NOT_SATISFIED  family-ready breadth: 6 qualified; 60 required
   NOT_SATISFIED  liquidity representation: 1 of 3 buckets (HIGH)
   NOT_SATISFIED  sector representation: 4 of 5 sectors represented
```

Migration `0024` is STAGED (`pending-migration/`), not registered — `lib/db/migrate.ts` is
owner-protected and the two existing tests correctly refuse an unregistered file in `drizzle/`.
Its tests apply the staged SQL to their own temporary database, which proves the SQL as well.
Two owner-side steps in the README; the ingestion script then runs in one command.

**The planner is now representativeness-aware.** Closest-to-ready alone was reinforcing exactly
the bias the gate found: every ready instrument sat in HIGH. The queue now prefers
UNDER-REPRESENTED strata (liquidity first, then sector) before proximity — deterministic, tested
both ways, and drawing its stratum definitions from the gate's own functions so planner and gate
can never chase different targets. The behaviour change is visible in the live pick:

| | Before | After |
|---|---|---|
| Next 6 | BAJFINANCE, BHARTIARTL, HINDUNILVR, LT, SBIN, 20MICRONS | AETHER, ALKYLAMINE, ALOKINDS, ANUP, AARTIDRUGS, ADVENZYMES |
| Strata | all HIGH liquidity mega-caps | all MEDIUM · Chemicals / Textiles / Capital Goods / Healthcare |

**Liquidity buckets are now versioned** (`liquidity-buckets-2026-08-16`) and the version plus the
floors are part of the pinned criteria hash — "3 of 3 buckets" means nothing without the floors
that define a bucket, and liquidity regimes drift. Criteria hash is therefore
**`5254d36998262f10`** (was `0f86755bbbebcaec` before the bucket definitions joined the pin).
No threshold was changed.

**A performance regression this leg caused, found and mostly fixed.** /brain's server render went
4.6s → 11s because the new read-models scanned the candle table in JavaScript. Counting, median
turnover and 5-minute session geometry now run as SQL aggregates (IST is a fixed UTC+5:30 with no
DST, so local day and minute are exact arithmetic for this market). Measured per function
afterwards: universeCoverage 263ms, medianTurnover 489ms, evaluateTrialActivation 714ms total,
familyReadiness 3ms — **~1.1s for everything this leg added**. The page's remaining ~7s is
pre-existing panels growing with the data and is NOT this leg's; it is recorded as a tracked item
rather than silently accepted, and the acceptance suite serves a prebuilt build where the page is
far faster.
