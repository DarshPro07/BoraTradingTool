-- Slice 13b: every quantitative decision reproducible from an explicit immutable manifest.
--
-- experiments.manifest      — the full manifest JSON (strategy version, snapshot, engine, broker
--                             profile, fee model, calendar version, seed, code fingerprint, time).
-- selection_trials          — each trial pins the dataset snapshot its evidence came from.
-- holdout_access            — each holdout grant pins the snapshot the query ran against.
-- rehearsal_outcomes        — each rehearsal verdict pins the snapshot it was judged on.
--
-- All additive; nothing is rewritten. Legacy rows keep NULL — visibly pre-manifest, never
-- backfilled with a guess.

ALTER TABLE experiments ADD COLUMN manifest TEXT;
ALTER TABLE selection_trials ADD COLUMN dataset_snapshot_id TEXT;
ALTER TABLE holdout_access ADD COLUMN dataset_snapshot_id TEXT;
ALTER TABLE rehearsal_outcomes ADD COLUMN dataset_snapshot_id TEXT;
