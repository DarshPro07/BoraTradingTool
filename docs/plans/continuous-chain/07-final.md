# Final — Continuous Chain (rung 3)

**Verdict: VERIFIED** (defined scope: engine behavior + auth boundary; e2e out of scope, stated
in 06). Independent verifier: **PASS, high confidence, 0 blockers on items 1-4.**

## Objective (owner, 2026-08-14)

Refine wake instants (split epoch from display) → event-driven job wake with reconciliation kept
→ adversarially prove the ownerless-auth boundary BEFORE autonomy expansion → add durable
backtest/validation kinds toward the continuous chain. Agents/Teams and model routing remain after.

## Delivered

1. **WakeInstant split**: `{epochMs, display}`; scheduling/comparison consume `epochMs` only; the
   string-parsing comparator is deleted; `zonedEpoch` (Intl, DST-correct) gives every exchange-
   local display its true instant. The whole lexical-bug class the earlier `nextCheckAt` find
   belonged to is now structurally closed.
2. **Event-driven job wake**: `registerJobWake` drains on JOB_CREATED/JOB_COMPLETED; the 5s timer
   remains as the reconciliation net (missed events, stale leases, cross-process writers). The
   short-transaction discipline (claim COMMIT → work outside txn → persist COMMIT) already held.
3. **Auth boundary adversarially proven**: 16 forged-request attacks — cross-site, missing/wrong
   header, port/protocol mismatch, tampering, foreign-secret forge, simple-form POST, expired,
   pre-restart, spoofed forwarded-host — all rejected; the legitimate path allowed. Forged
   requests are the correct proof: a browser cannot send these, which is the defense.
4. **Continuous chain**: `backtest` kind (READ, deterministic, re-runnable) → persisted experiment
   → `BACKTEST_COMPLETED(real specId)` → dependent job wakes `waiting_dependency → queued →
   succeeded` in one sweep, no owner. `validation` kind is double-gated and enqueued by nothing
   autonomous; an unconfirmed job dies with 0 trials spent.

## Evidence

- `npx tsc --noEmit` → 0 · `npm run test:verified` → **146 files / 1712 passed / 0 failed /
  2 skipped** (baseline 1689; +23 net, 0 regressions), independently reproduced by the verifier.
- Fail-first where behavior changed (the mixed-format min in the prior leg; the guardrails here
  are proven by the refuse-with-0-trials assertion).

## Independent verification (Gate 5)

Fresh-context verifier, its own suite/type runs, exact-match reproduction: all four
implementation claims CONFIRMED; the safety judgment CONFIRMED accurate in all four sub-parts,
and sharpened — see below. Zero autonomous `validation`/`backtest` enqueue sites (the MCP surface
structurally cannot construct such a payload either). No path reaches `runGauntlet` without all
three gates. `zonedEpoch` executed live: 09:00 Asia/Kolkata → 03:30:00Z, exact.

## SAFETY — owner decision required BEFORE commit or before mode is raised above `off`

The inherited (uncommitted, prior-session) refactor changed the governance posture. Full detail
in `SAFETY-FINDING-run_gauntlet.md`; the essentials:

- `run_gauntlet` is now in `AUTONOMOUS_PERMITTED` (protected `policy.ts`), and `getLearningMode()`
  coerces all non-`off` modes to `evolving` — so the live cycle CAN autonomously spend ≤1
  permanent statistical trial/day on a fully-eligible candidate. Bounded (budget=1, 5 guards,
  freeze, owner-gated mode change), not runaway; but it is a real posture change.
- The coercion collapses the ENTIRE four-tier ladder: `observing` now behaves as `evolving` for
  every allowlisted action. Docs/API still report four tiers.
- `lib/brain/auto-mode.ts` is dead (zero importers) but carries a bypass-shaped `isActionPermitted`
  granting all WRITE_LOCAL in RUN mode — a landmine if ever wired.
- Two now-false "run_gauntlet is not allowlisted" comments (auto-gauntlet.ts, cycle.ts) left
  unedited on purpose, to be corrected in the same change that resolves the decision.

This leg did not build on any of it; the new `validation` kind cannot become an autonomous
trial-spender. The correct action was to surface it, which is done.

## Rollback

New job kinds + handlers are additive; `registerJobWake` and the WakeInstant split revert cleanly.
Reverting the four handler edits + the two new kinds restores the prior queue exactly.

## Next rungs (unchanged order, after the owner's governance decision)

Structured warm-up refusals (panel `ready()` → barsHeld/barsNeeded) · the durable-kind ladder
(forward_resolve, paper_reconcile, incident_repair), each WITH its handler · Agents/Teams as
workers on these jobs · then 1-5 model routing above.
