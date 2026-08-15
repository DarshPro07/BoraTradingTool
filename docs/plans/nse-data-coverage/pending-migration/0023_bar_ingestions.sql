-- The bar-ingestion ledger: what was ASKED FOR beside what ARRIVED.
--
-- Motivated by a real defect that hid for weeks: the intraday accumulator requested 59-day
-- windows while the provider layer silently built a one-day request, so coverage crawled one
-- session per day and nothing in the system could see the discrepancy — the fetch "succeeded"
-- every time. Storing the request beside the response makes silent truncation detectable the
-- next time a provider changes behaviour, instead of after someone notices the symptom.
--
-- Append-only, like every other evidence ledger here: an ingestion record is what happened, and
-- what happened is not editable.

CREATE TABLE IF NOT EXISTS bar_ingestions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id       TEXT NOT NULL,
  resolution          TEXT NOT NULL,
  source              TEXT NOT NULL,
  -- The request, exactly as issued.
  requested_start     INTEGER NOT NULL,
  requested_end       INTEGER NOT NULL,
  -- The response, exactly as it arrived (nulls when nothing came back).
  returned_first_bar  INTEGER,
  returned_last_bar   INTEGER,
  returned_bar_count  INTEGER NOT NULL,
  -- What reached the canonical store after validation and dedupe.
  inserted            INTEGER NOT NULL DEFAULT 0,
  skipped             INTEGER NOT NULL DEFAULT 0,
  rejected            INTEGER NOT NULL DEFAULT 0,
  -- MATCHED | UNSTATED — a MISMATCHED response throws before anything is written, so it cannot
  -- appear here with bars attached; it is recorded with returned_bar_count 0 and the reason.
  identity_verdict    TEXT NOT NULL,
  -- COMPLETE | PARTIAL | SESSION_GAPS | DUPLICATES | OUT_OF_SESSION | TIMEZONE_ERROR | EMPTY
  completeness        TEXT NOT NULL,
  expected_sessions   INTEGER,
  observed_sessions   INTEGER NOT NULL DEFAULT 0,
  duplicate_timestamps INTEGER NOT NULL DEFAULT 0,
  out_of_session_bars INTEGER NOT NULL DEFAULT 0,
  short_sessions      INTEGER NOT NULL DEFAULT 0,
  detail              TEXT,
  ingested_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS bar_ingestions_instrument
  ON bar_ingestions (instrument_id, resolution, ingested_at DESC);

CREATE TRIGGER IF NOT EXISTS bar_ingestions_no_update
BEFORE UPDATE ON bar_ingestions
BEGIN SELECT RAISE(ABORT, 'bar_ingestions is immutable; an ingestion record is what happened'); END;

CREATE TRIGGER IF NOT EXISTS bar_ingestions_no_delete
BEFORE DELETE ON bar_ingestions
BEGIN SELECT RAISE(ABORT, 'bar_ingestions is append-only'); END;
