-- Official-source NSE security master.
--
-- ISIN is the durable security identity. Symbol, name, series, and listing status are dated
-- observations. Existing MARKET:EXCHANGE:SYMBOL ids remain operational aliases so this additive
-- migration does not rewrite candles, paper rows, URLs, or experiment evidence.

CREATE TABLE IF NOT EXISTS security_master_syncs (
  id                TEXT PRIMARY KEY,
  observed_at       INTEGER NOT NULL,
  started_at        INTEGER NOT NULL,
  completed_at      INTEGER,
  status            TEXT NOT NULL CHECK (status IN ('STARTED', 'SUCCEEDED', 'FAILED')),
  source_manifest   TEXT NOT NULL,
  main_row_count    INTEGER NOT NULL DEFAULT 0,
  sme_row_count     INTEGER NOT NULL DEFAULT 0,
  total_rows        INTEGER NOT NULL DEFAULT 0,
  error_code        TEXT,
  error_message     TEXT,
  actor             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_master_syncs_observed
  ON security_master_syncs (observed_at DESC, started_at DESC);

CREATE TABLE IF NOT EXISTS nse_securities (
  isin               TEXT PRIMARY KEY,
  first_observed_at  INTEGER NOT NULL,
  last_observed_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nse_listing_versions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  isin              TEXT NOT NULL REFERENCES nse_securities(isin),
  exchange          TEXT NOT NULL DEFAULT 'XNSE' CHECK (exchange = 'XNSE'),
  symbol            TEXT NOT NULL,
  name              TEXT NOT NULL,
  series            TEXT NOT NULL,
  asset_type        TEXT NOT NULL CHECK (asset_type IN ('EQUITY', 'ETF', 'REIT', 'INVIT')),
  listing_status    TEXT NOT NULL CHECK (listing_status IN ('LISTED', 'SUSPENDED', 'DELISTED', 'INACTIVE')),
  date_of_listing   TEXT,
  paid_up_value     REAL,
  market_lot        INTEGER,
  face_value        REAL,
  effective_from    INTEGER NOT NULL,
  effective_to      INTEGER,
  source_sync_id    TEXT NOT NULL REFERENCES security_master_syncs(id),
  UNIQUE (isin, exchange, effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nse_listing_current_security
  ON nse_listing_versions (isin, exchange)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_nse_listing_current_search
  ON nse_listing_versions (exchange, symbol, series, listing_status)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_nse_listing_as_of
  ON nse_listing_versions (effective_from, effective_to, listing_status);

CREATE TABLE IF NOT EXISTS nse_security_aliases (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  isin               TEXT NOT NULL REFERENCES nse_securities(isin),
  exchange           TEXT NOT NULL DEFAULT 'XNSE' CHECK (exchange = 'XNSE'),
  alias_type         TEXT NOT NULL CHECK (alias_type IN ('SYMBOL', 'NAME', 'PROVIDER_SYMBOL')),
  alias              TEXT NOT NULL,
  first_observed_at  INTEGER NOT NULL,
  last_observed_at   INTEGER NOT NULL,
  source_sync_id     TEXT NOT NULL REFERENCES security_master_syncs(id),
  UNIQUE (isin, exchange, alias_type, alias)
);

CREATE INDEX IF NOT EXISTS idx_nse_alias_security ON nse_security_aliases (isin, alias_type);
CREATE INDEX IF NOT EXISTS idx_nse_alias_lookup ON nse_security_aliases (exchange, alias_type, alias, last_observed_at DESC);

CREATE TABLE IF NOT EXISTS nse_provider_mappings (
  provider                TEXT NOT NULL,
  isin                    TEXT NOT NULL REFERENCES nse_securities(isin),
  provider_instrument_id  TEXT,
  provider_symbol         TEXT,
  availability            TEXT NOT NULL CHECK (availability IN ('AVAILABLE', 'UNAVAILABLE', 'UNKNOWN')),
  verified_at             INTEGER,
  source                  TEXT,
  PRIMARY KEY (provider, isin)
);

CREATE TRIGGER IF NOT EXISTS nse_listing_versions_no_delete
BEFORE DELETE ON nse_listing_versions
BEGIN
  SELECT RAISE(ABORT, 'nse_listing_versions is historical evidence and cannot be deleted.');
END;

CREATE TRIGGER IF NOT EXISTS security_master_syncs_no_delete
BEFORE DELETE ON security_master_syncs
BEGIN
  SELECT RAISE(ABORT, 'security_master_syncs is an audit ledger and cannot be deleted.');
END;
