# India equity trading costs — sourced, effective-dated

**Rule (owner, 2026-08-15): every cost figure in this system is an effective-dated, sourced
record, never a permanently hard-coded constant.** NSE revises transaction charges periodically
and statutory levies change with budgets; a strategy judged against stale charges is judged
against a fictional market. The broker-profile machinery (`lib/*/broker profiles` — dated,
sourced records; engines refuse when no profile covers a query) is the in-repo home for these
numbers; this document records the external sources and the values as of the recorded date.

## The net-P&L identity (the only P&L that counts)

```
Gross P&L
− Brokerage
− STT (Securities Transaction Tax)
− Exchange transaction charges
− GST (on brokerage + transaction charges)
− SEBI turnover fees
− Stamp duty
− Spread
− Slippage
− Market impact estimate
= NET P&L
```

A ₹20 gross edge that costs ₹18 is not a ₹20 strategy. Every gate in the validation funnel
judges NET, and the cost model itself must state which effective-dated profile produced it.

## Values as recorded 2026-08-15 (owner-supplied, with sources)

| Component | Value (recorded 2026-08-15) | Notes |
|---|---|---|
| STT, equity intraday | **0.025% on the SELL side** | Statutory; delivery differs (0.1% both sides historically) |
| Brokerage (Zerodha, intraday) | **0.03% or ₹20 per executed order, whichever is lower** | Broker-specific; delivery equity is ₹0 at this broker |
| Exchange transaction charges | NSE-published, revised periodically | Never hard-code; see NSE levies page |
| GST | 18% on (brokerage + transaction charges + SEBI fees) | Statutory |
| SEBI turnover fees | ₹10 per crore (0.0001%) | Statutory, revisable |
| Stamp duty | Buy-side, state-scheduled (0.003% intraday / 0.015% delivery buy) | Statutory, revisable |
| Spread / slippage / impact | NOT a levy — must be estimated per instrument liquidity | The model states its estimation basis or refuses |

Sources (owner-supplied 2026-08-15):
- Zerodha STT/charges: https://support.zerodha.com/category/account-opening/resident-individual/ri-charges/articles/how-is-the-securities-transaction-tax-stt-calculated
- NSE statutory levies (SEBI turnover fees, STT, other): https://www.nseindia.com/static/invest/first-time-investor-sebi-turnover-fees-stt-other-levies

## Standing cautions

- These values were recorded on 2026-08-15 and MUST be re-verified against the sources before
  being trusted in a new cost profile; the table is a record of what was true when written, not
  live truth.
- Spread/slippage/impact dominate at small notional for illiquid names — a cost model that
  carries only the statutory stack is optimistic by construction and must say so.
- The capital floors in this repo (₹2,000/₹23,000) are internal policy constants, not market
  rules (see memory: capital floors), and leverage is not modelled at all.
