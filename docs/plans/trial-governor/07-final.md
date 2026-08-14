# Final — Trial Budget Governor + governance cleanup

**Verdict: VERIFIED** (defined scope). Independent verifier: **PASS, high confidence, 0 blockers,
all 7 claims CONFIRMED** — including the security-critical sole-path claim.

## Objective (owner decision, 2026-08-14)

Do not keep the inherited broad `run_gauntlet` autonomous allowlist. Replace it with a dedicated
deterministic Trial Budget Governor — autonomy without letting an LLM/team spend statistical
evidence freely. Correct the stale comments; make the trial ledger like money; one permission
truth; stop the mode-coercion truth defect.

## Delivered

1. **`run_gauntlet` removed** from `AUTONOMOUS_PERMITTED` (protected `policy.ts`, edited under
   direct owner instruction — a governance tightening). `evaluateAutonomousAction("run_gauntlet")`
   now denies.
2. **Trial Budget Governor** (`lib/strategy/trial-governor.ts`): the SOLE deterministic authorizer
   of an autonomous trial spend. Off by default (`MARKETPULSE_AUTONOMOUS_TRIALS=1`, a dedicated
   owner switch — never the mode, never a model). Gates: lane enabled · eligible candidate (the 5
   selection guards) · not frozen · daily budget. Decides and audits; never spends — the ledger is
   written only by `runGauntlet`, whose exactly-once-per-fingerprint idempotency is untouched.
   Verifier confirmed the 3 `runGauntlet` callers are all gated by the governor or the local-owner
   API route, and the MCP surface cannot forge a validation payload.
3. **Routed** `runAutonomousGauntlet` and the `validation` job through the governor; **corrected**
   the stale "run_gauntlet is not allowlisted / activate with one allowlist line" comments in
   auto-gauntlet.ts, cycle.ts, and queue.ts to describe the governor.
4. **Deleted** `lib/brain/auto-mode.ts` — dead code with a bypass-shaped permission model
   (verifier reconfirmed zero importers). One permission truth.
5. **Mode-coercion honesty** (non-protected surfaces): `/api/learning` GET now reports the
   effective single-AUTO reality (`auto` boolean, `modes: ["off","evolving"]`, honest `enabled`);
   PATCH returns `{requested, mode}` so a coerced selection is explicit, not silent. CLAUDE.md
   learning-mode section rewritten to single-AUTO. The protected root (the `getLearningMode`
   coercion + 4-value `LearningMode` type) is documented in `docs/plans/mode-taxonomy/` as
   Option A (collapse to two values), owner-to-apply.

## Evidence

- `npx tsc --noEmit` → 0 · `npm run test:verified` → **147 files / 1719 passed / 0 failed /
  2 skipped** (baseline 1712; +7 net, −1 deleted file, 0 regressions), independently reproduced.
- Fail-first where behavior flipped: three auto-gauntlet tests + one cycle-resolution test moved
  from the rejected "policy permits run_gauntlet" posture to the governor posture; the governor's
  own 6 tests pin off-by-default, gate-by-gate refusal, and decide-never-spend.

## Independent verification (Gate 5)

Fresh-context verifier, own suite/tsc/build runs, exact-match reproduction. All 7 CONFIRMED. Its
findings, disposition:
- **Budget TOCTOU (medium, PRE-EXISTING):** the budget check is not atomic with the spend; two
  concurrent trial-authorizing entry points could overshoot budget=1 WHILE the lane is on. The
  autonomous path is sequential and cannot overshoot itself; the hard invariants hold. **Recorded
  as a GATING requirement before the lane is enabled in production** (00-status.md): an atomic
  reservation or trial lease. Not built now — the lane is off by default and the fix must not hold
  a transaction across the long spend. The governor docstring now states this ceiling honestly.
- **Non-UNIQUE selection_trials index (low, pre-existing):** compounds the same TOCTOU family;
  noted alongside.
- **Stale queue.ts:58 comment (low):** FIXED this pass.
- **"owner-authenticated" imprecision (low):** `requireOwnerMutationAccess` is a passthrough to
  the local-session boundary; "owner" = the local human, not a separate credential. Stated
  precisely in 00-status.md so the authority is not overclaimed.

## Flags for the owner

- The governance posture is now SAFE BY DEFAULT again: no autonomous trial is spent unless the
  owner sets `MARKETPULSE_AUTONOMOUS_TRIALS=1`. **Before setting it, the budget-atomicity fix
  should land** (docs/plans/trial-governor/).
- The wider single-RUN/ownerless-auth refactor remains uncommitted across protected paths (now
  minus `run_gauntlet` and `auto-mode.ts`); the mode-taxonomy protected root (Option A) still
  awaits the owner's protected-file edit. Both tracked in their plan docs.

## Next rungs (unchanged order)

Budget-atomicity reservation (gates lane-enable) · structured warm-up refusals · the durable-kind
ladder (forward_resolve, paper_reconcile, incident_repair) · Agents/Teams as job workers · 1–5
model routing. The governor is the version the Agent/Team layer can safely sit above.
