# Trial Budget Governor — Status

**Owner decision 2026-08-14:** remove `run_gauntlet` from the broad autonomous allowlist; replace
it with a dedicated deterministic Trial Budget Governor — *"autonomy without letting an LLM/team
spend statistical evidence freely."* Correct the stale comments; make the trial ledger like money
(LLMs propose, deterministic governor authorizes, gauntlet consumes).

| # | Slice | Status |
|---|---|---|
| 1 | Remove `run_gauntlet` from AUTONOMOUS_PERMITTED (protected policy.ts) | ✅ DONE — hook allowed the tightening under owner instruction |
| 2 | `lib/strategy/trial-governor.ts` — sole deterministic authorizer, off by default | ✅ DONE — 12 tests |
| 3 | Route runAutonomousGauntlet + validation job through the governor | ✅ DONE — 3 auto-gauntlet tests flipped to governor posture |
| 4 | Correct stale comments (auto-gauntlet.ts, cycle.ts) | ✅ DONE |
| 5 | Delete auto-mode.ts landmine (one permission truth) | ✅ DONE — zero importers confirmed |
| 6 | Mode-coercion honesty (non-protected surfaces) + taxonomy doc | ✅ DONE — API GET truthful, CLAUDE.md updated, docs/plans/mode-taxonomy |
| 7 | Verify + independent check | ✅ DONE — 147 files / 1719 passed / 0 failed, tsc 0; verifier PASS 0 blockers, 7/7 claims incl. sole-path |
| 8 | Budget-atomicity reservation (the gating follow-up) | ✅ DONE — withAuthorizedTrial serializes authorize→spend; fail-first TOCTOU proven; verifier PASS 0 blockers 7/7 (TOCTOU confirmed closed by promise-chain trace); +caller-level regression guard (spend runs under the lease). 147 files / 1724 passed / 0 failed, tsc 0 |

## The design, as built

- **Sole authority.** `authorizeTrial()` is the only thing that authorizes an autonomous trial
  spend. `run_gauntlet` is gone from the generic allowlist, so no autonomous actor (and no future
  Agent/Team) can reach the gauntlet through a coarse permission. The two callers of `runGauntlet`
  are the autonomous cycle (via `runAutonomousGauntlet` → governor) and the owner-authenticated
  `/api/strategy/gauntlet` route (via `requireOwnerMutationAccess` + explicit `confirm:true`).
- **Off by default.** The lane switch is `MARKETPULSE_AUTONOMOUS_TRIALS=1` — a dedicated,
  owner-set env var, never the learning mode and never a model. Unset ⇒ every authorization is
  `LANE_DISABLED` ⇒ recommend-only, the safe posture the cycle had before the inherited refactor.
- **Deterministic gates:** lane enabled · eligible candidate (the 5 selection guards) · not frozen
  · daily budget remaining. Per-candidate integrity (identity, snapshot, costs) is the selection
  guards; exactly-once-per-fingerprint and record-before-compute stay in the gauntlet.
- **Decides, never spends.** `authorizeTrial` writes only an `authorize_trial` audit row (in a
  swallowing try/catch so an audit fault cannot itself authorize or deny); the trial ledger is
  written only by `runGauntlet`.

## Budget TOCTOU — FIXED 2026-08-14 (the gating follow-up, built at owner request)

The daily budget check was not atomic with the spend (`runGauntlet` writes the ledger long after
`authorizeTrial` reads it), so two authorizations against `budget=1` could both approve before
either wrote. **Closed** by serializing the whole authorize→spend section through a dedicated
file lease (`withAuthorizedTrial` + `trialAuthorizationLeasePath()` in `lib/strategy/
trial-governor.ts`), reusing the existing `withCycleLease` machinery:

- Only ONE trial authorization holds the lease at a time, across every driver/process (shared
  file). It is held from BEFORE the budget check THROUGH `runGauntlet`'s synchronous ledger
  write, then released — so the next authorizer's `trialsSpentToday` sees the committed row.
- A second concurrent authorizer gets `AUTHORIZATION_BUSY` and never spends.
- The lease is a FILE (open `wx`), not a DB transaction — nothing is held open across the long
  gauntlet, per the owner's SQLite rule. A crashed holder frees it at the 10-min TTL.
- Lane-off / no-candidate paths do NOT take the lease (they report their true reason, never BUSY).
- Both callers refactored: `runAutonomousGauntlet` and the `validation` job run the spend inside
  the wrapper's callback. A third distinct lease file (`.trial-authorization-lease` vs
  `.cycle-lease` vs `.research-lease`) means no self-deadlock when the cycle holds its own lease.

Proven fail-first: `authorizeTrial` ALONE approves while a trial is mid-flight (the TOCTOU);
`withAuthorizedTrial` refuses BUSY and a committed spend makes the next authorizer
`BUDGET_EXHAUSTED`. A caller-level regression guard (auto-gauntlet.test.ts) observes, via the
injected dataset source, that the spend path executes while the lease file exists and the lease is
released afterward — so a future refactor that moved the spend outside the mutex fails here rather
than silently reopening the TOCTOU. Independent verifier: **PASS, 0 blockers, 7/7 claims**, TOCTOU
confirmed closed by tracing the promise chain to the `finally`-release after the ledger commit on
both callers. Suite 147 files / 1724 passed / 0 failed, tsc 0.

### Boundaries stated honestly

- **Owner route is a separate budget, by design.** `trialsSpentToday` counts only
  `autonomous_worker` trials, so `/api/strategy/gauntlet` (actor `"owner"`, human-gated by
  `requireMutationAccess` + explicit `confirm:true`) is neither counted against the autonomous
  budget nor serialized by this lease. An owner explicitly running a gauntlet is a human decision,
  not autonomous spending — the governor bounds the autonomous lane, not the owner. Exactly-once
  per `configurationFingerprint` still holds per spec regardless of actor.
- **TTL ceiling (low):** a gauntlet run is seconds of backtest+stats; if one ever approached the
  10-min TTL, a second authorizer could take the lease mid-spend. Add a heartbeat or raise the TTL
  only if that is ever observed — the same posture the cycle lease documents.
- **Low, pre-existing:** `selection_trials`'s family index is non-UNIQUE (app-level idempotency);
  a UNIQUE index would make it race-safe like `holdout_access`. Untouched here.

## Honest note on "owner-authenticated"

The `/api/strategy/gauntlet` route is gated by `requireOwnerMutationAccess`, which is a passthrough
to the invisible-local-session boundary (loopback + origin + fetch-metadata + session cookie +
custom header). "Owner" there is the local human at the machine, asserted as a string literal —
there is no separate owner-credential check distinct from any local process. That is the app's
documented local-security model (adversarially proven in protected-path-provenance), not a
weakness introduced here — stated precisely so the authority is not overclaimed.

## Exact next action

Await verification; write 06/07.
