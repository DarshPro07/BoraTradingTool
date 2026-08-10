# Gate 4 — Vertical slices

| # | Slice | Verified by | State |
|---|---|---|---|
| 1 | Classifier over the three real hypotheses | 10 unit tests; live probe against the owner database | complete |
| 2 | Threshold extraction with evidence strings | gap_pct gte 3, rvol gte 1 read from the text itself | complete |
| 3 | DSL emission that the compiler accepts | `compileStrategy` returns ok, features `gap_pct, rvol` | complete |
| 4 | Authoring driver — declare family from hypothesis, write draft, place it | not started | deferred |

## Two defects the real-data fixtures caught

Both were found because the tests use the actual hypotheses rather than invented ones.

**Meta markers were matched against the rationale.** A rationale explains *why this system should
care*, so it says "this system" about almost any hypothesis. The model-disagreement hypothesis was
therefore classified `NOT_A_TRADING_RULE` — the right refusal for the wrong reason, which would have
hidden a legitimate "we lack this data" finding behind "this is not a strategy". Fixed by scanning
title and statement only: the *subject* of a hypothesis lives there.

**The lookahead window crossed a sentence boundary.** *"Relative volume matters. Separately, we hold
at most 4 positions"* produced `rvol lte 4` — a threshold from an unrelated clause, which is exactly
the fabrication this module exists to prevent. Fixed by clipping at `". "` / `"; "` rather than
`"."`, so a decimal like `3.5` survives.

## Why slice 4 is deferred rather than done

Writing specs is the easy half and the reversible one; the classifier is the half that had to be
right. Deferring it keeps this feature's blast radius at zero — nothing imports the module yet — and
the authoring step now has a proven classifier to build on rather than being written blind.
