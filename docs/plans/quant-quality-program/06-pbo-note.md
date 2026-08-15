# PBO gate note — recorded 2026-08-16, for NSE-QC-002 (the pinned NSE-QC-001 is NOT touched)

Owner observation: the gauntlet's `maxPbo: 0.5` tolerates a very high estimated probability of
backtest overfitting. The PBO/CSCV framework (Bailey, Borwein, López de Prado, Zhu — SSRN
2326253) estimates the probability that the SELECTION PROCESS overfit; lower is better, and the
original work does NOT propose 0.5 as a universal "good strategy" threshold — 0.5 is merely the
coin-flip boundary.

Decision (owner, verbatim intent): **do not change the pinned campaign silently.**

- `NSE-QC-001` keeps `PBO ≤ 0.5` — gather evidence under the pinned rule; every validation's
  actual PBO value is persisted (`validation_results.pbo`) and visible per survivor on the
  scoreboard, so the DISTRIBUTION of observed PBO under the current gate becomes the evidence.
- `NSE-QC-002` (future) may adopt a stricter PBO gate — chosen from that evidence and the
  literature, declared in its own contract, hashed like everything else.
- The `rejectionDiagnosis()` "PBO repeatedly high" signal already reads repeated PBO > 0.5 as
  "the search process is too flexible — NARROW it"; a stricter future gate tightens the same
  reading, it does not replace it.

This preserves the exact research history the registry makes immutable: rules change between
campaigns, never inside one.
