# NSE-QC-001 declares five families; the engine can express one

`OBSERVED` + `STATICALLY_CONFIRMED`, 2026-08-16. This is why the pool criterion cannot move, and
it is not something autonomous work can close.

## The campaign has no members

```sql
SELECT f.id, COUNT(i.strategy_spec_id)
  FROM strategy_families f
  LEFT JOIN strategy_identity i ON i.strategy_family_id = f.id
 WHERE f.research_campaign_id = 'camp_nse_qc_001' GROUP BY 1;
```

| family | seeded specs |
|---|---|
| `fam_qc001_orb` | **0** |
| `fam_qc001_rvol_breakout` | **0** |
| `fam_qc001_intraday_mr` | **0** |
| `fam_qc001_xsec_momentum` | **0** |
| `fam_qc001_swing_mr` | **0** |

The campaign was registered and hash-pinned (`19e571a36128b1ef`) with five declared families and
**zero candidate strategies in any of them**. `orb_nse_5m` and `first_hour_momentum_nse_5m` exist
as specs but belong to no campaign family — both predate the campaign (authored 2026-08-09).

## Why it cannot self-correct

`lib/factory/generation.ts` is a **breeder, not an author**. It selects a parent, mutates within
the parent's declared variant dimensions, and has the descendant inherit the parent's family. It
explicitly refuses to invent a family for a machine-generated rule — a spec without one is
"permanently unvalidatable" in its own words, and inventing one is called out as exactly how a
search box gets silently widened.

Sound design. Its consequence is that **a declared family with no seed can never receive one
autonomously.** All five are in that state.

## Why the families have no seeds: the engine cannot express four of them

The DSL grammar is complete and small — `{feature, op, value}`, `{compare:[a,b], op}`,
`{crossover:[a,b]}`, `{crossunder:[a,b]}`, `all`, `any`, `not`, with comparisons limited to
`gt|gte|lt|lte`. **There is no arithmetic, no aggregation, and no cross-sectional operator.**
Derivable features are the 20 in `DERIVABLE_FEATURES`.

| family | declared mechanism needs | available? |
|---|---|---|
| **ORB** | `opening_range_high/low`, `minutes_since_open`, `rvol`, ATR stop or opposite-range exit | **YES** — and `orb_nse_5m` already implements it faithfully |
| **RVOL breakout** | reference level = prior-day high/low, or N-bar extreme (N 20–78) | **NO** — no such feature exists |
| **Intraday MR** | stretch of 1.5–3.0 **ATR units** from VWAP/SMA, or RSI(2–5) | **NO** — no arithmetic to scale a distance by ATR; no VWAP; only `rsi14` |
| **Swing x-sec momentum** | *rank* the universe, hold top N | **NO** — the DSL is per-instrument; there is no ranking operator |
| **Swing MR** | 3–10 day return vs 20-day volatility, or RSI(2–5) | **NO** — no short-window return, no realized-volatility feature, only `rsi14` |

Each "NO" is a faithfulness judgement, not a difficulty judgement. Loose substitutes exist —
`compare:[close, sma20] lt` is *a* mean-reversion condition — but dropping the ATR-magnitude
requirement makes a materially different and much looser strategy than the one declared. The
campaign contract is pinned precisely so that cannot happen quietly.

## The fork — an owner decision, not an autonomous one

1. **Extend the feature registry** so the declared families become implementable. The missing
   quantities are all pure functions of bars already held: prior-session high/low, N-bar extreme,
   k-day return, realized volatility over N, `rsi(k)` for k other than 14, and a session VWAP.
   Cross-sectional ranking is different in kind — it needs a universe-level operator the DSL does
   not have, so `fam_qc001_xsec_momentum` would remain blocked even after the other four.
2. **Amend the campaign contract** to declare families this engine can express. A legitimate,
   recorded act — `lib/strategy/campaign-registry.ts` refuses a silently changed re-registration,
   which is the mechanism working as intended.

Not taken autonomously either way. Both change what the campaign tests, and placing specs into a
hash-pinned family is a permanent research act (family membership and trial counts do not
un-spend).

## One thing that is nearly free, and still not taken

`orb_nse_5m` already implements `fam_qc001_orb`'s declared mechanism — close beyond the session's
first-15-minute high, `rvol > 1.2` (inside the declared 1.0–3.0×), entry confined to the first 90
minutes (well inside the 14:30 cutoff). Placing it in the family would give the campaign its first
member without authoring anything.

Deliberately not done: it was authored a week before the campaign was declared, so placing it
retro-fits a pre-existing strategy into a pre-registered family. That direction is *conservative*
for the multiple-testing denominator (it adds a trial rather than hiding one), but it is still a
judgement about what the campaign was searching when it was declared — and it is already
`would_fail` at rehearsal, so nothing is lost by waiting for the owner's call.
