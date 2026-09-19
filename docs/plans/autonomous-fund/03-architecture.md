# 03/04 — Architecture and program design

## Reality it builds on (01)

| Existing piece | Reused as | Status |
|---|---|---|
| NSE paper engine and risk kernel (`lib/paper`), ₹25,000, delivery or intraday | FN1 execution | OBSERVED working |
| Crypto paper book (`lib/crypto/paper.ts`), fills at real Jupiter quotes | FC1/FC2 execution | OBSERVED, live round trip |
| `audit_events`, append-only | decision, execution, NAV and kill ledger | STATICALLY_CONFIRMED |
| Scheduled cycle, every 15 minutes, re-bundled each run | the automation driver | OBSERVED |
| `ingestInstrumentHistory`, Yahoo daily | keeps NIFTYBEES current: ETFs sit outside the universe planner | STATICALLY_CONFIRMED |
| `getYahooCandles` for BTC-USD / SOL-USD | crypto daily bars | OBSERVED (SOL) |

The strategy DSL cannot express "hold X else cash, at month-end" and has no crypto; the forward
challenger pipeline spends statistical trials. Neither is extended. Mandates are small frozen TS
contracts, the Foundry's probe pattern. See the Explore map summarized in the conversation of
2026-09-19.

## Modules

```
lib/fund/mandates.ts   frozen contracts + pure rules: signal(), decisionDates()
lib/fund/ledger.ts     append/read fund_* rows in audit_events
lib/fund/metrics.ts    pure: NAV -> return, max DD, vol, Sharpe, MinTRL; gates T1-T3
lib/fund/run.ts        runFundPass(now): bars -> decide -> execute -> mark -> kill
app/fund/page.tsx      read-only view
scripts/fund.mts       run | report   (manual pass, text report)
lib/learning/cycle.ts  + runFundPass() every pass
```

## Contracts

```ts
interface MandateContract {
  id: "FN1" | "FC1" | "FC2"; title: string; venue: "NSE" | "SOLANA";
  asset: { instrumentId?: string; mint?: string; symbol: string; yahoo: string };
  rule: { kind: "ABOVE_SMA"; sessions: 200 } | { kind: "TRAILING_RETURN_POSITIVE"; days: 28 };
  schedule: "MONTH_END_SESSION" | "WEEKLY_SUNDAY_UTC";
  sleevePct: number;            // of the book's starting cash at registration
  killDrawdown: number;         // sleeve drawdown fraction that suspends the mandate
  declaredBenefit: "DRAWDOWN" | "RETURN_AND_DRAWDOWN";
  prior: string; sources: string[];
}
MANDATE_HASH[id] = sha256(JSON(contract)).slice(0,16)   // a changed parameter is a new mandate

signal(contract, closes: {date, close}[]) -> { hold: boolean; inputs: Record<string, number> } | null
isDecisionDate(contract, date, nextDate | null) -> boolean
```

Ledger rows (`audit_events.action`, `detail` JSON), all carrying `mandate` and `hash`:
- `fund_decision {decisionDate, hold, inputs, bootstrap}`: one per mandate per decision date.
- `fund_execution {decisionDate, side, quantity, fillPrice, fees, status, reason}`: one per attempt
  that reaches an engine.
- `fund_nav {date, nav, cash, quantity, close, benchmarkClose}`: one per mandate per bar date.
- `fund_kill {date, drawdown}`: suspends the mandate.

## Call flow: `runFundPass(now)`

For each mandate:
1. **Bars.** NSE: refresh NIFTYBEES through the executor, then read the store. Crypto: Yahoo
   daily, dropping today's forming UTC bar.
2. **Decide.** The latest completed decision date, or a bootstrap on the latest bar if the mandate
   has never decided. If the ledger has no row for that date: compute `signal`, then append
   `fund_decision`.
3. **Execute.** Reconstruct the sleeve from its own `fund_execution` rows. If the holding differs
   from the latest decision:
   - NSE: only in a REGULAR session, which means the next open after a close decision.
   - Crypto: at once.
   Place a paper order and append `fund_execution`. A rejection is retried on the next pass; the
   same reason is not re-logged more than once per day.
4. **Mark.** For each bar date after the last `fund_nav`, append NAV at that close, plus the
   benchmark close.
5. **Kill.** If drawdown from the NAV peak exceeds `killDrawdown`: append `fund_kill`, go flat, stop.

## Sizing

- Sleeve capital = `sleevePct × book starting cash`: FN1 ₹3,750 (the kernel's 15% cap), FC1/FC2
  75 USDC each.
- NSE quantity: `floor((sleeve cash − estimated round-trip cost) / price)`. Crypto: spend the
  sleeve cash minus the network fee.

## Tests, each with its failure mode

1. **Rules:** above or below the SMA, and the sign of the 28-day return. Fails if a rule reads a
   bar past its decision date.
2. **Decision dates:** month-end session (including a month ending on a holiday) and Sunday UTC.
3. **Metrics:** max drawdown, Sharpe and MinTRL against hand-computed values.
4. **`runFundPass` with a temporary DB and mocked quotes:**
   - decides once and is idempotent on re-run;
   - an NSE order waits for the session;
   - crypto executes at once;
   - NAV rows are complete;
   - the kill rule suspends.

## Security and permissions

Paper only. There is no key, no wallet and no broker. The fund's NSE instruments go on the
watchlist once, at registration, as part of the owner-requested setup and disclosed. The
autonomous loop never adds names.

## Rollback

Revert the commits. The ledger rows stay, because the log is append-only, and a reverted build
simply stops writing them.
