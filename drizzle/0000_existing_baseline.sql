CREATE TABLE IF NOT EXISTS stocks (
  ticker TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  exchange TEXT,
  sector TEXT,
  industry TEXT,
  market_cap REAL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS quote_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  price REAL NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  prev_close REAL,
  change REAL,
  change_pct REAL,
  volume INTEGER,
  avg_volume INTEGER,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  resolution TEXT NOT NULL,
  time INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume INTEGER,
  UNIQUE(ticker, resolution, time)
);

CREATE TABLE IF NOT EXISTS news_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT,
  headline TEXT NOT NULL,
  summary TEXT,
  source TEXT,
  url TEXT,
  sentiment REAL,
  published_at INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  spx_close REAL,
  spx_change REAL,
  spx_change_pct REAL,
  ndx_close REAL,
  ndx_change REAL,
  ndx_change_pct REAL,
  dji_close REAL,
  dji_change REAL,
  dji_change_pct REAL,
  market_status TEXT,
  sector_data TEXT,
  top_movers TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  catalysts TEXT,
  risk_level TEXT,
  thesis TEXT,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_analysis_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  pe REAL,
  eps REAL,
  revenue REAL,
  revenue_growth REAL,
  gross_margin REAL,
  net_margin REAL,
  debt_to_equity REAL,
  free_cash_flow REAL,
  rsi REAL,
  macd_line REAL,
  macd_signal REAL,
  macd_hist REAL,
  sma20 REAL,
  sma50 REAL,
  sma200 REAL,
  bb_upper REAL,
  bb_lower REAL,
  support REAL,
  resistance REAL,
  trend TEXT,
  analyst_buy INTEGER,
  analyst_hold INTEGER,
  analyst_sell INTEGER,
  price_target REAL,
  price_target_high REAL,
  price_target_low REAL,
  bull_signals TEXT,
  bear_signals TEXT,
  overall_signal TEXT,
  generated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_watchlist (
  ticker TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_config (
  id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'off',
  broker TEXT NOT NULL DEFAULT 'real',
  halt INTEGER NOT NULL DEFAULT 1,
  poll_minutes INTEGER NOT NULL DEFAULT 30,
  max_position_pct REAL NOT NULL DEFAULT 15,
  watchlist_only INTEGER NOT NULL DEFAULT 1,
  daily_trade_cap INTEGER NOT NULL DEFAULT 5,
  active_strategy_id INTEGER,
  telegram_bot_token TEXT,
  telegram_chat_id TEXT,
  telegram_last_offset INTEGER NOT NULL DEFAULT 0,
  robinhood_connected_at INTEGER,
  robinhood_account TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  risk_profile TEXT NOT NULL DEFAULT 'medium',
  max_position_pct REAL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'market',
  limit_price REAL,
  stop_loss REAL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  broker TEXT NOT NULL,
  thesis TEXT,
  est_price REAL,
  est_cost REAL,
  fill_price REAL,
  fence_check TEXT,
  rejection_reason TEXT,
  proposed_at INTEGER NOT NULL,
  decided_at INTEGER,
  filled_at INTEGER
);

CREATE TABLE IF NOT EXISTS robinhood_portfolio (
  id INTEGER PRIMARY KEY,
  account TEXT NOT NULL,
  account_number TEXT,
  total_value REAL,
  cash REAL,
  buying_power REAL,
  positions TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quote_ticker ON quote_snapshots(ticker, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_candles_ticker ON price_candles(ticker, resolution, time DESC);
CREATE INDEX IF NOT EXISTS idx_news_ticker ON news_articles(ticker, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_ticker ON stock_analysis_reports(ticker, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, proposed_at DESC);

UPDATE agent_config SET mode = 'off', halt = 1 WHERE id = 1;
