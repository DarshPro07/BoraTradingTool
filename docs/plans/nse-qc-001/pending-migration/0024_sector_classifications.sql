-- NSE sector classification as EFFECTIVE-DATED REFERENCE DATA, not a stock attribute.
--
-- NSE reviews its four-level classification (Macro-Economic Sector → Sector → Industry → Basic
-- Industry) annually, and reclassifies after corporate events such as mergers and demergers. A
-- classification is therefore a fact with a date attached, and superseding one must not erase
-- what an earlier experiment was judged under — the same reasoning the listing-version table
-- already applies to identity.
--
-- Append-only: a new observation supersedes by closing the previous row's effective window
-- rather than by overwriting it.

CREATE TABLE IF NOT EXISTS sector_classifications (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  isin                  TEXT NOT NULL,
  instrument_id         TEXT NOT NULL,
  symbol                TEXT NOT NULL,
  -- NSE's four levels. Only the levels the source actually states are filled; the rest stay NULL
  -- rather than being inferred from a neighbouring level.
  macro_sector          TEXT,
  sector                TEXT,
  industry              TEXT,
  basic_industry        TEXT,
  -- Provenance, exactly as for candles.
  source                TEXT NOT NULL,
  source_url            TEXT,
  source_effective_date TEXT NOT NULL,
  fetched_at            INTEGER NOT NULL,
  -- ISIN_AND_SYMBOL_MATCHED | ISIN_MATCHED_SYMBOL_DIFFERS — an unmatched row is never written.
  identity_verification TEXT NOT NULL,
  -- Effective window. NULL effective_to = the current classification.
  effective_from        INTEGER NOT NULL,
  effective_to          INTEGER
);

CREATE INDEX IF NOT EXISTS sector_classifications_current
  ON sector_classifications (isin, effective_to);
CREATE INDEX IF NOT EXISTS sector_classifications_instrument
  ON sector_classifications (instrument_id, effective_to);

CREATE TRIGGER IF NOT EXISTS sector_classifications_no_delete
BEFORE DELETE ON sector_classifications
BEGIN SELECT RAISE(ABORT, 'sector_classifications is append-only; supersede by closing the effective window'); END;
