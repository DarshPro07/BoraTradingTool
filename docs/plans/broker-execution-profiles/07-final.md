# Final — broker execution profiles, fee broker-axis, capital/margin feasibility

**Verdict: VERIFIED** (exclusions stated in `06-verification.md`)

## Objective

Replace the hardcoded, unsourced 15:20 square-off with effective-dated, sourced broker execution
profiles; give the fee engine a broker dimension; build a per-instrument capital/margin
feasibility engine. Fail closed everywhere a profile is missing; state every assumption.

## What shipped

| Piece | File | Core property |
|---|---|---|
| Execution profiles | `lib/broker/execution-profile.ts` | 4 dated records with source URL, retrieval date, confidence tier, assumptions list; union-typed resolution that cannot be read without handling absence |
| Engine consumption | `lib/backtest/{engine,portfolio}.ts` | deadline resolved per run from the bars' own dates; `EXECUTION_PROFILE_UNAVAILABLE` / `PROFILE_WINDOW_MISMATCH` refusals; `execution` assumptions returned with every intraday result |
| DSL | `lib/strategy/dsl.ts` | squareOffAt validated against the profile; compile warning carries broker, deadline, provenance and scope limits; COMPILER_VERSION → 1.4.0 |
| Fee broker-axis | `lib/paper/cost-model.ts` | rows carry an explicit broker; Upstox intraday priced as a brokerage delta; cross-broker borrowing refused |
| Feasibility | `lib/paper/feasibility.ts` | per-instrument, cash-based verdict, leverage as a labelled 5x bound, margin honestly null, forced-close charge surfaced |
| Kite boundary | `lib/broker/kite-contract.ts` | types + env-presence only; credentials never via chat; explicitly not integration-tested |

## The correction at the centre of it

The old constant said 15:20 and claimed to be Zerodha's rule. Zerodha's fetched documentation says
**15:25** for non-CAS equity — and also 15:10 for CAS stocks, 15:26 for F&O, a Rs 50+GST forced-
close charge, and a volatility caveat. Every intraday backtest until today exited five minutes
early and refused square-off declarations (15:21–15:24) the broker actually permits. A test now
documents the corrected acceptance, and the mutation check proves the suite would catch the
constant coming back.

## Evidence

1,287 unit tests / 100 files / 0 failed · 66 browser tests on a fresh database / 0 failed ·
typecheck clean · build clean · mutation check failed-then-passed · Zerodha source independently
fetched during Gate 0.

## Unresolved limitations

Per-stock VaR+ELM margins not held (leverage stays a bound); Upstox figures owner-review-reported;
no historical profile windows before 2024 (refusal, not backfill); Kite adapter unimplemented by
design pending credentials via local env and owner-gated policy change.

## Rollback

`git revert` of one commit-set; the new modules have no persistence and no migration.
