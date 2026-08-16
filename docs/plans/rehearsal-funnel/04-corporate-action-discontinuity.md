# The canonical daily series holds two adjustment bases at once

`REPRODUCED`, 2026-08-16. Found by a data-quality sweep of the 873,567-row daily store while
looking for runnable work under the freeze. This is the repository's characteristic failure mode —
*"two timestamp conventions in one table"* — in a new place, and it bears directly on the two
declared swing families.

## What the store holds

```
RELIANCE, around its 2:1 split of 2024-10-28

  stored   2024-10-21   2686.70      ← pre-split basis
           2024-10-24   2655.70      ← pre-split basis
           2024-10-27   1334.35      ← post-split basis
           2024-10-29   1343.90

  Yahoo today, same dates:  1343.35 · 1338.53 · 1339.80 · 1327.85 · 1334.35
                            ← retroactively adjusted throughout
```

The same discontinuity in HDFCBANK across its 1:2 split of 2025-08-25: `1964.10 → 973.40`.

## Mechanism

Yahoo **retroactively adjusts its entire history** when a corporate action occurs — a series
fetched today shows no jump at all, and the split is reported separately as an event
(`splitRatio: "2:1"`, verified live).

`persistCandles` is idempotent by `(ticker, resolution, time)`: it skips any bar it already holds.
That is exactly right for accumulation and exactly wrong here. A bar stored *before* a corporate
action is never revisited, while every bar stored *after* arrives on the new basis. The series
therefore carries a permanent step at every split — and the intraday accumulator's whole purpose
("keep what the provider's window will drop") means this compounds as the store deepens.

Not a wrong-field bug: the provider reads `indicators.quote[0]`, and Yahoo's `close` is already
split-adjusted. Nothing in the fetch path is incorrect. The defect is that **history is immutable
while the provider's history is not.**

## Blast radius

38 single-day moves exceed ±40% in the daily store. Classified by whether the prior bar had real
volume:

| class | n | meaning |
|---|---|---|
| prior bar zero-volume | 14 | stale placeholder → first real print. An artifact, not a market move |
| real volume both sides | 24 | genuine move or unadjusted corporate action |

Of the 24, the ratios cluster precisely on split ratios — this is not a judgement call:

| ratio | n | instruments |
|---|---|---|
| ~0.10 (1:10) | 3 | SILVERTUC, SIGMA, AQYLON |
| ~0.25 (1:4) | 3 | SHANKARA, GICL, REDTAPE |
| ~0.33 (1:3) | 3 | ABFRL, ALLCARGO, RAYMOND |
| ~0.50 (1:2) | 8 | **HDFCBANK**, **RELIANCE**, SKFINDIA, STAR, QUESS, SHARDAMOTR, PARAS, IRISDOREME |
| other | 7 | JSLL, ROSSELLIND, DCMSRIND, TMPV, MAHAPEXLTD, MASKINVEST, BIOFILCHEM |

India's largest company and its largest private bank are both affected.

## Why this matters to the campaign specifically

Both declared swing families read exactly the corrupted quantity:

- **`fam_qc001_swing_mr`** — "oversold snap-back", entering on a sharp multi-day drop. A 1:2 split
  presents as a **−50% single-day drop with the trend filter still intact**. It is the strongest
  possible trigger for this family, and it is not a market event.
- **`fam_qc001_xsec_momentum`** — ranks the universe by lookback return. An instrument that
  "fell 50%" ranks bottom for the next 20–120 days, and one that "rose 100%" ranks top.

Every derived feature inherits it: `momentum_20d`, `momentum_60d`, `rsi14`, `atr14`, `sma20/50/200`
are all wrong for the lookback window spanning each event.

`sma_cross_20_50` — currently the **only** distinct strategy that has ever returned `would_pass` —
ran over 24 instruments. Whether any carried a discontinuity inside its window is not yet checked;
until it is, that single positive result should not be leaned on.

## Second defect, found alongside

The three instruments holding weekly **Sunday** bars are exactly `HDFCBANK`, `RELIANCE`, `TCS` —
and the RELIANCE comparison above shows their bars are dated one day off Yahoo's labels
(our `2024-10-27`, a Sunday, carries Yahoo's `2024-10-28` value). A second timestamp convention in
the same table, confined to three instruments, presumably from an earlier ingestion path.

Weekend bars are otherwise legitimate and were nearly mis-flagged: Saturday 2025-02-01 holds 1,615
rows because NSE **did** hold a full Union Budget session that day.

## Also measured, and smaller than feared

- Zero-volume "placeholder" bars: 10,097 of 873,567 (**1.16%**). Only 4 instruments meet the
  250-bar swing floor solely because of them, and 6 at the 340-bar floor — real, but not material
  to a gate needing 60–150 ready instruments.
- Structurally impossible bars (open or close outside the bar's own high/low): **36**. The
  accumulator's validator checks `high < low` but never checks that open and close fall inside the
  range, so a fill can occur at a price that never traded within the bar. 0.004% of rows.
- Duplicate `(ticker, time)`: **0**. `high < low`: **0**. Non-positive close: **0**.

## Corrections made during this investigation

- January 1 bars are **not** an anomaly. NSE trades on New Year's Day; the 3,455 bars carry real
  distinct OHLCV with volume. An earlier reading of them as holiday data was wrong.
- Weekend bars are **not** broadly anomalous (see the Budget session above).
- The provider is **not** reading an unadjusted field. Yahoo's `close` is split-adjusted; the
  defect is in the immutability of our stored history, not in the fetch.

## Not fixed — owner decision, and a consequential one

Re-adjusting stored history would rewrite the canonical price store. That changes every dataset
snapshot fingerprint, and a sealed holdout **invalidates on drift** by design. It cannot be done
quietly as a repair.

The options, none taken:

1. **Backfill-and-replace** affected instruments from the provider's current adjusted series, and
   accept re-fingerprinting — with the seal consequences handled deliberately.
2. **Detect and exclude**: refuse to trade across a detected discontinuity, leaving the bars in
   place. Cheaper, keeps fingerprints stable, and costs a small amount of usable history.
3. **Record a corporate-action ledger** (Yahoo reports splits as events) and adjust at read time,
   leaving the store untouched.

Option 3 preserves the store's immutability doctrine, which is why it is listed last rather than
dismissed — it is the most conservative, and also the most work.
