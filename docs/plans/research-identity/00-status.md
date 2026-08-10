# Research identity — status

**Feature slug:** `research-identity`
**Opened:** 2026-08-09, after external architecture review
**Current gate:** COMPLETE — all gates passed, both owner actions performed

## One-line objective

Make it impossible for renaming, copying, re-versioning or re-parameterising a strategy to erase
the statistical history that informed its selection.

## Gate progress

| Gate | Document | State |
|---|---|---|
| 0 · Reality | `01-reality.md` | complete |
| 1 · Product | `02-product.md` | complete |
| 2 · Architecture | `03-architecture.md` | complete |
| 3 · Program design | `04-program-design.md` | complete |
| 4 · Vertical slices | `05-slices.md` | all 6 complete |
| 5 · Verification | `06-verification.md` | complete |
| — · Final verdict | `07-final.md` | **VERIFIED** |

## Owner actions — both performed 2026-08-09

1. **Migration registered.** `0008_research_identity.sql` moved into `drizzle/` and added to
   `MIGRATIONS`. Verified applied by the runner: all five tables, both UNIQUE budget indexes and
   all three append-only triggers present in a fresh database.
2. **Families declared.** `sma_cross_20_50` and `sma_cross_ui_probe` placed together in
   `fam_sma_crossover` under campaign `camp_2026_intraday_india`. The other six left
   **UNCLASSIFIED and validation-ineligible** by instruction, each recorded as an audit event so
   "examined and could not be placed" is distinguishable from "nobody looked".

## Freeze lifted

Every condition in `RESEARCH_FREEZE.liftsWhen` is met and verified, so the halt was lifted the same
day it was imposed. The autonomous door remains closed independently — `run_gauntlet` is still
absent from `AUTONOMOUS_PERMITTED`, which is the permanent gate.

## Exact next action

**Feature complete.** Next, per ADR 0006 and the owner's instruction: autonomous research intake
(the "professor"). `enqueue()` in `lib/research/queue.ts` is called from exactly three places —
the MCP server, a human POST route, and one test — so the loop drains a queue only a human fills.
That is the narrowest gap between what exists and the self-researching system described.

## Deliberately not done

Automation stays off. No indicator library, no new strategies. Broker execution profiles, capital
feasibility, the broker axis on fee schedules and CI determinism all queue behind this — a system
that cannot say which strategies are related must not compute multiple-testing corrections for any
of them.
