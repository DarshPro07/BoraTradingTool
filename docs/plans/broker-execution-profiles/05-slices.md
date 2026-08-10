# Gate 4 — Vertical slices

| # | Slice | Verified by | State |
|---|---|---|---|
| 1 | Profile table + resolution + provenance line | 13 unit tests: broker/product/date dependence, fail-closed BSE, calendar agreement, weak-source-needs-assumptions | complete |
| 2 | DSL + both engines consume the profile; constant deleted | 239 strategy/backtest/broker tests; **mutation check** (hardcoded 920 reintroduced → 2 tests failed, incl. parity; restored) | complete |
| 3 | Fee engine broker axis (Zerodha rows explicit, Upstox delta added) | existing 98 paper tests unchanged + broker-dependence tests: diverge below the cap (16.52 delta at 10k), converge at 200k, Upstox delivery refused | complete |
| 4 | Capital/margin feasibility engine | 13 tests: RELIANCE vs ITC opposite verdicts at Rs 1,000; leverage as labelled bound; margin honestly null; 2023 refused; DP charge flips delivery verdict | complete |
| 5 | Kite contract boundary | types + env-presence check only; no implementation, no integration claim | complete |
| 6 | Surfacing: authoring warnings carry provenance; gauntlet API returns executionAssumptions; e2e asserts broker/15:25/fetched-date/non-CAS | 66 browser tests on a fresh database | complete |

## What live verification changed mid-build

The WebFetch of Zerodha's own support page showed the truth is not one number: **non-CAS 15:25,
CAS 15:10, F&O 15:26**, Rs 50+GST per forced order, timings adjustable on volatile days, fresh MIS
orders blocked after the window. Both the old constant (15:20) and the review's summary (15:25)
were incomplete — the CAS split and the volatility caveat only fit in a record with an assumptions
list, which is the strongest argument for the design this feature shipped.
