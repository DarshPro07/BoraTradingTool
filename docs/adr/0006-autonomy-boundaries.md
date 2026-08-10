# ADR 0006 — Autonomy boundaries: execution, self-modification, edge sources

**Date:** 2026-08-09
**Status:** Accepted
**Supersedes:** the "monthly income is not a near-term target" resolution in
`docs/OWNER_BRIEF_AND_PLAN_2026-08-08.md` §6, which was a decision made on the owner's behalf and
has now been corrected by the owner.

## Context

The owner restated the goal: an autonomous, self-adjusting, self-researching system requiring no
human interaction, producing monthly income. Budget ₹1,000. **India only — US work is on hold**,
which retires the open question in the 2026-08-08 brief §9 about LRS and US brokerage.

Three architectural decisions were taken in the 2026-08-09 interview.

## Decision 1 — Execution: automatic, gated on forward evidence

A Kite (Zerodha) adapter will be built. A strategy reaches live order placement **automatically**,
with no human confirmation, once and only once it has cleared forward-paper evidence:
`MIN_FORWARD_OBSERVATIONS = 20` resolved observations, mean R positive beyond its own standard
error (`lib/strategy/forward.ts`, `lib/strategy/lifecycle.ts`).

The gate is a **rule, not a person**. This satisfies "no human interaction" in steady state while
keeping the property that nothing untested reaches money.

**Consequences.** Two things this system cannot do for itself, and which remain owner-only
boundaries under the software-factory workflow:
- Kite API credentials must be supplied by the owner; they are never read or written by an agent.
- `place_order` is prohibited in `AUTONOMOUS_PROHIBITED` (`lib/governance/policy.ts`), which is a
  protected file. Only the owner can change that, and it should change **after** the adapter,
  risk gate and forward-evidence promotion are built and verified — not before.

Until both happen, `/api/trade/place` continues to return `EXECUTION_ADAPTER_MISSING`. This ADR
records the destination, not a licence to skip the steps.

## Decision 2 — Self-modification: strategies free, code behind an independent verifier

- **Strategy specifications** may be authored, bred, tested and promoted with no human approval.
  They are data, and their blast radius is bounded by the gauntlet, the trial ledger and the
  research-identity accounting.
- **Application code** may be modified autonomously, but a change may only merge after an
  **independent verifier agent, running in a fresh context**, passes it. Not a human; also not
  self-approval.

**Why the split.** Strategies are data; code is capability. And the evidence for requiring an
independent pass on code is local: on 2026-08-09 this repository held three defects — two
timestamp conventions in one table, a declared resolution ignored in three layers, and a
multiple-testing denominator of 1 — while 1,180 tests passed green. A self-approving agent with a
green suite would have merged all three.

**Consequences.** The verifier must not share context with the author. Its independence is the
whole mechanism, and an implementation that reuses the authoring agent's context satisfies the
letter and destroys the purpose.

## Decision 3 — Edge sources: all four, pursued in parallel, plus further research

The owner selected every option and asked for additional research:

1. **Kronos / ML forecasting** — blocked on a point-in-time forecast archive. Without one, replaying
   a current forecast across history is lookahead that produces an excellent equity curve rather
   than an error (ADR 0004).
2. **Classical technical patterns** — cheapest to express. Two were built and measured on
   2026-08-09; both lost money (ORB −16.34% over 73 trades, first-hour momentum −27.82% over 87).
3. **LLM-driven research synthesis** — the "professor". The research queue and worker exist and
   work; `enqueue()` is called by nothing autonomous, so the loop drains a queue only a human
   fills. This is the narrowest gap between what exists and what the owner described.
4. **Systematic factory search** — available, but it consumes multiple-testing budget fastest, so
   it must wait until the selection-trial ledger is finished and correct.

## The capital arithmetic, recorded because it constrains all of the above

The owner's stated trajectory is ₹1,000 → ₹50,000 within one month. That is **50× in ~22 trading
days ≈ 19.5% per day compounded with no losing days**; at 5× MIS leverage still ~4% per day on
notional. No measured edge of that magnitude exists in this system or in the published literature.

**Assumption this project proceeds under:** the capital trajectory is funded by owner
contributions, and the system's job is to be *proven* by the time that capital arrives. This is
consistent with Decision 1, which makes forward evidence the gate for live money.

This is recorded rather than argued because a system built to target 50× would necessarily disable
the gauntlet, the holdout and the trial ledger — the three mechanisms that stop a backtest lying —
and would therefore produce exactly the confident, wrong answer the owner is trying to avoid.

## Status of the goal conflict

The 2026-08-08 brief ordered the goals: monthly income → learning → beat NIFTY → capital
preservation, then resolved in favour of learning. **The owner has now placed monthly income
first.** The resolution stands on evidence rather than preference: with no strategy yet showing
positive forward evidence, there is nothing to generate income *with*. Income is the objective;
forward-proven edge is the only path to it that does not consist of losing ₹1,000 quickly.
