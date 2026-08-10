# Gate 2 — Architecture

## Current architecture

`strategy_specs` is the only identity. `validation_results` and `trials` reference it. Holdout
accounting lives in `holdout_ledger`, keyed `(holdout_id, strategy_spec_id)`. The deflated Sharpe
denominator is computed on the fly by `countSelectionTrials` walking `hypothesisId` siblings.

## Proposed fit

A new identity layer beside `strategy_specs`, and two new ledgers. Nothing existing is rewritten.

```
ResearchCampaign            statistical search universe
   └── StrategyFamily       one economic hypothesis + its variants
         └── StrategyIdentity   (spec ↔ campaign/family, confirmed by a human)
               ├── SelectionTrial    one tested configuration   → the DSR denominator
               └── HoldoutAccess     one look at sealed data    → gated twice
```

## The distinction the design rests on

**Family ≠ trial count.** A family is methodological lineage. A selection trial is one
configuration that was tested and allowed to influence which candidate won. Ten opening-range
variants are ONE family and TEN selection trials.

Keying the denominator to the family label would understate `N` exactly as badly as keying it to
the spec id does today. So they are separate tables, counted by separate functions, and no code
path derives one from the other.

## Data flow

```
DSL ──semanticFingerprint──→ structure, parameters stripped   → anti-evasion signal
    └─configurationFingerprint→ structure + parameters        → selection trial identity

spec → strategy_identity → (campaign, family)
                              ├→ selection_trials  → COUNT(distinct config) = N
                              └→ holdout_access    → UNIQUE(gen, campaign)
                                                     UNIQUE(gen, family)
```

## Interfaces

- `researchIdentityReady()` — are the tables installed?
- `identityFor(specId)` / `validationStanding(specId)` — fail-closed placement
- `recordSelectionTrial(...)` — idempotent on configuration fingerprint
- `selectionTrialCount(specId)` — `{known:false}` rather than a number when identity is missing
- `requestHoldoutAccess(...)` — two gates, atomic

## Data

`research_campaigns`, `strategy_families`, `strategy_identity`, `selection_trials`,
`holdout_access`. Side table rather than columns on `strategy_specs` — that table is read with
`SELECT *` everywhere, and the migration cannot register itself.

## Failure paths

| Condition | Behaviour |
|---|---|
| tables absent (today) | `researchIdentityReady()` false → everything refuses |
| spec has no identity | refuse; no default denominator |
| classification unconfirmed | refuse validation |
| crash mid-holdout-request | entitlement already consumed; result lost, look recorded |
| two concurrent requests | UNIQUE index settles it; exactly one wins |

## Security / trust boundaries

Enforcement is in the database, not application logic. The budgets are UNIQUE indexes; the ledgers
are append-only by trigger. A future caller that forgets to consult the helper still cannot
double-spend. Deleting trial evidence remains permanently prohibited.

## Compatibility

Purely additive. With the migration unregistered the system behaves as "no strategy has identity",
which blocks validation — safe, and already the state the freeze enforces anyway.

## Alternatives considered

- **Columns on `strategy_specs`** — rejected: breaks every `SELECT *` read until registered.
- **Derived family from structure alone** — rejected: cannot recover intent. `EMA(9,21)` and
  `EMA(10,22)` are one family with different hashes; one hash can serve two hypotheses.
- **Declared family alone** — rejected: a creatively named "new family" mints fresh budget.
- **Chosen: declared identity + derived consistency check**, defaulting to SAME_FAMILY on doubt.
- **Application-level budget checks** — rejected: not atomic under concurrency.

## Architecture risks

- Family declarations depend on honest human input; the fingerprint mitigates but cannot replace it.
- Campaign-level gating may prove too strict in practice; it is deliberately the conservative
  direction, since over-merging costs power while under-merging destroys validity.
