# Final — chart entry/exit markers (master item 14)

## Verdict: **VERIFIED**

Clicking a trade in the inspector now draws the trade: entry arrow below its bar, exit arrow
above its bar with the exit reason, dashed lines at both fill prices, ±40 store bars of context,
and a caption naming the canonical store as the source.

Files: `app/api/research-data/bars/route.ts`, `components/strategy/TradeChart.tsx`,
`components/strategy/TradeInspector.tsx` (mount), `app/api/strategy/trades/route.ts`
(`resolution` field), `lib/research-data/snapshot.ts` (`STORE_RESOLUTION` export),
`e2e/dataset-ledger.spec.ts` (assertions).

Evidence: `06-verification.md`. Rollback: unmount `TradeChart`; endpoint and component are
additive. No unresolved failures.
