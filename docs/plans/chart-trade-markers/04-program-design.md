# Gate 3 — Program design

Files:
- `app/api/research-data/bars/route.ts` (new) — GET ticker/resolution/from/to → store bars +
  provenance note; 400 on bad input or unknown resolution.
- `components/strategy/TradeChart.tsx` (new) — fetch, render, markers, price lines, abstention.
- `components/strategy/TradeInspector.tsx` — mounts TradeChart in the trade detail when
  `report.resolution` present.
- `app/api/strategy/trades/route.ts` — `resolution` in both responses.
- `lib/research-data/snapshot.ts` — `STORE_RESOLUTION` exported.
- `e2e/dataset-ledger.spec.ts` — trade-click chart assertions inside the existing ledger UI test
  (shares the seeded store; the network capture also proves the chart made no provider request).

Least-confident: marker text length on narrow screens (truncation is lightweight-charts'
behavior); ±40 context bars is a display choice, not a contract.

Rollback: remove the mount; endpoint and component are additive.
