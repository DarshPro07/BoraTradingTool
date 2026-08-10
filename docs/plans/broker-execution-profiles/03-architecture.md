# Gate 2 — Architecture

```
lib/broker/execution-profile.ts     NEW: the dated, sourced profile table + resolution
        |
        +-- lib/strategy/dsl.ts     squareOffAt validation + provenance warning
        +-- lib/backtest/engine.ts  mustFlatten deadline; EXECUTION_PROFILE_UNAVAILABLE refusal
        +-- lib/backtest/portfolio.ts  identical, parity-tested
        +-- lib/paper/cost-model.ts broker axis added (existing rows = ZERODHA)
        +-- lib/paper/feasibility.ts NEW: per-instrument capital/margin verdicts
lib/broker/kite-contract.ts         NEW: types + env-presence check only
```

## Key decisions

- **Data-as-code**, frozen records in TS: reviewable in git, testable, no migration dependency.
  Lookup functions accept an injectable records array so date-window logic is provable without
  fabricating historical broker claims.
- **Resolution returns a union** `{available, profile} | {available: false, reason}` — engines
  cannot read a deadline without handling absence. Fail-closed by type shape.
- **Owner context**: `OWNER_BROKER = "ZERODHA"`; DSL market + resolution map to (broker, exchange,
  segment, product). BSE has no profile → unavailable → engine refuses (previously silent 15:20).
- **US profile** exists with confidence `assumed` and the assumption stated ("no broker RMS
  modelled; exchange close is the deadline") — marked, not silent.
- **Upstox MIS profile** included from the owner's review citations, confidence
  `owner_review_reported` — a real second broker, honest provenance, making broker-dependence a
  data-backed test rather than a fixture.
- **Fees**: other brokers priced as a brokerage **delta** against the Zerodha figures embedded in
  `fees.ts`, keeping the risk-kernel-adjacent per-leg pricer untouched.
- **Feasibility verdict is cash-based**; leverage (SEBI-capped 5x MIS) is a labelled bound,
  because per-stock VaR+ELM margins are not held — missing is not zero.
- **Engines resolve the profile once per run** using the first bar's date and refuse if the last
  bar falls under a different window (`PROFILE_WINDOW_MISMATCH`) — no silent mid-run policy change.

## Risks

- CAS stocks square off at 15:10; the universe is assumed non-CAS. Stated on the profile's
  assumptions list and surfaced in the compile warning.
- Authoring-time validation uses "now"; engines re-resolve at run time. Divergence across a future
  policy-version boundary is inherent to broker rules changing; documented rather than hidden.
