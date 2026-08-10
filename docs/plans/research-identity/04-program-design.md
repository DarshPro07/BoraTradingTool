# Gate 3 — Program design

## Files

| File | Why |
|---|---|
| `drizzle/pending/0008_research_identity.sql` | new tables, UNIQUE budgets, append-only triggers. In `pending/` because it cannot be registered and `migrate.test.ts` guards `drizzle/`. |
| `lib/db/schema.ts` | drizzle definitions for the five new tables. Additive only. |
| `lib/strategy/research-identity.ts` | fingerprints, identity resolution, fail-closed validation standing, conflict detection |
| `lib/strategy/selection-ledger.ts` | trial recording/counting, two-gate atomic holdout entitlement |
| `lib/strategy/research-freeze.ts` | P0.0 — halt on irreversible spending during the repair |
| `app/api/strategy/gauntlet/route.ts` | enforce the freeze at the manual door |
| `lib/strategy/auto-gauntlet.ts` | enforce the freeze at the autonomous door |
| `scripts/classify-research-identity.mts` | read-only backfill classifier |
| `lib/strategy/research-identity.test.ts` | adversarial suite |
| `lib/strategy/research-freeze.test.ts` | pins the freeze active |

## Types and contracts

```
semanticFingerprint(dsl)      → string   structure only, parameters stripped
configurationFingerprint(dsl) → string   structure + parameters, name excluded

validationStanding(specId) → { eligible, identity, reason }
selectionTrialCount(specId)
  → { known: true,  trials, campaignId, familyId, reason }
  | { known: false, reason }                       // never a number
requestHoldoutAccess(req)
  → { granted: true, accessId }
  | { granted: false, code: NO_IDENTITY | FAMILY_BUDGET_SPENT
                          | CAMPAIGN_BUDGET_SPENT | SCHEMA_MISSING, reason }
freezeStanding(action) → { allowed, reason }
```

`selectionTrialCount` returning a union rather than a number is deliberate: `?? 1` at a call site
is the defect being repaired, and a number-returning signature invites it back at every call site
simultaneously.

## Call flows

**Trial.** `recordSelectionTrial` → `validationStanding` → refuse if no identity → fingerprint →
lookup existing by `(campaign, family, fingerprint)` → return `alreadyCounted` or insert.

**Holdout.** `requestHoldoutAccess` → schema check → identity check → family gate → campaign gate →
insert (UNIQUE is the real enforcement) → catch UNIQUE violation as a spent budget, not a crash.

## Error model

Every refusal returns a reason string. No refusal throws. No refusal defaults.

## Test design — with the failure mode each guards

| Test | Detects |
|---|---|
| T1 | denominator collapsing to 1 |
| T2 | re-runs inflating the denominator |
| T2b | siblings not counted against each other |
| T3–T6 | rename / copy / re-version / new-uuid restoring holdout budget |
| T8 | new family in a spent campaign restoring budget |
| control | gates too blunt — a legitimately new generation refused |
| T7 | missing or unconfirmed identity being validated |
| T11 | trial or access evidence being deleted |
| T12 | the suite failing to detect the original defect (mutation) |

## Least-confident decisions

1. Campaign-level gating at budget 1 may be too strict for long-running programmes. Chosen because
   the failure direction is asymmetric.
2. `semanticFingerprint` ignores `maxPositions` and sizing; a sizing-only change reads as the same
   structure. Believed correct — sizing is a variant dimension — but untested against real use.
3. Idempotency keyed on configuration fingerprint assumes a re-run is never a genuine second
   search. True for deterministic backtests; false if a stochastic component is added later.

## Rollback

Additive. Drop the five tables and delete two modules; nothing existing depends on them yet. The
freeze reverts by flipping one constant and its paired test.
