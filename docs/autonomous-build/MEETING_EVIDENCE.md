# Meeting evidence database (Task 0 — owner directive 2026-08-10 22:43)

**This is RECORDED HISTORICAL MARKET EVIDENCE. It is not "demo data" and must never be called
that.** Fixtures are invented; these bars were really fetched from the configured provider and
written to the canonical store with their provenance declared in the audit ledger.

## What exists (built 2026-08-10 22:50, VERIFIED by a real backtest)
- Path: `.tmp/meeting/evidence.sqlite` — created by `scripts/prewarm-meeting-evidence.mts`
  (re-runnable; fetches, never generates).
- **Daily: 2,963 bars** — SBIN 741 · RELIANCE 741 · TCS 741 · NIFTYBEES 740,
  covering **2023-08-11 → 2026-08-10** (3 years).
- **5-minute: 294 bars** — SBIN/RELIANCE/TCS 73 each, NIFTYBEES 75, **one session only**
  (2026-08-10 03:45–09:55 UTC). See LIMITATION below.
- Declared provenance (per resolution, in `audit_events`): `source=provider:yahoo` ·
  `adjustment=adjusted` · `includesDelisted=false`.

## The honest caveat — and why it is a GOOD demo moment
The declaration marks this dataset **UNFIT FOR VALIDATION**, verbatim: *"Prices are
back-adjusted for later corporate actions, so each bar contains information from after it. A
backtest on this measures a series that was never tradable."* Survivorship bias is declared too
(`includesDelisted=false`).

That is correct, and it is worth showing rather than hiding: the system will happily EXPLORE on
this evidence and will refuse to PROMOTE a strategy from it. "MarketPulse knows the difference
between an experiment and proof" is a stronger claim than any equity curve.

## Proven workflow on this database (fresh `next start`, port 3105)
- `POST /api/strategy/author` → 201, `stg_00f05ed4521b7e32` (SMA20/50 crossover, NSE daily,
  10-day time limit, 3% stop, 6% target, 5+7bps costs). Warning surfaced honestly: *"Position
  size of 20% is concentrated."*
- `POST /api/strategy/trades` → 200, **25 trades, 9 net-positive, across 4 instruments**,
  `servedFrom: fresh`, dataset snapshot **`dss_aaa7c28f82d8f30f`** pinned to 2,963 bars.
  First trade: RELIANCE, `time_limit` exit, +0.838%.

## LIMITATION to design the demo around
Intraday history is **one session**, because the provider returns only the current day at 5m for
these symbols. Any intraday/ORB strategy will therefore have almost no history. **Demo the DAILY
strategy** (proven above, 25 trades) and use the 5m bars only if a single-session illustration is
wanted. Deepening intraday history needs the accumulator running across sessions, or a
bhavcopy/dataset import — neither is a tonight task.

## The two-database rule (owner, 22:43)
- **Fresh empty DB** proves installation: boot → NSE bootstrap → 3,314 securities → search
  resolves. ~30 seconds of the demo.
- **This evidence DB** proves the product: research → strategy → backtest → replay → forward →
  paper → Brain. Everything downstream of search.
Never mix them in one claim; say which is which on screen.
