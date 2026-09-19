# 07 — Final

## Objective

A fund that runs itself on NSE and crypto, and records every strategy, decision, trade and metric,
so it can earn the owner's trust on paper before any real money is proposed.

## Delivered

| Commit | What |
|---|---|
| `8deb4c9` | Mandates FN1/FC1/FC2 (frozen, hash-pinned); the pass decide → execute → mark → kill; append-only ledger; metrics, MinTRL, gates T1–T3; `/fund`; `scripts/fund.mts`; the cycle runs it every 15 min; lease heartbeat |
| (this) | The six review fixes in `06-verification.md` |

Built on the same day's `11e9e56` (DP fee), `f8a9710` (₹25k paper), `d3662ec` (intraday) and
`956d794` (Solana paper book).

## Live state (first pass, 2026-09-19)

| Mandate | Position | Decided on |
|---|---|---|
| FN1 | OUT (cash ₹3,750) | NIFTYBEES 266.08 < SMA200 278.01 |
| FC1 | HOLD, 0.6712 SOL | 28-day return +20.2% |
| FC2 | HOLD, 0.000924 WBTC | +3.3% |

All gates are shut, as they must be on day one. T3 needs years at realistic Sharpe ratios.

## Not verified

- `next build` (machine out of memory; see 06).
- A month-end NSE decision and next-session fill in production. The first is 2026-09-30, filled on
  2026-10-01.
- A weekly crypto decision in production. The first is the Sunday 2026-09-20 bar, decided after
  00:00 UTC Monday.

## Rollback

Revert the fund commits. The ledger rows remain, because the log is append-only, and a reverted
build stops writing them.

## Verdict: PARTIALLY_VERIFIED

Unit, integration, invariant and browser checks pass, and the independent review's findings are
fixed and regression-tested. Production has so far run one bootstrap pass. The scheduled
decisions and a full build are still to be observed.
