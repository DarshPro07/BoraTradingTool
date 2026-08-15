# Gate 0 — what the funnel already has (inventoried 2026-08-15, all STATICALLY_CONFIRMED unless marked)

## The owner's chain exists, exactly

`research_campaigns` (name, question, closedAt) → `strategy_families` (economicHypothesis,
mechanism, allowedVariantDimensions, declarationHash) → `strategy_identity` (per-spec
classification + validationEligible) → `selection_trials` (one row per configuration tested,
campaign+family FKs, dataset-snapshot pin, selectionEligible). The multiple-testing denominator
the owner's DSR citation requires is a first-class ledger, not a convention.

## Typed rejection attribution exists PER TRIAL, unaggregated

`TRIAL_KINDS` (lib/knowledge/types.ts): `replay, walk_forward, monte_carlo, cost_stress,
no_trade_comparison, causality, parameter_stability` (repeatable gauntlet stages) +
`sealed_holdout` (one-shot). Every gauntlet stage records verdict pass|fail + a REASON string +
METRICS (lib/strategy/gauntlet.ts `stage(...)`). The owner's "GAUNTLET REJECTIONS by cause"
table is a GROUP BY over `trials` that nothing computes today.

## The KPI columns are persisted

`validation_results`: oosProfitFactor, **pbo**, **deflatedSharpe**, costMultiplePf,
trialsCounted, passed, detail. Gauntlet gates on `minDeflatedSharpe: 0.95` over `priorTrials`
(the family's spent-trial count). Forward: `forward_challengers/signals/signal_outcomes`
(trigger-immutable, WS1). Paper: `paper_forward_accounts/orders/position_outcomes`. Experiments:
append-only `experiments` + `experiment_trades`.

## The lifecycle ladder IS the funnel's back half

`lib/strategy/lifecycle.ts Stage`: draft → rehearsed → validated → holdout_cleared →
paper_forward → owner_review | graveyard — with `advanceStrategy` deriving standing from
evidence rows, never storing a second fact. `promotion.ts` ranks by this order.

## Costs: the owner's requirement is already the design

`lib/paper/cost-model.ts` + `lib/paper/fees.ts`: **effective-dated schedules**
(NO_SCHEDULE_IN_FORCE refusal when no schedule covers a date), per-leg statutory stack, the flat
DP charge modelled conservatively (₹15.93/scrip/day dominates at ₹1,000 notional),
"understating cost is the one direction a cost model must never err". Gauntlet's `cost_stress`
runs at 2× costs. External sources now recorded in `docs/external/india-equity-costs.md`.

## Aggregations that exist today

- `lib/dashboard/queries.ts researchFunnel()`: sources → claims → hypotheses → specs byStatus
  (the funnel's FRONT half), rendered on /edge-factory and /research. NOT campaign/family-aware,
  no rejection-cause grouping, stops at spec status.
- `strategyLab()`: per-spec trials + latest validation (DSR/PBO visible per spec).
- `/brain` panels: runtime, system, lanes, knowledge, RECENT WORK (executions), activity, audit.
  **No funnel, no quant KPIs.**

## Universe

`nse_securities` + `nse_listing_versions` + `nse_security_aliases` + `nse_provider_mappings` +
`security_master_syncs`. The deterministic fresh-install bootstrap is the ENGINE LANE's release
item (WORK_QUEUE); universe-coverage counting must state its basis (securities present vs
researchable-with-bars) rather than pretend.

## Missing (the gap a first slice fills) — all read-model, freeze-compatible

1. A campaign/family-keyed funnel aggregation across the 12 stages with counts per stage.
2. Typed rejection attribution AGGREGATED (per family/campaign): GROUP BY failed trial kind +
   graveyard reasons — the owner's "Cost negative 14 / DSR failed 5 / …" table.
3. /brain scoreboard panel rendering 1+2 plus the persisted KPIs (trials spent, gauntlet
   survival %, DSR/PBO of latest validations, holdout consumption, forward counts, paper net).
4. Family catalogue seeding is a WORKFLOW act (campaigns/families are created at research time);
   the catalogue text lives in 02-product.md — no schema work needed.

## UNKNOWN (verify before building against)

- Per-cost-component attribution per trade (statutory components individually persisted?) —
  experiment_trades/paper ledger hold P&L; component breakdown unverified.
- Regime segmentation for the regime-stability KPI — monte_carlo/causality stages exist;
  explicit regime labels unverified.
- "API/model cost per survivor" needs an agent_runs→campaign join that may not exist.

## Conclusion

The first build leg is a READ MODEL + one /brain panel — no new tables, no new subsystem, no
writer changes. It makes the machine's already-recorded truth legible in the owner's funnel
shape. Everything else (universe bootstrap, regime KPI, cost attribution) either belongs to the
engine lane or needs its own reality check first.
