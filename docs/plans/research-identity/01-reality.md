# Gate 0 — Reality

Evidence labels: REPRODUCED / STATICALLY_CONFIRMED / OBSERVED / INFERRED / SUSPECTED / UNKNOWN.

## The defect

**REPRODUCED.** Every strategy spec in the owner's database has `hypothesis_id = NULL`:

```
gap_largecap_premarket         NULL
gap_smallcap_premarket         NULL
sma_cross_20_50                NULL
largecap_momentum              NULL
rsi_reversion_30               NULL
sma_cross_ui_probe             NULL
orb_nse_5m                     NULL
first_hour_momentum_nse_5m     NULL
```

**STATICALLY_CONFIRMED.** `countSelectionTrials` (`lib/strategy/gauntlet.ts:108`) builds
`familyIds` from `specId` plus every sibling sharing its `hypothesisId`. With the column null, the
set is `{specId}` — a family of one. The deflated Sharpe ratio is therefore computed with `N = 1`
for every strategy in the system, where `N` is meant to be the number of configurations the search
actually tried.

The mechanism is correct and the wiring is absent. The file's own comment describes the earlier bug
it replaced (counting gate rows rather than evaluations) and states that deflating against the
family "is what actually controls false discovery".

## The second defect

**STATICALLY_CONFIRMED.** `requestHoldout` (`lib/strategy/gauntlet.ts:384`) filters on
`and(eq(holdoutId), eq(strategySpecId))`. The sealed-holdout budget is keyed per spec id, so a new
spec id — from a rename, a copy or a new version — receives a fresh look at data that may be looked
at once.

**REPRODUCED.** This is not merely permitted, it is *asserted as intended* by
`lib/strategy/strategy.test.ts:350`:

```
it("tracks budgets per strategy, not globally", () => {
  expect(requestHoldout("holdout_2026", first, "worker").granted).toBe(true);
  expect(requestHoldout("holdout_2026", second, "worker").granted).toBe(true);
});
```

Repairing the behaviour requires changing that test, which is the honest signal that a contract is
changing rather than a bug being patched.

## What already works and must not be rebuilt

- **OBSERVED.** `holdout_ledger` is append-only, enforced by a database trigger — proven by the
  existing test `"cannot be reset by deleting ledger rows"`, which expects a throw matching
  `/append-only/i`.
- **STATICALLY_CONFIRMED.** The fee model is already effective-dated: `FeeSchedule` carries
  `effectiveFrom` / `effectiveTo` and `feeSchedule(market, product, at: Date)` selects by date
  (`lib/paper/cost-model.ts:51–125`). The review's suggestion to "replace the static 0.29% floor
  with a fee engine" was based on a misreading of a *brief*, not the code; 0.29% is that engine's
  computed output. The real gap is narrower: no broker dimension, and the schedules are TypeScript
  literals rather than data.
- **STATICALLY_CONFIRMED.** `lib/governance/policy.ts` denies `run_gauntlet` by default (absent
  from `AUTONOMOUS_PERMITTED`) and is protected from self-amendment.

## Constraints discovered

- **REPRODUCED.** `MIGRATIONS` in `lib/db/migrate.ts` is a hardcoded array, and that file is
  protected. A new `.sql` file in `drizzle/` is silently skipped unless registered.
- **REPRODUCED.** `lib/db/migrate.test.ts:70` reads `drizzle/` and asserts every `.sql` file is
  registered — the guard against exactly that trap. Adding an unregisterable migration to
  `drizzle/` turns a correct guard red. Hence `drizzle/pending/`.
- **STATICALLY_CONFIRMED.** `strategy_specs` is read with `SELECT *` throughout the application, so
  `ALTER TABLE strategy_specs ADD COLUMN` in an unregistered migration would break every read on
  any database where it has not run. Identity therefore lives in a side table.

## What is NOT wrong

- **STATICALLY_CONFIRMED.** Trial counting does not count gauntlet stages. That was a prior bug and
  is already fixed; the review's item 4 asked for an audit, and the audit's answer is "mechanism
  correct, identity missing".

## Gate question

*Do I understand reality well enough to design the correct product?* — Yes. Both defects are
reproduced, the enforcement points are located, the protected-file constraints are known, and one
review item has been checked and found already-correct rather than accepted on assertion.
