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
  -- WHAT THE SOURCE LITERALLY SAID, kept separately from what we concluded it means. The index
  -- CSV's column is named "Industry"; its values are NOT NSE's Industry level. Storing the raw
  -- label beside its field name means a future correction to the interpretation never has to
  -- guess what the file actually contained.
  raw_label             TEXT NOT NULL,
  raw_field             TEXT NOT NULL,
  -- NSE's four official levels. Filled ONLY where the mapping is proven; the rest stay NULL
  -- rather than being inferred from a neighbouring level.
  --
  -- normalized_sector and sector_code are populated because the mapping WAS verified against
  -- NSE Indices' published "Industry Classification Structure" (March 2022): its 22 sector codes
  -- and labels match the 22 distinct CSV values bijectively, 22/22, with nothing unmatched in
  -- either direction. Industry and basic industry are absent from the source and stay NULL.
  macro_sector          TEXT,
  sector_code           TEXT,
  normalized_sector     TEXT,
  industry              TEXT,
  basic_industry        TEXT,
  -- How the normalized levels were arrived at: PROVEN_AGAINST_NSE_STRUCTURE when the label
  -- matched the published taxonomy, UNMAPPED when it did not (and then normalized_* stay NULL).
  normalization_basis   TEXT NOT NULL,
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
