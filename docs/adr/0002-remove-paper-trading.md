# ADR 0002 — Remove paper trading (real-money only)

Status: Superseded by ADR 0003. Historical context only; not an operating guide.

Date: 2026-06-15

## Context

ADR 0001 made the **Paper Account** the safe default broker: a simulated $100k account
held in the local DB, filled in-app against live quotes, with real money gated behind an
explicit arm. In practice the user wants MarketPulse to be a real-money trading tool and
asked to remove paper trading **entirely**.

Paper was not just a toggle — it was the system's account-state model. The Trade Fence
read cash/equity/positions from the paper account (`paper-broker.ts`) to do buying-power
and position-sizing checks, and the engine filled paper orders itself. Removing it forces
two questions: where does the fence get account size, and what happens to the safe default.

## Decisions

1. **Real money is the only broker.** The paper subsystem (`paper-broker.ts`, the
   `paper_account` / `paper_positions` tables, the `/api/portfolio` endpoint, the broker
   selector UI) is removed. The `broker` concept is retired from runtime logic; the
   `orders.broker` column is kept (always `"real"`) to avoid a destructive column migration.

2. **The fence sizes against the synced Robinhood snapshot.** Because the app cannot read
   the broker directly, account state (cash, equity, positions) comes from the snapshot the
   Agent Layer pushes via the MCP (`robinhood_portfolio`, see the portfolio-sync feature).
   `getAccountState()` derives it; the fence gains an **`account` check**.

3. **Fail-safe on a missing/stale snapshot.** If no snapshot exists or it's older than the
   heartbeat TTL (10 min), the fence **blocks** every buy/sell. This ties trading to an
   actively-syncing agent session — consistent with the heartbeat philosophy in ADR 0001.

4. **The engine only authorizes.** `settleOrder` no longer fills; every cleared order
   becomes `authorized`, and the Agent Layer places it via the Robinhood MCP and reports the
   fill (`reportFill`). The `filled` status now comes *only* from a reported MCP fill. The
   `PlaceOrderResult` status set is `authorized | pending | blocked`.

5. **Clean slate.** Existing paper data, the open paper position, the order log, and any
   stale snapshot are wiped, and config resets to `mode=off` + disarmed.

## Consequences

- **The safe default is gone by design.** There is no simulated mode to fall back to; the
  only protections are the fence locks (armed + live heartbeat + fresh snapshot + limits)
  and Confirm Mode. This is a deliberate increase in risk posture, accepted by the user.
- The Scheduled Research System must **sync the portfolio each wake** (added as an explicit
  step in `CLAUDE.md`), or the fence blocks all orders.
- ADR 0001's mode/fence/heartbeat architecture stays intact; only the paper-as-default and
  in-app-fill decisions are reversed.
