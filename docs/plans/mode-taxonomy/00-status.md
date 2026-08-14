# Mode Taxonomy Cleanup — Status

**Owner directive 2026-08-14:** *"the single-RUN direction is correct, but the implementation
should stop pretending there are four meaningful modes. Do not leave: API says OBSERVING /
runtime behaves EVOLVING — that is another truth defect. Clean the stale APIs/docs/types instead
of silently coercing legacy modes forever."*

## The defect (STATICALLY_CONFIRMED)

The inherited single-RUN refactor made `getLearningMode()` (protected `lib/governance/runtime.ts`)
coerce every stored value except `off` to `evolving`. So the runtime has ONE top-level RUN state,
but three surfaces still presented four:

| Surface | Was | Protected? |
|---|---|---|
| `getLearningMode()` coercion | THE ROOT — collapses 4→2 silently | ✅ protected |
| `LearningMode` type = 4 values | `off/observing/learning/evolving` (policy.ts) | ✅ protected |
| `GET /api/learning` | advertised 4 co-equal `modes` | ❌ FIXED this leg |
| `LearningModeControl.tsx` | RUN/OFF toggle | ❌ already single-AUTO (inherited) |
| CLAUDE.md "Learning mode" | `off → observing → learning → evolving` ladder | ❌ FIXED this leg |
| `cycle.ts` `mode === "learning"` branches | dead (evolving is a superset) | ❌ not protected |

## Fixed this leg (non-protected surfaces)

- `app/api/learning/route.ts`: GET now reports the EFFECTIVE mode + `auto: boolean` + honest
  `modes: ["off","evolving"]`; `enabled` is `mode === "evolving"` (no half-enabled middle tier).
  PATCH still ACCEPTS the four legacy values for backward compatibility but returns
  `{ requested, mode }` so a caller who sends "observing" is told plainly it resolved to
  "evolving" — the silent coercion is now an explicit, reported one.
- CLAUDE.md "Learning mode" section: rewritten to single-AUTO (RUN/OFF with concurrent lanes),
  governance facts preserved.

## Owner decision + protected change still owed

The ROOT lives in protected files and needs the owner to choose the FINAL shape:

**Option A — commit to single-AUTO (matches everything the owner has said).** In protected
`lib/governance/runtime.ts` + `lib/governance/policy.ts`: reduce `LearningMode` to
`"off" | "evolving"` (or rename to `"off" | "auto"`), delete the coercion (store only the two
real values), and drop the now-dead `mode === "observing" | "learning"` branches in
`lib/learning/cycle.ts`. This is the honest end state; the API/UI/docs already match it.

**Option B — restore four genuine tiers.** Delete the coercion and have the runtime honor the
stored value, re-enabling observing (read-only) and learning (no proposals) as real states. This
contradicts the owner's repeated single-RUN direction, so it is documented only for completeness.

Recommendation: **A.** The evidence (this whole conversation's single-RUN direction, the already-
single-AUTO UI) points one way. It needs a protected-file edit, which is why it is surfaced for
the owner rather than done autonomously alongside the non-protected honesty fixes.

## Verdict

Non-protected surfaces: HONEST as of this leg. Protected root: OWNER_DECISION_REQUIRED (Option A
recommended).
