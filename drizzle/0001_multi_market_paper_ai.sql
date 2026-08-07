CREATE TABLE IF NOT EXISTS instruments (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL CHECK (market IN ('US', 'IN')),
  exchange TEXT NOT NULL CHECK (exchange IN ('XNAS', 'XNYS', 'XNSE', 'XBOM')),
  symbol TEXT NOT NULL,
  provider_symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  timezone TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('EQUITY', 'ETF')),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_accounts (
  currency TEXT PRIMARY KEY CHECK (currency IN ('USD', 'INR')),
  starting_cash REAL NOT NULL CHECK (starting_cash >= 0),
  cash REAL NOT NULL CHECK (cash >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id TEXT NOT NULL REFERENCES instruments(id),
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  order_type TEXT NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT')),
  limit_price REAL,
  status TEXT NOT NULL,
  quote_price REAL NOT NULL,
  fill_price REAL,
  fees REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  reason TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  filled_at INTEGER
);

CREATE TABLE IF NOT EXISTS paper_positions (
  instrument_id TEXT PRIMARY KEY REFERENCES instruments(id),
  quantity REAL NOT NULL CHECK (quantity >= 0),
  average_cost REAL NOT NULL CHECK (average_cost >= 0),
  realized_pnl REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  instrument_id TEXT,
  order_id INTEGER,
  entry_type TEXT NOT NULL,
  cash_delta REAL NOT NULL,
  quantity_delta REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  question TEXT,
  snapshot_hash TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  provider_request_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_instruments_market ON instruments(market, exchange, symbol);
CREATE INDEX IF NOT EXISTS idx_paper_orders_created ON paper_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_ledger_created ON paper_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_instrument ON ai_runs(instrument_id, started_at DESC);

INSERT OR IGNORE INTO paper_accounts (currency, starting_cash, cash, updated_at)
VALUES ('USD', 100000, 100000, unixepoch());
INSERT OR IGNORE INTO paper_accounts (currency, starting_cash, cash, updated_at)
VALUES ('INR', 10000000, 10000000, unixepoch());
