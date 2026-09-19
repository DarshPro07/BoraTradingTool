# 05 — Slices

| # | Slice | Evidence | Status |
|---|---|---|---|
| 1 | Pure core: `mandates.ts` (frozen FN1/FC1/FC2, hashes, rules, decision dates), `metrics.ts` (drawdown, Sharpe, MinTRL, gates) | 9 tests, including MinTRL against `1 + (z/SR)^2` in a case where it simplifies, and month-end across a weekend | done |
| 2 | Engine: `ledger.ts` (append-only rows in `audit_events`), `run.ts` (decide, execute, mark, kill), `deps.ts` (real bars, sessions, both paper engines) | 4 pass tests with fakes: bootstrap is idempotent; NSE waits for the session while crypto executes at once; a missed date is never decided afterwards; the kill rule goes flat and stops | done |
| 3 | Live: `report.ts`, `scripts/fund.mts run\|report`, the cycle calls `runFundPass` every pass, `/fund` page, Fund under EXECUTE | The first live pass (below). `/fund` driven in a browser: three mandates render, the log expands, and the page raises no console errors | done |
| 4 | Found while verifying: a cycle took 14.8 min against a 10-min lease, so a second driver could run concurrently. `withCycleLease` now renews on a heartbeat, written atomically. The manual `fund.mts run` takes the same lease | The lease renewal test fails without the heartbeat and passes with it; the ledger shows no duplicate rows | done |

## First live pass, 2026-09-19 17:4x IST (Saturday)

| mandate | decision | inputs | execution |
|---|---|---|---|
| FN1 | 2026-09-17 OUT | NIFTYBEES 266.08 < SMA200 278.01 | none: already in cash |
| FC1 | 2026-09-18 HOLD | SOL 112.60 vs 93.65 on 08-21 (+20.2%) | BUY 0.6712 SOL at 111.69, fee 0.02 |
| FC2 | 2026-09-18 HOLD | BTC 80,901 vs 78,335 (+3.3%) | BUY 0.000924 WBTC |

FN1 decided on 09-17 because Yahoo had not yet published Friday's NIFTYBEES bar. The next
refresh brings it, and the next month-end decision is 2026-09-30.

## Setup done once, at the owner's request

NIFTYBEES was added to the watchlist, and an audit row records it. The paper engine's rule is
"buys only on watchlisted names". The autonomous loop never adds names.
