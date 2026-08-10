# Gate 1 — Product

## User problem

Backtest results depend on when the broker force-closes a position, what a trade costs, and what
the capital can actually buy — and all three were either hardcoded, broker-blind, or ignored
leverage. The owner cannot see which execution assumptions produced a number, and a wrong constant
(15:20, unsourced) silently shaped every intraday result.

## Desired outcome

Every simulated intraday exit, cost and feasibility answer traces to an **effective-dated, sourced
broker profile**. Unknown broker/product/date combinations produce a refusal or an explicitly
marked assumption — never a silent default. The UI shows the assumptions a backtest actually used.

## Success evidence

1. Same query, different broker → different cutoff (Zerodha 15:25 vs Upstox 15:20), from data.
2. Same query, a date outside every window → refusal.
3. BSE intraday → refusal naming the missing profile (today it silently used 15:20).
4. Engine exits move from the unsourced 15:20 to the sourced 15:25; a mutation check proves the
   tests can see the change.
5. Feasibility is per-instrument: RELIANCE (~Rs 2,985) and ITC (~Rs 400) give different answers.
6. Leverage appears only as a labelled upper bound; the tradable verdict stays cash-based.
7. The Studio shows the broker, deadline, source and confidence in the compile warnings.

## Failure conditions

A default cutoff applied when no profile matches; leverage silently assumed available; profile
fields present but unread by the engines; provenance strings asserting more confidence than the
source supports.

## Non-goals

No live Kite integration (credentials via local env only, later). No per-instrument CAS or margin
data (explicitly out of scope, stated on the profile). No change to protected risk-kernel files.
