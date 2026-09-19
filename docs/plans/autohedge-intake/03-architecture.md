# AutoHedge intake — product and architecture

Owner decisions (2026-09-19): execution **paper + NSE broker (Kite)**, brain **Claude Code session
only**, markets **NSE and Solana**. The owner's goal: "to earn".

## Built: the NSE paper desk (slice 1)

```
Claude Code session  --(skill: .claude/skills/trading-desk)-->
  Director   you: candidates from the watchlist + quant-core board, stance, levels
  Quant      marketpulse_get_research_snapshot: computed indicators, provenance, hash
  Sentiment  you: WebSearch public news, cited, tagged known/inferred
  Record     marketpulse_record_analysis: rejects inference-only stances
  Risk       scripts/desk.mts size   -> lib/paper/desk.ts sizeDeskTrade (pure, tested)
  Execution  scripts/desk.mts buy/sell -> placePaperOrder -> risk kernel (protected, final)
```

Nothing duplicates an existing capability. Quant is the existing snapshot, Record is the existing
MCP tool, and Execution is the existing paper engine. New code: `lib/paper/desk.ts` (sizing),
`scripts/desk.mts` (CLI) and the skill.

Found and fixed on the way: paper delivery sells did not pay the ₹15.93 DP charge (`11e9e56`).
Paper P&L at ₹1,000 would have read about 10 points per trade better than reality.

## Built: intraday paper (slice 2, `d3662ec`)

Product on every paper order/position (migration 0026), intraday fees, no mixing, no entry from 15:10 IST, cycle square-off from 15:10 or at once if carried.

## Designed, not built: Kite (real money, NSE)

Nothing is wired. What must be true before a real order can leave this machine:

| Requirement | Who | Why |
|---|---|---|
| Change `lib/trading/capabilities.ts`, `/api/trade/place` and the governance policy that prohibits order placement in every learning state | **owner** | protected paths; order authority is the owner's by design |
| Kite Connect app: `api_key` + `api_secret` | owner | credentials; check Zerodha's current Kite Connect pricing |
| Daily login: Kite access tokens expire each day and need the owner's interactive login | owner, daily | fully automated login is not something this system should do on the owner's account |
| SEBI retail-algo framework: broker-registered API use, static IP, order tagging, order-rate limits | owner + broker | regulatory; verify the current circular and Zerodha's implementation before going live |
| A paper-parity period: the desk's paper record over enough trades to judge | the system | the only evidence the desk earns anything |

When built, the adapter takes the same intent `placePaperOrder` takes and sits behind:
- an owner flag, default off;
- a per-order notional cap and a daily loss cap;
- a kill switch.

Every live order is recorded beside its paper twin.

## Built: Solana paper (slice 3, 2026-09-19)

`lib/crypto/jupiter.ts` (read-only; keyless 30/min, `JUPITER_API_KEY` for 60/min), `lib/crypto/paper.ts` (fills = real Jupiter quote for the exact size + stated 0.02 USDC network fee; verified tokens only, impact <= 1%, 25% position cap, 10 fills/day), migration 0027 (300 USDC book), `scripts/crypto-desk.mts` (quant / buy / sell / status). Live round trip: 10 USDC -> 0.0894 SOL at 111.88 -> 10.0006 USDC; book 299.96.

### Original plan

This system has no crypto data, instruments, cost model or risk model. The minimum honest slice:
1. Read-only prices from Jupiter's price API. AutoHedge's `jupiter_price.py` shows the shape; it is
   rewritten, not vendored.
2. A crypto paper account with its own cash and fees: swap fee, priority fee and slippage.
3. The same desk skill, extended to crypto instruments.

Real execution, meaning AutoHedge's `execute_trade` signing with `SOLANA_PRIVATE_KEY`, needs the
owner's explicit go-ahead and a wallet funded only with what they can lose. India taxes crypto
gains at a flat 30% with 1% TDS on transfers, so any edge must clear that too.

## Rejected

- **Vendoring AutoHedge's Python.** The LLM Quant invents its numbers. It needs `OPENAI_API_KEY`,
  and the owner chose Claude Code as the brain.
- **Letting the desk add names to the watchlist.** The watchlist-only buy rule is the owner's gate.
