# WS1b design decisions (on top of the owner's directive)

- **Three trigger-enforced ledgers** (migration 0013): `execution_intents` (immutable — a REJECT
  row is first-class evidence), `paper_forward_orders` (identity frozen; terminal states final;
  only lifecycle fields move), `paper_position_outcomes` (append-only). Intent values are never
  overwritten by fills — expected-vs-simulated (vs future real-Kite) needs both preserved.
- **PaperEligibilityDecision lives in `decideNewSignals`**: tradable → data-fresh (fill bar
  within 2 bars) → execution profile → broker cutoff → fees priceable → no conflicting position →
  position limit → sizing at running cash (maxPositionPct of cash; qty<1 ⇒
  INSUFFICIENT_CAPITAL). Sequential decisions on one account: no overspend by construction.
- **Fills**: MARKET at next-bar-open + slippage (same rates as the live paper engine); no bar ⇒
  order waits (an outage cannot invent a fill). Fees via the effective-dated fee engine, half at
  entry, half at exit; funds move exactly once per event (outcome PK is the guard).
- **Exits**: stop (gap-aware) / target / broker square-off minute / horizon — position state, not
  a resting order book. `TRIGGER_PENDING` exists in the schema for the future SL/LIMIT book; the
  paper adapter declaration was made HONEST (market_orders only — no limit/sl claim until the
  book exists).
- **Accounts**: one per challenger (v2 inherits nothing), default = OWNER_CAPITAL (₹1,000),
  configurable per enrollment — never a flattering crore.
- **Same `asOf`** drives shadow then paper in one deterministic pass; ledgers stay separate.
