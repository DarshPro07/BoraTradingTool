# Gate 3 — Program design

## Contracts

```
BrokerExecutionProfile {
  id, broker, exchange, segment, product,
  effectiveFrom, effectiveTo,
  sessionOpenMinute, sessionCloseMinute,
  newEntryCutoffMinute | null,          // null = not documented
  rmsSquareOffStartMinute | null,       // null = broker never force-closes (CNC)
  mandatoryExitMinute | null,           // the simulator deadline; null = overnight allowed
  productConversion | null,
  autoSquareOffCharge { amount, gstRate } | null,
  marginPolicy { maxLeverage, reference },
  source { url, retrievedAt, confidence: independently_fetched | owner_review_reported | assumed },
  policyVersion, status: active | superseded | draft,
  assumptions: string[]
}

executionProfileFor(query, records?) -> { available: true, profile } | { available: false, reason }
executionContextFor(universeMarket, resolution, at) -> same union      // owner's broker
describeExecution(profile) -> one-line provenance string for warnings and UI

feeSchedule(market, product, at, broker?, records?)                    // broker axis
roundTripCost({ ..., broker? })                                        // Upstox delta on brokerage

assessFeasibility({ market, product, sharePrice, capital, at?, broker? })
 -> { tradable, cashRequired, sharesPossibleCashOnly,
      sharesPossibleAtMaxLeverage { value, assumption },
      marginRequired { value | null, note },
      estimatedRoundTrip { rupees, pct }, minimumViableQuantity | null,
      autoSquareOffChargeIfForced | null, assumptions[], reason }
```

## Error model

- `EXECUTION_PROFILE_UNAVAILABLE`, `PROFILE_WINDOW_MISMATCH` — new RefusalCodes (engine refusal,
  matching the existing refusal style, never a throw).
- Fee lookup keeps `NO_SCHEDULE_IN_FORCE` (throws; existing convention).
- Feasibility never throws: verdict objects with reasons.

## Tests, each with the failure mode it detects

| Test | Detects |
|---|---|
| Zerodha vs Upstox cutoff differ | broker axis decorative |
| date outside every window → unavailable | fallback-to-current creeping in |
| BSE intraday → engine refuses | silent default resurrected |
| exits at 15:20 close under the 15:25 deadline | profile unread by the engine |
| **mutation: hardcode 920 → square-off tests fail** | tests blind to the deadline's source |
| squareOffAt 15:22 now accepted, 15:29 refused | validation not re-keyed to the profile |
| fee: same trade, Upstox costs more than Zerodha at small notional | broker delta path dead |
| feasibility: RELIANCE vs ITC differ; leverage labelled | per-instrument claim false |
| parity: portfolio exits == single-instrument exits | engines diverge |

## Playwright

- The intraday authoring warning names the broker, 15:25, the source and its confidence (API and
  Studio page).
- Compiling an intraday spec in the Studio shows the assumption text on the page.

## Least-confident decisions

1. Upstox 15:20 rests on the owner's review citation, not an independent fetch — marked so.
2. Non-CAS assumption for the whole universe — stated on the profile.
3. Minimum-viable-quantity threshold reuses the 0.5% WORKABLE line from cost-model.

## Rollback

New modules deletable; consumers revert to the deleted constant in one commit via git history.
