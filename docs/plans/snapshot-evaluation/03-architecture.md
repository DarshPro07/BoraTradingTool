# Gate 2 — Architecture

## The one door
`ResearchDatasetSource = (market, resolution) => SnapshotResult | SnapshotRefusal` — the ONLY
shape rehearsal and auto-gauntlet accept. A snapshot result carries dataset + id + fingerprint;
a provider window cannot satisfy the type honestly because it has no identity to offer. The
default source is `snapshotFromStore` (canonical store, item 13).

`runGauntlet` enforces the same at the choke point: evidence without
`datasetSnapshotId`+`datasetFingerprint` throws `DatasetIdentityMissing` BEFORE the trial is
recorded (mapped to 412 at the route). Both callers now build evidence via `snapshotFromStore`
and `runPortfolioBacktest(dsl, snapshot.dataset, {datasetFingerprint, datasetSnapshotId})`.

## The manifest
`lib/research-data/manifest.ts` — `buildManifest` assembles the owner's nine fields from single
sources of truth: `COMPILER_VERSION`, `FEE_MODEL_ID` (new, cost-model), `MARKET_CALENDAR_VERSION`
(new, calendar), `BATTERY_SEED` (re-exported from the battery's own gates). Stored verbatim as
JSON in `experiments.manifest` (migration 0010) by `recordExperiment`; written by rehearsal
(kind "rehearsal") and gauntlet (kind "gauntlet"), idempotent on (spec, snapshot, kind, engine).

## Identity propagation
0010 adds `dataset_snapshot_id` to `selection_trials`, `holdout_access`, `rehearsal_outcomes`.
Gauntlet threads it into `recordSelectionTrial` and `requestHoldoutAccess`; the cycle persists it
with each rehearsal verdict; the route returns it; `RunGauntletButton` and the new
`RehearsalLedger` panel display it. `experiments.dataset_snapshot_id` has a real FK — an
experiment cannot reference a dataset that was never recorded, in production or in tests.

## Economics fail-closed
`costVerdictOrBlocked` (promotion) converts `CostModelError` into `understated: true` with the
block stated — the one direction the ladder never forgives — instead of crashing `evidenceFor`.
Display-abstention (inspector) and decision-refusal (promotion) are now different behaviors on
purpose.

## Enforcement against regression (owner test 12)
`lib/research-data/no-provider-pin.test.ts` bans provider-machinery imports from the five
evaluation modules at the source level. Behavioral tests can miss a fallback on an unwalked
path; an import ban cannot.
