# SAFETY FINDING — autonomous trial-spending was silently enabled

**Severity: owner decision required (governance + irreversible).** Found 2026-08-14 during the
continuous-chain leg, NOT introduced by it.

## What changed, and who changed it

The inherited (uncommitted, prior-session) single-RUN/ownerless-auth refactor added one entry to
`AUTONOMOUS_PERMITTED` in the **protected** file `lib/governance/policy.ts` (lines 62-67):

```ts
{ id: "run_gauntlet", capability: "WRITE_LOCAL",
  summary: "Run the statistical validation gauntlet on a rehearsed candidate (spends one permanent trial)",
  minimumMode: "evolving" },
```

Combined with the same refactor's `getLearningMode()` coercion (everything except `off` →
`evolving`, `lib/governance/runtime.ts`), this means:

    evaluateAutonomousAction("run_gauntlet", "autonomous_worker", getLearningMode())  →  ALLOWED

The live learning cycle calls `runAutonomousGauntlet` every pass (`lib/learning/cycle.ts` ~754).
Before this refactor that call ALWAYS refused at the policy gate and spent nothing — the design
`lib/strategy/auto-gauntlet.ts:30-38` still describes ("run_gauntlet is **not** in
AUTONOMOUS_PERMITTED … No autonomous actor may spend a trial today"). **That docstring is now
stale and misleading.** The posture changed from "never autonomously" to "autonomously, under
guards."

## Why it is not a runaway (the guards that DO still hold)

Real-world exposure is bounded to **≤ 1 permanent trial per day, on a fully-eligible candidate**:

- `DEFAULT_DAILY_TRIAL_BUDGET = 1` (auto-gauntlet.ts:42), enforced per candidate.
- All five selection guards must pass: rehearsal `would_pass`, at the `rehearsed` rung,
  cost-honest, tradable at the owner's capital, budget available.
- `freezeStanding("gauntlet_trial")` can administratively halt it.
- A trial is still permanent and still counted in the multiple-testing denominator.

So it is not "unbounded autonomous trial-spending"; it is "the loop may now spend its 1/day
budget without the owner, where before it never could."

## What THIS session did about it

- Did NOT build on it. The new `validation` job kind is double-gated and **not enqueued by any
  autonomous path** — it cannot become a second automatic trial-spender.
- Did NOT edit the protected governance file to revert the change (that is the owner's call, and
  reverting a governance rule autonomously is itself forbidden).
- Surfaced it here and in the final report for an explicit owner decision.

## The owner's decision

1. **Intended?** If autonomous 1/day trial-spending is what you want, the code is correct — but
   `lib/strategy/auto-gauntlet.ts:30-38`'s docstring must be corrected (it currently states the
   opposite), and the change should be committed deliberately with that intent recorded.
2. **Not intended?** Remove the `run_gauntlet` entry from `AUTONOMOUS_PERMITTED` (owner edit to a
   protected file) and the cycle returns to refuse-and-recommend. The new `validation` job kind
   still works under explicit `confirmed:true` + a temporarily-permitted policy.

Either way this should be settled before the Agents/Teams layer (which will enqueue quant jobs)
is built on top of the Job OS.

## Two facts independent verification added (2026-08-14 02:02) — scope is BROADER than the gauntlet

1. **The mode coercion collapses the whole ladder, not just this one action.** `getLearningMode()`
   returns `evolving` for EVERY stored mode except `off`, so an owner who selects what they believe
   is the conservative **`observing`** tier is, in the current code, at full **`evolving`** for
   every allowlisted action — not only `run_gauntlet`. `CLAUDE.md` and the `GET /api/learning`
   response still describe the old four-tier semantics, so the UI/report and the enforcement
   disagree. (`LearningModeControl.tsx` was rewritten in the same uncommitted diff to a RUN/OFF
   toggle, but the docs and the API description were not.)
   **Mitigating fact:** a fresh/untouched install defaults `learning_state.mode` to `off`
   (`schema.ts:868`) and the cycle short-circuits before the gauntlet at `off`, so nothing is live
   until the owner moves mode off `off` through the owner-gated `PATCH /api/learning`.

2. **`lib/brain/auto-mode.ts` is a dead landmine.** New, untracked, unprotected, and imported by
   NOTHING (verified by grep) — so it changes nothing today. But its `isActionPermitted()` grants
   ALL `WRITE_LOCAL` actions unconditionally whenever RUN mode is active, with no per-action
   allowlist — it bypasses `evaluateAutonomousAction` entirely. If a future change wires it in
   without noticing, the whole `AUTONOMOUS_PERMITTED`/`AUTONOMOUS_PROHIBITED` gate is bypassed.
   Owner decision: delete it (nothing uses it), or, if it is the intended future model, gate it
   behind the same per-action allowlist before anything imports it.

3. The now-false "run_gauntlet is not allowlisted" comment exists in TWO places, not one:
   `lib/strategy/auto-gauntlet.ts:30-33` AND `lib/learning/cycle.ts` (above the
   `runAutonomousGauntlet` call). Both are left unedited on purpose — they should be corrected in
   the same change that resolves the governance decision, so the comment never documents a posture
   the owner has not chosen.

