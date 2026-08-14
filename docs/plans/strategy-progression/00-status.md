# Strategy pipeline progression — status

**Owner requirement (2026-08-14):** "The system should create a strategy unless no path exists."
Observed live funnel: 50 created over time; display shows 22 AUTHORED → 10 REHEARSED → 2
GAUNTLET → 0 PASSED ("path" in the owner's readout = the PASSED tile) → 0 FORWARD; 2 rejected;
14 total trials (2 strategies × 7 gauntlet stage rows); 0 paper challengers. Strategies stall
silently. The doctrine to apply is the one already governing jobs: **every blocked thing either
advances, knows its dependency and wake condition, or terminates with a stated permanent reason.**

## Gate 0 — reality (independent recon, verified references; 2026-08-14)

Two stage models that never talk: stored `strategy_specs.status`
(draft/compiled/validating/paper_challenger/retired/rejected — only `paper_challenger` and
`rejected` are ever written, both by the gauntlet; `compiled`/`validating`/`retired` have NO
writer) and the derived ladder `Stage` (lib/strategy/lifecycle.ts: draft → rehearsed → validated
→ holdout_cleared → paper_forward → owner_review, + graveyard) computed from evidence tables by
`currentStage()`/`standings()`. The funnel UI (components/strategy/ValidationFunnel.tsx, on
/strategies) reads NEITHER — raw table counts (specs.length; lastCycleRun().rehearsed; distinct
validation_results/trials; forward_outcomes).

**Five structural defects (ranked):**

1. **Authored specs are unsatisfiable by construction.** `authorFromHypotheses`
   (lib/research/hypothesis-author.ts) never sets `universe.resolution`; the DSL default is "D"
   (lib/strategy/dsl.ts:240) → impliedProduct DELIVERY; the `tradable_at_capital` guard
   (lib/strategy/auto-gauntlet.ts:159-167) at ₹1,000 IN capital resolves the breeding basis to
   INTRADAY-only (₹23,000 delivery floor) → EVERY autonomously authored spec is refused a trial
   forever, on a field the author never wrote. This alone explains "10 rehearsed → 0 eligible".
2. **`validated` is a dead end.** `recordHoldoutOutcome` (lib/strategy/holdout.ts:43) has no
   production caller (tests only) — `validated → holdout_cleared` never happens, so
   `holdout_cleared → paper_forward → owner_review` are unreachable. Forward enrollment
   (`activateChallenger`, lib/forward/shadow.ts:80) is reachable only via the manual owner route
   app/api/forward/activate.
3. **Rehearsal starves specs 11+.** lib/learning/rehearsal.ts:141 `.filter(draft|validating)
   .slice(0, 10)` — no orderBy, no already-rehearsed exclusion: the same first 10 rows by
   insertion order are re-rehearsed every cycle forever. The funnel's "10" is the cap itself.
4. **Stall reasons are computed and thrown away.** `Advance.because` renders per-row, but
   `Standing.blockedOn` has zero UI consumers; `promotionPass().waiting` names nothing at
   `draft` (promotion.ts:218-220 excludes draft) and is rendered nowhere; the six
   selectTrialCandidates guard refusals (incl. the killer: capital-vs-resolution) exist only in
   an in-memory report; only the governor's authorize_trial verdict reaches audit_events.
5. **Latent pass-killer:** auto-gauntlet.ts:149 calls `costStanding()` unguarded; one spec on a
   market with no fee schedule throws `CostModelError` out of `selectTrialCandidates`, impairing
   the ENTIRE autonomous-gauntlet pass (cycle.ts:821-824) — while the guarded wrapper
   (`costVerdictOrBlocked`, promotion.ts:39) already exists.

Also real: the funnel's REHEARSED counter reads the LAST CYCLE's evaluated count (a cap
artifact), not cumulative truth; "paper challenges" tile counts `status=paper_challenger`
(= gauntlet PASSED), unrelated to the actual forward/paper machinery (forward_challengers /
paper_forward_accounts).

## Gate 1 — product

**Problem:** the owner cannot tell why 20 of 22 strategies never advance, and for most of them
the true answer today is "a structural defect, not evidence" — the worst possible state for a
learning system: it looks like the market said no, when nothing was ever tested.

**Outcome:** every strategy on /strategies shows its stage from ONE stage machine and, when not
advancing, a typed stated reason with the named next action (and owner switch where that is the
gate). Autonomously authored strategies are BORN eligible (tradable at current capital).
Rehearsal covers every draft over time. The chain above `validated` exists as durable job kinds:
gated holdout decision, autonomous-once forward enrollment. Nothing silently stalls.

**Non-goals:** no change to trial governance (budget 1/day, lane switch off by default, double
gates stay); no autonomous holdout spend (query-once stays owner-authorized); no broker/order
capability; no attempt to make strategies PROFITABLE — this leg makes the pipeline honest, not
the edge real.

## Gate 2/3 — architecture & design (condensed)

One principle: **the derived ladder (`lifecycle.ts` stages + `promotion.ts` standings) is the
single progression truth**; surfaces read it, never raw tables.

- S1 authoring: derive `universe.resolution` from the SAME capital source guard 4 enforces
  (breedingBasis → INTRADAY ⇒ an intraday resolution the engine's features support; DELIVERY ⇒
  daily as now). Unit test proves fail-first that today's authored DSL defaults to "D" and is
  refused by the guard.
- S2 rehearsal: selection = never-rehearsed first (no rehearsal_outcomes row), then stalest
  `evaluatedAt`; cap unchanged. Fail-first test: 12 drafts → old code evaluates the same 10
  twice; new code reaches all 12 within two passes.
- S3: wrap the candidacy cost check in the guarded pattern; a CostModelError becomes that SPEC's
  refusal, never the pass's impairment. Fail-first unit test.
- S4 surface: promotionPass covers draft specs; standings expose per-spec
  `{stage, because, blockedOn}`; ValidationFunnel + /strategies read standings (funnel counters
  = stage counts from the ladder; per-row blocked reason column). E2E: a stalled spec's row
  states its reason.
- S5 job kinds (the owner's Job-OS ladder, "kind by kind WITH a real handler"):
  `holdout_decision` — handler calls recordHoldoutOutcome; DOUBLE-GATED (payload confirmed:true
  required; holdout module's own once-ever seal enforced; never autonomously enqueued) — the
  stated next action for `validated`. `forward_enroll` — handler calls activateChallenger for a
  `holdout_cleared` spec (paper-stage, nothing irreversible; refusals are its existing codes);
  enqueued autonomously by the cycle's promotion pass with dedupe `forward-enroll-<specId>`.
- S6 acceptance: unit suites for every slice + an e2e asserting funnel/stage/blocked-reason
  truth against the running product; full regression; commit.

## Slices / state — ALL COMPLETE 2026-08-14

- [x] Gate 0 (recon complete, references verified)
- [x] S1 author capital-tradable resolution — fail-first proven ("basis says INTRADAY but the
      authored spec resolves 'D'"), fixed: resolution from `basis.product` (5m — the store's real
      intraday supply), costs priced on the SAME product (was hardcoded DELIVERY), intraday
      spread STATED (`ASSUMED_INTRADAY_SPREAD_BPS = 5`, recorded in assumptionsAdded).
- [x] S2 rehearsal rotation — fail-first proven (12 drafts, two passes, only 10 ever seen):
      never-rehearsed first, then stalest `rehearsedAt`; deterministic tie-break; cap unchanged.
- [x] S3 guarded candidacy cost check — `selectTrialCandidates` uses `costVerdictOrBlocked`
      (injectable standing); one unpriceable spec now blocks ITSELF, never the pass. The defect
      was latent (both markets carry in-force schedules today) — recorded as
      STATICALLY_CONFIRMED with a behavior-level test, not a faked reproduction.
- [x] S4 stage-machine truth — ValidationFunnel counts the derived ladder (cumulative
      at-or-past rungs; monotone by construction) from the SAME `standings()` array the registry
      rows read; the typed `blockedOn` renders per-row (`stage-blocked-on`) and aggregated
      (`funnel-waiting`). The old REHEARSED bar (the cap, shown as a measurement) is gone.
- [x] S5 `forward_enroll` durable kind — handler wraps `activateChallenger`; double-gated like
      `validation` (explicit enqueue only + `confirmed:true`); ALREADY_ACTIVE is success
      (idempotent by goal); SPEC_NOT_FOUND added to the queue's PERMANENT codes (one attempt,
      never a retry budget). `promotionPass().forwardEnrollable` + cycle action lines are the
      REPORTED path — the governance table has no autonomous action for challenger activation,
      and lib/governance is protected, so autonomy here would be invented policy.
      **holdout_decision NOT built, deliberately:** there is no sealed-holdout dataset apparatus
      anywhere (no "holdout" snapshot purpose, no sealed segment, no evaluator — `holdoutId` is
      only a ledger key). Building one mid-slice would be improvised statistics; the stage
      surface states the wait (`blockedOn: holdout`) and WORK_QUEUE carries the apparatus as its
      own next item.
- [x] S6 acceptance — e2e/strategy-progression.spec.ts (funnel speaks ladder language; a
      never-rehearsed draft shows "waiting on rehearsal" in both the aggregate and its row):
      8 passed with strategy-factory + app regression on a fresh prod build; second clean run on
      a virgin DB 2 passed. Unit: author 2/2, rehearsal 16/16, auto-gauntlet 19/19,
      worker-kinds +2, promotion-economics 4/4; full suite + tsc recorded in 07-final.

**What the owner's funnel will now do:** newly authored strategies are born 5m/INTRADAY —
eligible for candidacy instead of structurally refused; rehearsal reaches ALL drafts over
cycles (the "10" becomes a real cumulative count); gauntlet survivors carry a named, enqueueable
next action; and every stalled row says what it waits on. Trial governance is UNCHANGED (lane
switch, budget 1/day, double gates). Existing "D"-resolution specs remain refused at candidacy
with the reason now VISIBLE — re-authoring them is the hypothesis pipeline's job, not a
migration's.
