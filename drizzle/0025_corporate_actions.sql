-- The corporate-action ledger, and the price basis every snapshot must now declare.
--
-- Motivated by a defect measured in the production store on 2026-08-16: the canonical daily
-- series held TWO adjustment bases at once.
--
--   RELIANCE  2024-10-24 = 2655.70   beside   2024-10-27 = 1334.35
--   HDFCBANK  2025-08-24 = 1964.10   beside   2025-08-25 =  973.40
--
-- Yahoo retroactively adjusts its whole history at a corporate action; `persistCandles` is
-- idempotent by (ticker, resolution, time) and never revisits a stored bar. So bars written before
-- an action keep the old basis forever while later bars arrive on the new one, and a 1:2 split
-- presents as a -50% single-day drop with the long trend filter intact -- the strongest possible
-- trigger for the declared swing mean-reversion family, and not a market event.
--
-- The correction is NOT to rewrite stored prices. Raw traded prices are what execution simulation
-- and cost accounting need, and rewriting history in place is how the mixture happened. Instead
-- the ACTIONS are recorded here, normalization happens at read time into an explicitly declared
-- basis, and the resulting series is a new immutable generation with its own fingerprint.
--
-- Append-only, like every other evidence ledger here: a corporate action is what happened.

CREATE TABLE IF NOT EXISTS corporate_actions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id   TEXT NOT NULL,
  -- The FIRST bar at or after this instant trades on the new basis.
  effective_time  INTEGER NOT NULL,
  -- SPLIT | DIVIDEND
  kind            TEXT NOT NULL,
  -- SPLIT only: shares after per share before. A 2:1 split is 2.0, so prices divide by 2.
  ratio           REAL,
  -- DIVIDEND only: cash per share in the instrument's currency.
  amount          REAL,
  -- Provenance is not optional: `yahoo:events` is a declaration by the provider, `detected:store`
  -- is an inference from our own prices, and the two carry different authority.
  source          TEXT NOT NULL,
  evidence        TEXT,
  recorded_at     INTEGER NOT NULL,
  UNIQUE (instrument_id, effective_time, kind)
);

CREATE INDEX IF NOT EXISTS corporate_actions_instrument
  ON corporate_actions (instrument_id, effective_time);

CREATE TRIGGER IF NOT EXISTS corporate_actions_no_update
BEFORE UPDATE ON corporate_actions
BEGIN SELECT RAISE(ABORT, 'corporate_actions is immutable; an action is what happened'); END;

CREATE TRIGGER IF NOT EXISTS corporate_actions_no_delete
BEFORE DELETE ON corporate_actions
BEGIN SELECT RAISE(ABORT, 'corporate_actions is append-only'); END;

-- Every snapshot must now say which basis its prices are expressed in. A price series has no
-- meaning without it, and the whole defect above is what "implicit basis" costs.
--
-- RAW                 what actually traded -- the only honest basis for execution simulation
-- SPLIT_ADJUSTED      continuous across share-count changes, dividends untouched
-- TOTAL_RETURN        splits and distributions both
-- MIXED_CONTAMINATED  a series built before this contract existed, which may carry more than one
--                     basis. Existing rows are backfilled to this rather than being guessed at:
--                     claiming RAW for them would assert something never verified.
ALTER TABLE dataset_snapshots ADD COLUMN price_basis TEXT NOT NULL DEFAULT 'MIXED_CONTAMINATED';
