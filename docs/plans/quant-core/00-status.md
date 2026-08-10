# Quant Core — Q1 hardening + Q1b surface — status

All gates complete 2026-08-10 morning. Verdict: **VERIFIED** (see `06-verification.md`).

The owner's seven hardening items, disposition:
1. Sharpe honesty — the field is now `sharpeAnnualizedSerialAdjusted`, computed with Lo (2002)
   GENERAL aggregation over EMPIRICAL autocorrelations (capped at min(q−1, n/4, 60) lags), with
   `serialAdjustment` provenance {estimator, estimatorVersion, lagsUsed, autocorrelations}.
   The AR(1) shortcut is gone; the old `lo_adjusted_sharpe` id no longer exists (tested).
2. `RISK_METRIC_POLICY` (rmp-2026-08-10.1) — versioned, reasoned, carried on every result;
   refusal messages cite it as "a stated policy of this deployment — not a law of statistics".
3. EWMA conventions registered and PROVEN by fixture: λ-decay RiskMetrics recursive,
   adjust=false, first-observation init; EMA's SMA-seed convention likewise.
4. `rolling_correlation` and `vwap` are IN the registry with `requiresContext` (pair /
   sessionStarts) and REFUSE without it — no second source of truth beside the registry.
5. `assumptionFingerprint(id)` → {id, version, content-hash}; every analytics result pins them.
6. Flake root-caused: schema-heavy suite timing out at the 5s default under full-suite CPU load —
   given the 30s ceiling the cycle suites use; 5 consecutive isolated runs green. Residual watch:
   one later full-suite run showed a single transient failure that vanished on rerun before its
   file name was captured — recorded as an open observation, not closed.
7. ADX still DEFERRED honestly: `pip install ta-lib` delivered no importable binary here; policy
   stands — no registration without TA-Lib parity + hand fixtures. Attempt recorded in the module.

Q1b: `/api/quant` + `/api/quant/analytics` + `QuantAnalyticsPanel` on /strategies; desktop
journey green. Two methodology defects found BY the journey and fixed: trade returns were being
annualized at bar frequency (naive Sharpe 1146 — arithmetic right, meaning garbage; now
trades-per-year derived from the experiment's own span), and the journey itself learned that the
engine's honest-refusal branches (non-positive aggregation variance; tails above/below the
policy floor) are first-class outcomes to assert, not failures to avoid.
