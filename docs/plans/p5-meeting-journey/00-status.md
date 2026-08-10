# P5 — Meeting journey (owner's demo script as acceptance) — Claude UI lane

Status: **VERIFIED 2026-08-10 14:35 IST** (v1 — the deterministic subset available today).

Scope v1: owner's demo script steps 1 (Brain) → 5 (strategy from prose in the factory) →
6 (backtest with the honest either-branch) → 7 (server-attested REPLAY validation) → 10 (Brain's
counts provably increased by what the person just did — hypothesis count cross-checked page vs
API, strategy count parsed from the server-rendered panel, both strictly greater than before).
Per-step network assertions; pageerror capture; zero tolerated.

Steps 2-4 (India market view, NSE search, research-this-stock) are an EXPLICIT BLOCKED LEG in
the spec — named, with the blocking item (engine lane's security-master bootstrap, release
severity) — never silently absent. The journey grows those legs when that lands.

- [x] e2e/meeting-journey.spec.ts
- [x] Verification: 1/1 on the item run; **62 passed / 2 skipped / 2 pre-existing NSE-search
      failures** on the clean-server full desktop suite (fresh DB, fresh `next start`).
- [x] Defect found and fixed during writing: the spec initially waited for a browser
      /api/readiness request that never happens (/brain is server-rendered) — asserted via
      direct API call instead. Recorded here because the mistake is instructive: server
      components make no client fetches, so network assertions belong on the API surface.

Remaining for full P5 (blocked/queued): search + India legs (engine lane), UI control inventory
sweep for every meeting-critical route (queued behind the blocked legs so the inventory is done
once, not twice).
