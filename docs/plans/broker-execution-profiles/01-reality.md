# Gate 0 — Reality

## The defect being replaced

**STATICALLY_CONFIRMED.** `INTRADAY_CEILING` in `lib/market/calendar.ts` hardcodes IN=15:20 with a
reason string claiming it is Zerodha's MIS square-off. That figure was never sourced — written from
recollection on 2026-08-09 and presented as fact (already corrected in the published brief).
Consumers: `lib/strategy/dsl.ts` (squareOffAt validation + compile warning),
`lib/backtest/engine.ts` and `lib/backtest/portfolio.ts` (mustFlatten).

## What the broker actually documents

**REPRODUCED — independently fetched 2026-08-09** from support.zerodha.com
(intraday-auto-square-off-timings):

| Segment | Square-off |
|---|---|
| CAS stocks | **3:10 PM** |
| Non-CAS stocks | **3:25 PM** |
| F&O | 3:26 PM |

Plus: auto square-off charge **Rs 50 + 18% GST per order**; RMS "may adjust these timings based on
market volatility"; after the window, "cannot place fresh MIS/CO orders".

So the truth is not one number. It is per-broker, per-segment, per-instrument-class, subject to
change, and carries a fee. A constant cannot express any of that — which is the review's point.

## What already exists and must not be duplicated

- **STATICALLY_CONFIRMED.** `lib/paper/cost-model.ts` is already an effective-dated fee engine:
  FeeSchedule with effectiveFrom/effectiveTo, refusal (NO_SCHEDULE_IN_FORCE) rather than fallback
  for uncovered dates. Gap: no **broker** dimension (rows are implicitly Zerodha).
- **STATICALLY_CONFIRMED.** `lib/paper/fees.ts` carries Zerodha intraday brokerage
  (min(0.03%, Rs 20)/order + GST). Not protected, but feeds the paper engine — left untouched;
  other brokers expressed as deltas in cost-model.
- **STATICALLY_CONFIRMED.** `lib/paper/capital.ts` feasibility is capital-level with a Rs 500
  "one share" proxy and **no leverage anywhere** (grep for margin/leverage: nothing).
- **OBSERVED.** `components/strategy/StrategyAuthor.tsx` renders compile warnings — so a
  profile-derived warning string reaches the Studio UI with no new UI code.

## Constraints

- `lib/trading/capabilities.ts`, `lib/paper/{risk,engine,repository}.ts` protected — not touched.
- `place_order` permanently prohibited; the Kite work is **types + config presence only**.
- Schema validation gains wall-clock dependence (profile as-of now at authoring). Accepted and
  documented: the authoring check is advisory; engines re-resolve per run and are the enforcement.

## Gate question

Understood well enough to design: yes. The design must carry two truths a constant cannot —
provenance (source, date, confidence) and scope limits (CAS stocks excluded, volatility caveat) —
and must refuse when no profile covers a query (BSE intraday today).
