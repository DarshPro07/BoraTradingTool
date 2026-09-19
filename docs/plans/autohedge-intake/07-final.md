# AutoHedge intake — final

## Objective

"Use AutoHedge and connect it fully." Owner scope: paper now, Kite later, Claude Code as the
brain, NSE and Solana.

## Delivered

| Commit | What |
|---|---|
| `11e9e56` | Paper delivery sells now pay the ₹15.93 DP charge. Before, paper was about 10% a trade optimistic at ₹1,000 |
| `cd2ff0f` | The desk: `trading-desk` skill, `lib/paper/desk.ts` sizing, `scripts/desk.mts` paper execution |

## Evidence

- The DP regression failed first: paper sell fee ₹1.04 against a real ₹16.97.
- Desk sizing: 5 unit cases.
- Live desk pass on the real store (2026-09-19, market closed):
  - watchlist NSE names: TCS only;
  - quant-core board `QUANT_CORE_UNAVAILABLE`, reported, not zero-filled;
  - TCS snapshot timed out twice, so no analysis could be recorded; the desk stopped correctly;
  - TCS (₹2,105) and RELIANCE (₹1,226.4): `UNAFFORDABLE` against the ₹150 cap;
  - a ₹9.50 stock: `COST_EXCEEDS_EDGE`, cost 11.4% of the position;
  - analysis #1 recorded (abstain) through `marketpulse_record_analysis`;
  - a refused `buy` left `paper_orders` at 38.
- Independent verifier (fresh context): 444 tests pass across `lib/paper lib/market
  tests/invariants`. No safety claim was disproved.

## Not verified

- **A SIZED trade reaching `placePaperOrder` during market hours.** No candidate can be SIZED at
  ₹1,000, and the market was closed.
- **Kite: designed only.** It needs owner changes to protected capability and governance files,
  plus credentials, daily login and SEBI checks.
- **Solana: designed only, as the next slice.**

## Honest outcome for the owner's goal

At ₹1,000, with a 15% cap and delivery costs, the desk refuses nearly every trade, and it should.
To produce a paper record worth reading, the owner can:
- raise the paper capital and the owner capital;
- raise the position cap;
- or have intraday product support added to the paper engine. That engine file is protected, so
  the owner makes that change.

None of these creates an edge. They only let the desk be measured.

## Rollback

`git revert cd2ff0f 11e9e56`. There is no schema or data change.

## Verdict: PARTIALLY_VERIFIED
