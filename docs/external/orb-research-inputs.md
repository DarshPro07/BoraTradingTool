# ORB published research — hypothesis INPUTS for NSE-QC-001, never proof

**Owner rule (2026-08-15): published results generate hypotheses; they are not evidence of edge
in this system.** Different universe, different market structure, different costs, different
validation discipline. Anything sourced here must still survive NSE-QC-001's own pinned funnel
(rehearsal → cost-aware gauntlet with DSR/PBO over counted trials → sealed holdout → forward →
paper) before it is called anything at all.

## Recorded inputs (owner-supplied 2026-08-15)

1. **Optimizing Intraday Breakout Strategies on the NSE: A Block-Based Performance Evaluation**
   (Wang, Gangwar) — SSRN 5198458. Explores 5/15/30-minute opening-range-breakout variants on
   NSE data (Tata Motors). Why it is only an input: single-instrument evidence, block-based
   evaluation ≠ this system's walk-forward/DSR/PBO discipline, and its cost handling is not this
   deployment's effective-dated stack. Informs `fam_qc001_orb`'s range-window dimension.

2. **A Profitable Day Trading Strategy For The U.S. Equity Market** (Zarattini, Barbon, Aziz) —
   SSRN 4729284. Strong US ORB results. Why it is only an input: produced on US market
   structure and universe; explicitly NOT transferable evidence for India. Informs the
   confirmation/stop dimensions of the same family.

3. **The Deflated Sharpe Ratio** (Bailey, López de Prado) — SSRN 2460551 / 2465675 — and
   **The Probability of Backtest Overfitting** (Bailey, Borwein, López de Prado, Zhu) — SSRN
   2326253. The statistical basis for the gauntlet's DSR-over-counted-trials and PBO/CSCV
   gates: the NUMBER OF ATTEMPTS is what deflates the winner, which is why `selection_trials`
   counts every configuration ever tested.

4. **scikit-learn TimeSeriesSplit** documentation — the reference for why validation splits are
   chronological with purge gaps, never shuffled CV. This repo's walk-forward and sealed-holdout
   (purge + embargo) already implement the stricter form.

Values and claims above were recorded 2026-08-15 from owner-supplied links; re-read the papers
before extending any family's declaration on their basis.
