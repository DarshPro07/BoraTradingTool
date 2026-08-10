# Gate 4 — Vertical slices

| # | Slice | Verified by | State |
|---|---|---|---|
| 1 | **Freeze** — halt irreversible spending at both production doors | `research-freeze.test.ts` (6), e2e 423 from the running app | complete |
| 2 | **Fingerprints** — semantic (structure) and configuration (structure + parameters) | 4 unit tests incl. reorder stability | complete |
| 3 | **Identity + fail-closed standing** — schema-absent, identity-absent, unconfirmed | T7, T7b, and the "state production is actually in" test | complete |
| 4 | **Ledgers** — selection trials counted per configuration; holdout gated twice, atomically | T1, T2, T2b, T3–T6, T8, T11, control | complete |
| 5 | **Backfill** — classify the eight existing specs | 2 placed, 6 recorded UNCLASSIFIED; verified on a database copy | complete |
| 6 | **Cut over** — `runGauntlet` records + counts from the ledger, holdout gated twice | 226 strategy/backtest tests; 66 e2e | complete |

Slices 1–4 were each verified before the next began. Slice 4 exposed the `accessId` collision,
which was fixed inside the slice rather than deferred.

## What slice 6 actually changed

`runGauntlet` now, in order: refuses a spec with no confirmed identity (`ResearchIdentityMissing`,
thrown not returned); **records the attempt to the selection ledger before computing anything from
it**, so an abandoned run still costs the family its bar; counts the denominator from that ledger,
floored by historical validation rows +1 for families predating it; and gates the sealed holdout
through `requestHoldoutAccess`, which requires both the family and campaign budgets to permit.

Twenty-one existing tests broke, every one of them validating a strategy that belonged to nothing.
They were updated to declare identity rather than the guard being relaxed — a test that cannot
express the new precondition is a test describing the old contract.
