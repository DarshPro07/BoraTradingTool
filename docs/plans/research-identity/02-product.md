# Gate 1 — Product

## User problem

The owner is deciding whether a trading strategy has a real edge. The system's answer to that
question is currently inflated by an amount nobody can see, because the statistics that are meant
to correct for "how many things did we try?" believe the answer is always **one**.

Worse, the correction can be reset by accident. Rename a strategy, tune a stop, save it as v2 — and
the system hands out another look at the one sample it was never allowed to look at twice.

## User

The owner, deciding what to risk money on. Secondarily the autonomous loop, which will eventually
spend this budget without being asked and must not be able to spend it wrongly.

## Current behaviour

- Every strategy is treated as the only strategy ever tested. `N = 1`.
- Ten variants of one idea produce ten independent-looking results.
- A rename yields a fresh sealed-holdout query.
- A test asserts the last point is correct.

## Desired outcome

The owner can trust that a "validated" verdict already accounts for everything else that was tried
in the same search — and that no amount of renaming, copying, re-versioning or re-parameterising
quietly restores spent budget.

## Success evidence

1. Five variants of one hypothesis produce a denominator of **5**, not 1 and not 5 families.
2. Re-running an identical configuration does **not** increase the denominator.
3. Rename / copy / new-version / new-uuid each fail to obtain a second holdout look.
4. Inventing a new family inside a campaign that has already looked also fails.
5. A genuinely new holdout generation **succeeds** — the guard is not simply "always no".
6. A strategy with no declared family **cannot be validated at all**, and no code path produces a
   default denominator of 1.
7. The regression suite is proven to detect the original defect by mutation.

## Failure conditions

The feature is still wrong if:

- family identity becomes the denominator (ten variants → `N = 1`), replacing one understatement
  with another;
- missing identity falls back to any default rather than refusing;
- the holdout gates are so blunt that legitimately fresh data cannot be used;
- entitlement is consumed after the result is computed, so a crash yields a free second look;
- two concurrent requests both succeed.

## User journeys

1. **Declare a search.** Owner states a campaign and a family with its economic hypothesis, before
   the first experiment.
2. **Test variants.** Several configurations are rehearsed; each records one selection trial.
3. **Ask what the bar is.** Owner sees the true denominator and which siblings it includes.
4. **Attempt to cheat, accidentally.** Owner renames a strategy and re-requests the holdout; is
   refused with a reason naming the family that already spent it.
5. **Legitimately move on.** A new holdout generation from data that did not exist during
   development is accepted.
6. **Backfill.** Owner runs the classifier, reads proposed placements, decides.

## Non-goals

- Deciding family membership automatically. Structure proposes; a human disposes.
- Enabling autonomous trials. Explicitly still off.
- Broker profiles, capital feasibility, fee broker-axis, CI determinism — all queued behind this.

## Gate challenge

*If implementation were perfect but this product definition were wrong, would we still fail the
user?* The one way: if "family" were defined as the unit of statistical correction. It is not —
family is lineage, trials are the correction, and they are separate throughout.
