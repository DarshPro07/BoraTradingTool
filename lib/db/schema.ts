import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const stocks = sqliteTable("stocks", {
  ticker: text("ticker").primaryKey(),
  name: text("name").notNull(),
  exchange: text("exchange"),
  sector: text("sector"),
  industry: text("industry"),
  marketCap: real("market_cap"),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const quoteSnapshots = sqliteTable("quote_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  price: real("price").notNull(),
  open: real("open"),
  high: real("high"),
  low: real("low"),
  prevClose: real("prev_close"),
  change: real("change"),
  changePct: real("change_pct"),
  volume: integer("volume"),
  avgVolume: integer("avg_volume"),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

export const priceCandles = sqliteTable("price_candles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  resolution: text("resolution").notNull(), // 1, 5, 15, 30, 60, D, W, M
  time: integer("time").notNull(), // unix timestamp
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: integer("volume"),
});

export const newsArticles = sqliteTable("news_articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker"), // null = general market news
  headline: text("headline").notNull(),
  summary: text("summary"),
  source: text("source"),
  url: text("url"),
  sentiment: real("sentiment"), // -1 to 1
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

export const marketBriefings = sqliteTable("market_briefings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  spxClose: real("spx_close"),
  spxChange: real("spx_change"),
  spxChangePct: real("spx_change_pct"),
  ndxClose: real("ndx_close"),
  ndxChange: real("ndx_change"),
  ndxChangePct: real("ndx_change_pct"),
  djiClose: real("dji_close"),
  djiChange: real("dji_change"),
  djiChangePct: real("dji_change_pct"),
  marketStatus: text("market_status"), // open, closed, pre-market, after-hours
  sectorData: text("sector_data"), // JSON
  topMovers: text("top_movers"), // JSON
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

export const watchlistSuggestions = sqliteTable("watchlist_suggestions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  name: text("name").notNull(),
  catalysts: text("catalysts"), // JSON array of strings
  riskLevel: text("risk_level"), // low, medium, high
  thesis: text("thesis"),
  addedAt: integer("added_at", { mode: "timestamp" }).notNull(),
});

export const stockAnalysisReports = sqliteTable("stock_analysis_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  // Fundamentals
  pe: real("pe"),
  eps: real("eps"),
  revenue: real("revenue"),
  revenueGrowth: real("revenue_growth"),
  grossMargin: real("gross_margin"),
  netMargin: real("net_margin"),
  debtToEquity: real("debt_to_equity"),
  freeCashFlow: real("free_cash_flow"),
  // Technicals
  rsi: real("rsi"),
  macdLine: real("macd_line"),
  macdSignal: real("macd_signal"),
  macdHist: real("macd_hist"),
  sma20: real("sma20"),
  sma50: real("sma50"),
  sma200: real("sma200"),
  bbUpper: real("bb_upper"),
  bbLower: real("bb_lower"),
  support: real("support"),
  resistance: real("resistance"),
  trend: text("trend"), // bullish, bearish, neutral
  // Analyst consensus
  analystBuy: integer("analyst_buy"),
  analystHold: integer("analyst_hold"),
  analystSell: integer("analyst_sell"),
  priceTarget: real("price_target"),
  priceTargetHigh: real("price_target_high"),
  priceTargetLow: real("price_target_low"),
  // Signals
  bullSignals: text("bull_signals"), // JSON
  bearSignals: text("bear_signals"), // JSON
  overallSignal: text("overall_signal"), // buy, hold, sell
  generatedAt: integer("generated_at", { mode: "timestamp" }).notNull(),
});

// User's persistent watchlist
export const userWatchlist = sqliteTable("user_watchlist", {
  ticker: text("ticker").primaryKey(),
  addedAt: integer("added_at", { mode: "timestamp" }).notNull(),
});

// --- Retired live-trading schema (preserved for existing database compatibility) ---

// Singleton (id = 1): historical configuration. Runtime live routes are disabled.
export const agentConfig = sqliteTable("agent_config", {
  id: integer("id").primaryKey(), // always 1
  mode: text("mode").notNull().default("off"), // legacy: off | confirm | autopilot
  broker: text("broker").notNull().default("real"), // legacy persisted value
  halt: integer("halt", { mode: "boolean" }).notNull().default(false),
  pollMinutes: integer("poll_minutes").notNull().default(30),
  // Trade Fence
  maxPositionPct: real("max_position_pct").notNull().default(15), // % of account per position
  watchlistOnly: integer("watchlist_only", { mode: "boolean" }).notNull().default(true),
  dailyTradeCap: integer("daily_trade_cap").notNull().default(5),
  activeStrategyId: integer("active_strategy_id"),
  // Notification Channel (Telegram)
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  telegramLastOffset: integer("telegram_last_offset").notNull().default(0),
  // Legacy broker liveness fields retained so old databases remain readable.
  robinhoodConnectedAt: integer("robinhood_connected_at", { mode: "timestamp" }),
  robinhoodAccount: text("robinhood_account"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Editable trading mandates (prompt + its mechanical limits).
export const strategies = sqliteTable("strategies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  riskProfile: text("risk_profile").notNull().default("medium"), // low | medium | high
  maxPositionPct: real("max_position_pct"), // optional per-strategy override of the fence
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Legacy order audit rows. No current route can authorize or fill these rows.
export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  side: text("side").notNull(), // buy | sell
  quantity: real("quantity").notNull(),
  orderType: text("order_type").notNull().default("market"), // market | limit
  limitPrice: real("limit_price"),
  stopLoss: real("stop_loss"),
  // pending | approved | rejected | filled | blocked | canceled
  status: text("status").notNull(),
  mode: text("mode").notNull(), // mode at time of proposal
  broker: text("broker").notNull(), // legacy persisted value
  thesis: text("thesis"),
  estPrice: real("est_price"), // quote at proposal time
  estCost: real("est_cost"),
  fillPrice: real("fill_price"),
  fenceCheck: text("fence_check"), // JSON: which limits were evaluated
  rejectionReason: text("rejection_reason"),
  proposedAt: integer("proposed_at", { mode: "timestamp" }).notNull(),
  decidedAt: integer("decided_at", { mode: "timestamp" }),
  filledAt: integer("filled_at", { mode: "timestamp" }),
});

// Legacy broker snapshot retained for existing database compatibility only.
export const robinhoodPortfolio = sqliteTable("robinhood_portfolio", {
  id: integer("id").primaryKey(), // always 1
  account: text("account").notNull(), // label, e.g. "Agentic"
  accountNumber: text("account_number"), // masked, e.g. "••••5267"
  totalValue: real("total_value"),
  cash: real("cash"),
  buyingPower: real("buying_power"),
  positions: text("positions"), // JSON array of { ticker, shares, avgCost, price?, marketValue? }
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
});

export const instruments = sqliteTable("instruments", {
  id: text("id").primaryKey(),
  market: text("market").notNull(),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  providerSymbol: text("provider_symbol").notNull().unique(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  timezone: text("timezone").notNull(),
  assetType: text("asset_type").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const securityMasterSyncs = sqliteTable("security_master_syncs", {
  id: text("id").primaryKey(),
  observedAt: integer("observed_at", { mode: "timestamp" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  status: text("status").notNull(),
  sourceManifest: text("source_manifest").notNull(),
  mainRowCount: integer("main_row_count").notNull().default(0),
  smeRowCount: integer("sme_row_count").notNull().default(0),
  totalRows: integer("total_rows").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  actor: text("actor").notNull(),
});

export const nseSecurities = sqliteTable("nse_securities", {
  isin: text("isin").primaryKey(),
  firstObservedAt: integer("first_observed_at", { mode: "timestamp" }).notNull(),
  lastObservedAt: integer("last_observed_at", { mode: "timestamp" }).notNull(),
});

export const nseListingVersions = sqliteTable("nse_listing_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  isin: text("isin").notNull(),
  exchange: text("exchange").notNull().default("XNSE"),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  series: text("series").notNull(),
  assetType: text("asset_type").notNull(),
  listingStatus: text("listing_status").notNull(),
  dateOfListing: text("date_of_listing"),
  paidUpValue: real("paid_up_value"),
  marketLot: integer("market_lot"),
  faceValue: real("face_value"),
  effectiveFrom: integer("effective_from", { mode: "timestamp" }).notNull(),
  effectiveTo: integer("effective_to", { mode: "timestamp" }),
  sourceSyncId: text("source_sync_id").notNull(),
});

export const nseSecurityAliases = sqliteTable("nse_security_aliases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  isin: text("isin").notNull(),
  exchange: text("exchange").notNull().default("XNSE"),
  aliasType: text("alias_type").notNull(),
  alias: text("alias").notNull(),
  firstObservedAt: integer("first_observed_at", { mode: "timestamp" }).notNull(),
  lastObservedAt: integer("last_observed_at", { mode: "timestamp" }).notNull(),
  sourceSyncId: text("source_sync_id").notNull(),
});

export const nseProviderMappings = sqliteTable("nse_provider_mappings", {
  provider: text("provider").notNull(),
  isin: text("isin").notNull(),
  providerInstrumentId: text("provider_instrument_id"),
  providerSymbol: text("provider_symbol"),
  availability: text("availability").notNull(),
  verifiedAt: integer("verified_at", { mode: "timestamp" }),
  source: text("source"),
});

export const paperAccounts = sqliteTable("paper_accounts", {
  currency: text("currency").primaryKey(),
  startingCash: real("starting_cash").notNull(),
  cash: real("cash").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const paperOrders = sqliteTable("paper_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instrumentId: text("instrument_id").notNull(),
  side: text("side").notNull(),
  quantity: real("quantity").notNull(),
  orderType: text("order_type").notNull(),
  limitPrice: real("limit_price"),
  status: text("status").notNull(),
  quotePrice: real("quote_price").notNull(),
  fillPrice: real("fill_price"),
  fees: real("fees").notNull().default(0),
  currency: text("currency").notNull(),
  reason: text("reason"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  filledAt: integer("filled_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  quoteProvider: text("quote_provider"),
  quoteSourceId: text("quote_source_id"),
  quoteQuality: text("quote_quality"),
  simulatedFixture: integer("simulated_fixture", { mode: "boolean" }).notNull().default(false),
});

export const paperPositions = sqliteTable("paper_positions", {
  instrumentId: text("instrument_id").primaryKey(),
  quantity: real("quantity").notNull(),
  averageCost: real("average_cost").notNull(),
  realizedPnl: real("realized_pnl").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const paperLedger = sqliteTable("paper_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  currency: text("currency").notNull(),
  instrumentId: text("instrument_id"),
  orderId: integer("order_id"),
  entryType: text("entry_type").notNull(),
  cashDelta: real("cash_delta").notNull(),
  quantityDelta: real("quantity_delta").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const aiRuns = sqliteTable("ai_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instrumentId: text("instrument_id").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  purpose: text("purpose").notNull(),
  question: text("question"),
  snapshotHash: text("snapshot_hash").notNull(),
  evidenceJson: text("evidence_json"),
  resultJson: text("result_json"),
  status: text("status").notNull(),
  errorCode: text("error_code"),
  providerRequestId: text("provider_request_id"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const evidenceSnapshots = sqliteTable("evidence_snapshots", {
  snapshotHash: text("snapshot_hash").primaryKey(),
  instrumentId: text("instrument_id").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  generatedAt: integer("generated_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const knowledgeSources = sqliteTable("knowledge_sources", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  locator: text("locator"),
  contentHash: text("content_hash").notNull(),
  content: text("content"),
  license: text("license"),
  authors: text("authors"),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  archivedPath: text("archived_path"),
  status: text("status").notNull().default("discovered"),
  rejectionReason: text("rejection_reason"),
  ingestedAt: integer("ingested_at", { mode: "timestamp" }).notNull(),
});

export const knowledgeClaims = sqliteTable("knowledge_claims", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  statement: text("statement").notNull(),
  locator: text("locator"),
  epistemicStatus: text("epistemic_status").notNull().default("inferred"),
  confidence: real("confidence"),
  indiaRelevant: integer("india_relevant"),
  verifiedAt: integer("verified_at", { mode: "timestamp" }),
  verifiedBy: text("verified_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const knowledgeConcepts = sqliteTable("knowledge_concepts", {
  id: text("id").primaryKey(),
  plane: text("plane").notNull(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  formalDefinition: text("formal_definition"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const knowledgeConceptEdges = sqliteTable("knowledge_concept_edges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromConceptId: text("from_concept_id").notNull(),
  toConceptId: text("to_concept_id").notNull(),
  relation: text("relation").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const knowledgeEquations = sqliteTable("knowledge_equations", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id"),
  sourceId: text("source_id"),
  name: text("name").notNull(),
  latex: text("latex").notNull(),
  variables: text("variables"),
  assumptions: text("assumptions"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const knowledgeReproductions = sqliteTable("knowledge_reproductions", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  claimId: text("claim_id"),
  equationId: text("equation_id"),
  language: text("language").notNull(),
  codePath: text("code_path"),
  expected: text("expected"),
  observed: text("observed"),
  tolerance: real("tolerance"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  ranAt: integer("ran_at", { mode: "timestamp" }),
});

export const knowledgeLessons = sqliteTable("knowledge_lessons", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id"),
  plane: text("plane").notNull(),
  level: text("level").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  citations: text("citations").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const knowledgeQuizzes = sqliteTable("knowledge_quizzes", {
  id: text("id").primaryKey(),
  conceptId: text("concept_id").notNull(),
  question: text("question").notNull(),
  options: text("options"),
  answer: text("answer").notNull(),
  explanation: text("explanation"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const knowledgeMastery = sqliteTable("knowledge_mastery", {
  conceptId: text("concept_id").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  correct: integer("correct").notNull().default(0),
  score: real("score").notNull().default(0),
  lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp" }),
  nextReviewAt: integer("next_review_at", { mode: "timestamp" }),
});

export const knowledgeContradictions = sqliteTable("knowledge_contradictions", {
  id: text("id").primaryKey(),
  claimAId: text("claim_a_id").notNull(),
  claimBId: text("claim_b_id").notNull(),
  description: text("description").notNull(),
  resolution: text("resolution"),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const researchHypotheses = sqliteTable("research_hypotheses", {
  id: text("id").primaryKey(),
  claimId: text("claim_id"),
  title: text("title").notNull(),
  statement: text("statement").notNull(),
  rationale: text("rationale"),
  market: text("market"),
  status: text("status").notNull().default("proposed"),
  duplicateOf: text("duplicate_of"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const strategySpecs = sqliteTable("strategy_specs", {
  id: text("id").primaryKey(),
  hypothesisId: text("hypothesis_id"),
  parentId: text("parent_id"),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  dsl: text("dsl").notNull(),
  dslHash: text("dsl_hash").notNull(),
  status: text("status").notNull().default("draft"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const trials = sqliteTable("trials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  strategySpecId: text("strategy_spec_id").notNull(),
  kind: text("kind").notNull(),
  verdict: text("verdict").notNull(),
  reason: text("reason"),
  metrics: text("metrics"),
  datasetFingerprint: text("dataset_fingerprint"),
  actor: text("actor").notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

/**
 * Durable trial-budget reservations — the atomic gate for spending a permanent statistical trial.
 * See `drizzle/0019_trial_reservations.sql`. `id` is the fencing token; the partial unique index on
 * (tradingDate, budgetSlot) WHERE state IN ('RESERVED','SPENT') is the atomic exclusion.
 */
export const trialReservations = sqliteTable("trial_reservations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tradingDate: text("trading_date").notNull(),
  budgetSlot: integer("budget_slot").notNull(),
  strategySpecId: text("strategy_spec_id").notNull(),
  actor: text("actor").notNull(),
  /** RESERVED → SPENT | RELEASED | ABANDONED. */
  state: text("state").notNull(),
  reservedAt: integer("reserved_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  finalizedAt: integer("finalized_at", { mode: "timestamp" }),
});

/**
 * The latest rehearsal verdict per strategy — what the ladder's `draft` rung was always written
 * to read, and never received. See `drizzle/0007_rehearsal_outcomes.sql`.
 */
export const rehearsalOutcomes = sqliteTable("rehearsal_outcomes", {
  strategySpecId: text("strategy_spec_id").primaryKey(),
  verdict: text("verdict").notNull(),
  reason: text("reason").notNull(),
  trades: integer("trades").notNull().default(0),
  instrumentsEvaluated: integer("instruments_evaluated").notNull().default(0),
  rehearsedAt: integer("rehearsed_at", { mode: "timestamp" }).notNull(),
  // 13b: the snapshot this verdict was judged on. NULL = pre-manifest legacy row.
  datasetSnapshotId: text("dataset_snapshot_id"),
});

export const validationResults = sqliteTable("validation_results", {
  id: text("id").primaryKey(),
  strategySpecId: text("strategy_spec_id").notNull(),
  oosProfitFactor: real("oos_profit_factor"),
  pbo: real("pbo"),
  deflatedSharpe: real("deflated_sharpe"),
  costMultiplePf: real("cost_multiple_pf"),
  trialsCounted: integer("trials_counted").notNull().default(0),
  passed: integer("passed").notNull().default(0),
  detail: text("detail"),
  evaluatedAt: integer("evaluated_at", { mode: "timestamp" }).notNull(),
});

export const forwardOutcomes = sqliteTable("forward_outcomes", {
  id: text("id").primaryKey(),
  strategySpecId: text("strategy_spec_id"),
  instrumentId: text("instrument_id").notNull(),
  openedAt: integer("opened_at", { mode: "timestamp" }).notNull(),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  outcome: text("outcome").notNull().default("open"),
  rMultiple: real("r_multiple"),
  source: text("source").notNull(),
  externalId: text("external_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** Forward evidence, shadow stage — see drizzle/0012_forward_evidence.sql for the triggers. */
export const forwardChallengers = sqliteTable("forward_challengers", {
  id: text("id").primaryKey(),
  strategySpecId: text("strategy_spec_id").notNull(),
  strategyFamilyId: text("strategy_family_id").notNull(),
  researchCampaignId: text("research_campaign_id").notNull(),
  activatedAt: integer("activated_at", { mode: "timestamp" }).notNull(),
  codeFingerprint: text("code_fingerprint").notNull(),
  engineVersion: text("engine_version").notNull(),
  executionProfileId: text("execution_profile_id"),
  feeModelId: text("fee_model_id").notNull(),
  market: text("market").notNull(),
  resolution: text("resolution").notNull(),
  universe: text("universe").notNull(),
  dslHash: text("dsl_hash").notNull(),
  promotionExperimentId: text("promotion_experiment_id"),
  promotionSnapshotId: text("promotion_snapshot_id"),
  forwardPolicy: text("forward_policy").notNull(),
  forwardPolicyVersion: text("forward_policy_version").notNull(),
  status: text("status").notNull(),
  retiredAt: integer("retired_at", { mode: "timestamp" }),
  retiredReason: text("retired_reason"),
  lastEvaluatedTime: integer("last_evaluated_time").notNull().default(0),
  createdBy: text("created_by").notNull(),
});

export const forwardSignals = sqliteTable("forward_signals", {
  id: text("id").primaryKey(),
  challengerId: text("challenger_id").notNull(),
  instrumentId: text("instrument_id").notNull(),
  eventTime: integer("event_time").notNull(),
  observedAt: integer("observed_at").notNull(),
  clauseEvidence: text("clause_evidence").notNull(),
  featureValues: text("feature_values").notNull(),
  entryPrice: real("entry_price").notNull(),
  stopPrice: real("stop_price"),
  targetPrice: real("target_price"),
  horizonBars: integer("horizon_bars").notNull(),
  executionProfileId: text("execution_profile_id"),
  costModelId: text("cost_model_id").notNull(),
  dataQuality: text("data_quality").notNull(),
  fingerprint: text("fingerprint").notNull(),
});

export const forwardSignalOutcomes = sqliteTable("forward_signal_outcomes", {
  signalId: text("signal_id").primaryKey(),
  resolvedAt: integer("resolved_at").notNull(),
  entryFill: real("entry_fill").notNull(),
  exitPrice: real("exit_price").notNull(),
  exitTime: integer("exit_time").notNull(),
  exitReason: text("exit_reason").notNull(),
  mfe: real("mfe"),
  mae: real("mae"),
  grossReturn: real("gross_return").notNull(),
  costReturn: real("cost_return"),
  netReturn: real("net_return"),
  economicsUnavailable: text("economics_unavailable"),
  benchmarkReturn: real("benchmark_return"),
  fingerprint: text("fingerprint").notNull(),
});

/** WS1b paper stage for forward challengers — see drizzle/0013_paper_forward.sql triggers. */
export const paperForwardAccounts = sqliteTable("paper_forward_accounts", {
  challengerId: text("challenger_id").primaryKey(),
  currency: text("currency").notNull(),
  startingCash: real("starting_cash").notNull(),
  cash: real("cash").notNull(),
  enrolledAt: integer("enrolled_at").notNull(),
  enrolledBy: text("enrolled_by").notNull(),
});

export const executionIntents = sqliteTable("execution_intents", {
  id: text("id").primaryKey(),
  signalId: text("signal_id").notNull(),
  challengerId: text("challenger_id").notNull(),
  instrumentId: text("instrument_id").notNull(),
  decisionTime: integer("decision_time").notNull(),
  side: text("side").notNull(),
  desiredQuantity: integer("desired_quantity").notNull(),
  orderType: text("order_type").notNull(),
  expectedPrice: real("expected_price").notNull(),
  stopPrice: real("stop_price"),
  targetPrice: real("target_price"),
  capitalBefore: real("capital_before").notNull(),
  riskBudget: real("risk_budget").notNull(),
  brokerProfileId: text("broker_profile_id"),
  feeModelId: text("fee_model_id").notNull(),
  decision: text("decision").notNull(),
  rejectReason: text("reject_reason"),
  fingerprint: text("fingerprint").notNull(),
});

export const paperForwardOrders = sqliteTable("paper_forward_orders", {
  intentId: text("intent_id").primaryKey(),
  challengerId: text("challenger_id").notNull(),
  instrumentId: text("instrument_id").notNull(),
  acceptedAt: integer("accepted_at").notNull(),
  status: text("status").notNull(),
  fillTime: integer("fill_time"),
  fillPrice: real("fill_price"),
  filledQuantity: integer("filled_quantity").notNull().default(0),
  fees: real("fees"),
  slippage: real("slippage"),
  reason: text("reason"),
  updatedAt: integer("updated_at").notNull(),
});

export const paperPositionOutcomes = sqliteTable("paper_position_outcomes", {
  intentId: text("intent_id").primaryKey(),
  challengerId: text("challenger_id").notNull(),
  instrumentId: text("instrument_id").notNull(),
  entryTime: integer("entry_time").notNull(),
  entryPrice: real("entry_price").notNull(),
  quantity: integer("quantity").notNull(),
  exitTime: integer("exit_time").notNull(),
  exitPrice: real("exit_price").notNull(),
  exitReason: text("exit_reason").notNull(),
  mfe: real("mfe"),
  mae: real("mae"),
  grossPnl: real("gross_pnl").notNull(),
  fees: real("fees").notNull(),
  netPnl: real("net_pnl").notNull(),
  capitalAfter: real("capital_after").notNull(),
  fingerprint: text("fingerprint").notNull(),
});

export const failureMemory = sqliteTable("failure_memory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),
  subjectId: text("subject_id"),
  failureMode: text("failure_mode").notNull(),
  detail: text("detail").notNull(),
  lesson: text("lesson"),
  recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull(),
});

/**
 * Sealed holdout definitions — see `drizzle/0022_sealed_holdout.sql`.
 *
 * The window, chronology (purge/embargo), sealed-window snapshot, fingerprint and DECISION RULE
 * are pinned at seal time as copies: a later change to gates, data or code must never move a
 * sealed bar. State machine: SEALED → AUTHORIZED_FOR_EVALUATION → CONSUMED, or → INVALIDATED
 * (fingerprint drift). One ACTIVE seal per (market, resolution) by partial unique index.
 */
export const holdoutDefinitions = sqliteTable("holdout_definitions", {
  id: text("id").primaryKey(),
  generation: integer("generation").notNull(),
  market: text("market").notNull(),
  resolution: text("resolution").notNull(),
  startTime: integer("start_time").notNull(),
  endTime: integer("end_time").notNull(),
  purgeGapSeconds: integer("purge_gap_seconds").notNull(),
  embargoSeconds: integer("embargo_seconds").notNull(),
  datasetSnapshotId: text("dataset_snapshot_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  barCount: integer("bar_count").notNull(),
  decisionRule: text("decision_rule").notNull(),
  state: text("state").notNull(),
  stateReason: text("state_reason"),
  sealedAt: integer("sealed_at", { mode: "timestamp" }).notNull(),
  sealedBy: text("sealed_by").notNull(),
  authorizedAt: integer("authorized_at", { mode: "timestamp" }),
  authorizedBy: text("authorized_by"),
  consumedAt: integer("consumed_at", { mode: "timestamp" }),
  invalidatedAt: integer("invalidated_at", { mode: "timestamp" }),
});

/** One evaluation's full economics + verdict; UNIQUE (holdout, family) — the ledger refuses a second look. */
export const holdoutResults = sqliteTable("holdout_results", {
  id: text("id").primaryKey(),
  holdoutId: text("holdout_id").notNull(),
  strategySpecId: text("strategy_spec_id").notNull(),
  strategyFamilyId: text("strategy_family_id").notNull(),
  datasetSnapshotId: text("dataset_snapshot_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  tradeCount: integer("trade_count").notNull(),
  netProfitFactor: real("net_profit_factor"),
  grossPnl: real("gross_pnl"),
  fees: real("fees"),
  netPnl: real("net_pnl"),
  winRate: real("win_rate"),
  maxDrawdown: real("max_drawdown"),
  validationOosPf: real("validation_oos_pf"),
  degradationRatio: real("degradation_ratio"),
  passed: integer("passed").notNull(),
  reasonCodes: text("reason_codes").notNull(),
  detail: text("detail"),
  evaluatedAt: integer("evaluated_at", { mode: "timestamp" }).notNull(),
  evaluatedBy: text("evaluated_by").notNull(),
});

export const holdoutLedger = sqliteTable("holdout_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  holdoutId: text("holdout_id").notNull(),
  strategySpecId: text("strategy_spec_id").notNull(),
  actor: text("actor").notNull(),
  resultHash: text("result_hash"),
  queriedAt: integer("queried_at", { mode: "timestamp" }).notNull(),
});

/**
 * Research identity — see `drizzle/0008_research_identity.sql`.
 *
 * These tables are declared here so the ORM can read them, but the migration that creates them
 * cannot register itself: `MIGRATIONS` lives in the protected `lib/db/migrate.ts`. Until an owner
 * adds the line, these tables do not exist at runtime and every query against them throws.
 *
 * That is handled rather than worked around — `researchIdentityReady()` in
 * `lib/strategy/research-identity.ts` treats their absence as "no strategy has an identity", which
 * fails closed and blocks validation. The interim state is safe, not broken.
 */
export const researchCampaigns = sqliteTable("research_campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  question: text("question").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  createdBy: text("created_by").notNull(),
  closedAt: integer("closed_at", { mode: "timestamp" }),
});

export const strategyFamilies = sqliteTable("strategy_families", {
  id: text("id").primaryKey(),
  researchCampaignId: text("research_campaign_id").notNull(),
  name: text("name").notNull(),
  economicHypothesis: text("economic_hypothesis").notNull(),
  mechanism: text("mechanism").notNull(),
  allowedVariantDimensions: text("allowed_variant_dimensions"),
  declarationHash: text("declaration_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  createdBy: text("created_by").notNull(),
});

export const strategyIdentity = sqliteTable("strategy_identity", {
  strategySpecId: text("strategy_spec_id").primaryKey(),
  researchCampaignId: text("research_campaign_id").notNull(),
  strategyFamilyId: text("strategy_family_id").notNull(),
  parentSpecId: text("parent_spec_id"),
  semanticFingerprint: text("semantic_fingerprint").notNull(),
  validationEligible: integer("validation_eligible").notNull().default(0),
  classifiedBy: text("classified_by").notNull(),
  classifiedAt: integer("classified_at", { mode: "timestamp" }).notNull(),
  classification: text("classification").notNull(),
  classificationReason: text("classification_reason"),
});

/** One row per configuration actually tested and allowed to influence selection. */
export const selectionTrials = sqliteTable("selection_trials", {
  id: text("id").primaryKey(),
  researchCampaignId: text("research_campaign_id").notNull(),
  strategyFamilyId: text("strategy_family_id").notNull(),
  strategySpecId: text("strategy_spec_id").notNull(),
  configurationFingerprint: text("configuration_fingerprint").notNull(),
  experimentRunId: text("experiment_run_id"),
  selectionEligible: integer("selection_eligible").notNull().default(1),
  reason: text("reason"),
  evidenceHash: text("evidence_hash"),
  // 13b: the snapshot the trial's evidence came from. NULL = pre-manifest legacy row.
  datasetSnapshotId: text("dataset_snapshot_id"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

/** Sealed-holdout entitlement. Budgets are enforced by UNIQUE indexes, not by application logic. */
export const holdoutAccess = sqliteTable("holdout_access", {
  id: text("id").primaryKey(),
  holdoutGenerationId: text("holdout_generation_id").notNull(),
  researchCampaignId: text("research_campaign_id").notNull(),
  strategyFamilyId: text("strategy_family_id").notNull(),
  strategySpecId: text("strategy_spec_id").notNull(),
  experimentRunId: text("experiment_run_id"),
  requestFingerprint: text("request_fingerprint").notNull(),
  codeHash: text("code_hash"),
  datasetHash: text("dataset_hash"),
  requestedAt: integer("requested_at", { mode: "timestamp" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp" }).notNull(),
  resultDisclosed: integer("result_disclosed").notNull().default(0),
  reason: text("reason"),
  // 13b: the snapshot the holdout query ran against. NULL = pre-manifest legacy row.
  datasetSnapshotId: text("dataset_snapshot_id"),
});

/** Dataset snapshots + experiment ledger — see drizzle/0009_dataset_snapshots.sql. */
export const datasetSnapshots = sqliteTable("dataset_snapshots", {
  id: text("id").primaryKey(),
  market: text("market").notNull(),
  resolution: text("resolution").notNull(),
  instruments: text("instruments").notNull(),
  firstTime: integer("first_time").notNull(),
  lastTime: integer("last_time").notNull(),
  barCount: integer("bar_count").notNull(),
  fingerprint: text("fingerprint").notNull(),
  sourceLineage: text("source_lineage").notNull(),
  normalizationVersion: text("normalization_version").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  createdBy: text("created_by").notNull(),
});

export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(),
  strategySpecId: text("strategy_spec_id").notNull(),
  datasetSnapshotId: text("dataset_snapshot_id").notNull(),
  kind: text("kind").notNull(),
  engineVersion: text("engine_version").notNull(),
  executionProfileId: text("execution_profile_id"),
  tradeCount: integer("trade_count").notNull(),
  summary: text("summary").notNull(),
  // 13b: the full reproducibility manifest, as JSON. NULL = pre-manifest legacy row.
  manifest: text("manifest"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  createdBy: text("created_by").notNull(),
});

export const experimentTrades = sqliteTable("experiment_trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  experimentId: text("experiment_id").notNull(),
  tradeIndex: integer("trade_index").notNull(),
  payload: text("payload").notNull(),
});

export const evolutionProposals = sqliteTable("evolution_proposals", {
  id: text("id").primaryKey(),
  origin: text("origin").notNull(),
  actionId: text("action_id").notNull(),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  diffPath: text("diff_path"),
  branch: text("branch"),
  worktree: text("worktree"),
  evidence: text("evidence"),
  status: text("status").notNull().default("draft"),
  reviewer: text("reviewer"),
  reviewNotes: text("review_notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  decision: text("decision").notNull(),
  denialCode: text("denial_code"),
  subject: text("subject"),
  detail: text("detail"),
  learningMode: text("learning_mode"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const researchJobs = sqliteTable("research_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("queued"),
  priority: integer("priority").notNull().default(100),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  lastError: text("last_error"),
  result: text("result"),
  dedupeKey: text("dedupe_key"),
  lockedBy: text("locked_by"),
  lockedUntil: integer("locked_until", { mode: "timestamp" }),
  availableAt: integer("available_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const researchJobEvents = sqliteTable("research_job_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  event: text("event").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const jobDependencies = sqliteTable("job_dependencies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  dependsOnId: integer("depends_on_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const learningState = sqliteTable("learning_state", {
  id: integer("id").primaryKey(),
  mode: text("mode").notNull().default("off"),
  updatedBy: text("updated_by").notNull().default("owner"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type Stock = typeof stocks.$inferSelect;
export type QuoteSnapshot = typeof quoteSnapshots.$inferSelect;
export type PriceCandle = typeof priceCandles.$inferSelect;
export type NewsArticle = typeof newsArticles.$inferSelect;
export type MarketBriefing = typeof marketBriefings.$inferSelect;
export type WatchlistSuggestion = typeof watchlistSuggestions.$inferSelect;
export type StockAnalysisReport = typeof stockAnalysisReports.$inferSelect;
export type UserWatchlistEntry = typeof userWatchlist.$inferSelect;
export type AgentConfig = typeof agentConfig.$inferSelect;
export type Strategy = typeof strategies.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type RobinhoodPortfolioRow = typeof robinhoodPortfolio.$inferSelect;
export type InstrumentRow = typeof instruments.$inferSelect;
export type SecurityMasterSyncRow = typeof securityMasterSyncs.$inferSelect;
export type NseSecurityRow = typeof nseSecurities.$inferSelect;
export type NseListingVersionRow = typeof nseListingVersions.$inferSelect;
export type NseSecurityAliasRow = typeof nseSecurityAliases.$inferSelect;
export type NseProviderMappingRow = typeof nseProviderMappings.$inferSelect;
export type PaperAccountRow = typeof paperAccounts.$inferSelect;
export type PaperOrderRow = typeof paperOrders.$inferSelect;
export type PaperPositionRow = typeof paperPositions.$inferSelect;
export type PaperLedgerRow = typeof paperLedger.$inferSelect;
export type KnowledgeSourceRow = typeof knowledgeSources.$inferSelect;
export type KnowledgeClaimRow = typeof knowledgeClaims.$inferSelect;
export type KnowledgeConceptRow = typeof knowledgeConcepts.$inferSelect;
export type KnowledgeEquationRow = typeof knowledgeEquations.$inferSelect;
export type KnowledgeReproductionRow = typeof knowledgeReproductions.$inferSelect;
export type KnowledgeLessonRow = typeof knowledgeLessons.$inferSelect;
export type KnowledgeQuizRow = typeof knowledgeQuizzes.$inferSelect;
export type KnowledgeMasteryRow = typeof knowledgeMastery.$inferSelect;
export type KnowledgeContradictionRow = typeof knowledgeContradictions.$inferSelect;
export type ResearchHypothesisRow = typeof researchHypotheses.$inferSelect;
export type StrategySpecRow = typeof strategySpecs.$inferSelect;
export type TrialRow = typeof trials.$inferSelect;
export type ValidationResultRow = typeof validationResults.$inferSelect;
export type ForwardOutcomeRow = typeof forwardOutcomes.$inferSelect;
export type FailureMemoryRow = typeof failureMemory.$inferSelect;
export type HoldoutLedgerRow = typeof holdoutLedger.$inferSelect;
export type EvolutionProposalRow = typeof evolutionProposals.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type LearningStateRow = typeof learningState.$inferSelect;
export type ResearchJobRow = typeof researchJobs.$inferSelect;
export type ResearchJobEventRow = typeof researchJobEvents.$inferSelect;
export type AiRunRow = typeof aiRuns.$inferSelect;

/**
 * The AgentRun ledger (§28). Every model call, including the refused ones — a ledger of successes
 * cannot answer "why did research stop last night", which is what it is for.
 */
export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  capability: text("capability").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  /** COMPLETED | REFUSED | FAILED — a refusal is an outcome, not an error. */
  status: text("status").notNull(),
  trigger: text("trigger").notNull(),
  instrumentId: text("instrument_id"),
  evidenceFingerprint: text("evidence_fingerprint"),
  verificationStatus: text("verification_status"),
  envelope: text("envelope"),
  refusalCode: text("refusal_code"),
  refusalMessage: text("refusal_message"),
  tokens: integer("tokens"),
  cost: real("cost"),
  costCurrency: text("cost_currency"),
  fallbackReason: text("fallback_reason"),
  /** Provenance (0020): which AgentDefinition ran, at which version, for which durable job. NULL for browser-triggered runs. */
  agentId: text("agent_id"),
  agentVersion: text("agent_version"),
  jobId: integer("job_id"),
  /** Provenance (0021): the TeamRun this run belongs to, when it was a chief/member of a team. NULL for solo runs. */
  teamRunId: text("team_run_id"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }).notNull(),
});

export type AgentRunRow = typeof agentRuns.$inferSelect;

/**
 * The TeamRun ledger (0021) — one row per Chief-of-Staff coordination of a bounded semantic team.
 *
 * Distinct from `agentRuns` (one model call) the way `AgentRun` is distinct from `AgentDefinition`:
 * a TeamRun records what a team DID (members, artifacts, plan, result, dissent) and pins the static
 * `TeamDefinition` by version, so a later change to the team's roles never rewrites history.
 */
export const teamRuns = sqliteTable("team_runs", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  teamVersion: text("team_version").notNull(),
  jobId: integer("job_id"),
  instrumentId: text("instrument_id"),
  /** RUNNING | COMPLETED | FAILED. */
  status: text("status").notNull(),
  chiefAgentRunId: text("chief_agent_run_id"),
  /** JSON string[] — the member AgentRun ids, in plan order. */
  memberAgentRunIds: text("member_agent_run_ids"),
  /** JSON string[] — the artifacts produced, by id. */
  artifactIds: text("artifact_ids"),
  /** JSON TeamExecutionPlan — persisted BEFORE any member runs; not silently rewritten. */
  plan: text("plan"),
  /** JSON TeamResult — dissent preserved. */
  result: text("result"),
  tokens: integer("tokens"),
  cost: real("cost"),
  costCurrency: text("cost_currency"),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export type TeamRunRow = typeof teamRuns.$inferSelect;

/**
 * AgentArtifact (0021) — the STRUCTURED, persisted output a team member produces.
 *
 * The owner's rule: team members exchange artifacts, not chat transcripts. The Synthesizer consumes
 * these by id. Persisting them (rather than passing blobs) is what makes a team run reproducible,
 * token-bounded, crash-recoverable, and inspectable — and lets dissent become knowledge later.
 */
export const agentArtifacts = sqliteTable("agent_artifacts", {
  id: text("id").primaryKey(),
  teamRunId: text("team_run_id").notNull(),
  jobId: integer("job_id"),
  role: text("role").notNull(),
  /** RESEARCH | VERIFICATION | CRITIQUE | SYNTHESIS. */
  kind: text("kind").notNull(),
  /** The member AgentRun that produced this artifact. */
  agentRunId: text("agent_run_id"),
  /** JSON structured content — never a chat transcript. */
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type AgentArtifactRow = typeof agentArtifacts.$inferSelect;

/**
 * One row per press of "Start MarketPulse".
 *
 * The ticker lives in the server process; the WORK lives in `researchJobs`, which is leased,
 * deduped and retried. This table is what makes an interrupted run visible: a stale `heartbeatAt`
 * is how a dead process is detected and reconciled, instead of leaving a silent gap.
 */
export const autonomousRuns = sqliteTable("autonomous_runs", {
  id: text("id").primaryKey(),
  /** STARTING | RUNNING | DEGRADED | STOPPED | CRASHED — DEGRADED is running with a named fault. */
  status: text("status").notNull(),
  runtimeProfile: text("runtime_profile").notNull(),
  /** The learning mode as it was at start: a record of what was permitted, never a control. */
  governanceCeiling: text("governance_ceiling").notNull(),
  marketMode: text("market_mode").notNull(),
  nextAction: text("next_action"),
  lastCheckpoint: text("last_checkpoint"),
  reason: text("reason"),
  ticks: integer("ticks").notNull().default(0),
  host: text("host").notNull(),
  pid: integer("pid").notNull(),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  heartbeatAt: integer("heartbeat_at", { mode: "timestamp" }).notNull(),
  stoppedAt: integer("stopped_at", { mode: "timestamp" }),
});

export type AutonomousRunRow = typeof autonomousRuns.$inferSelect;

/**
 * The bar-ingestion ledger — see
 * `docs/plans/nse-data-coverage/pending-migration/0023_bar_ingestions.sql`.
 *
 * What was ASKED FOR beside what ARRIVED, per fetch: the request window, the response's first
 * and last bar and count, the identity verdict, and the gap/completeness audit. It exists
 * because a provider layer once served one day for a 59-day request and every fetch still
 * "succeeded" — silent truncation is invisible unless the request is stored beside the response.
 *
 * Declared here so the ORM can read it, but the migration cannot register itself: `MIGRATIONS`
 * lives in the protected `lib/db/migrate.ts`, and a file sitting in `drizzle/` WITHOUT its line
 * there would apply to no database while looking applied to a reader of the directory — a state
 * two existing tests correctly refuse. So the SQL waits in its pending directory (see the README
 * beside it for the two-step promotion) and `recordBarIngestion`
 * (lib/market/bar-ingestion-ledger.ts) treats the absent table as "not recorded" rather than
 * failing an ingest — the audit still travels in the ingest outcome, so the information is
 * visible either way. Same interim-safe pattern as the research-identity tables above.
 */
export const barIngestions = sqliteTable("bar_ingestions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instrumentId: text("instrument_id").notNull(),
  resolution: text("resolution").notNull(),
  source: text("source").notNull(),
  requestedStart: integer("requested_start").notNull(),
  requestedEnd: integer("requested_end").notNull(),
  returnedFirstBar: integer("returned_first_bar"),
  returnedLastBar: integer("returned_last_bar"),
  returnedBarCount: integer("returned_bar_count").notNull(),
  inserted: integer("inserted").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  rejected: integer("rejected").notNull().default(0),
  identityVerdict: text("identity_verdict").notNull(),
  completeness: text("completeness").notNull(),
  expectedSessions: integer("expected_sessions"),
  observedSessions: integer("observed_sessions").notNull().default(0),
  duplicateTimestamps: integer("duplicate_timestamps").notNull().default(0),
  outOfSessionBars: integer("out_of_session_bars").notNull().default(0),
  shortSessions: integer("short_sessions").notNull().default(0),
  detail: text("detail"),
  ingestedAt: integer("ingested_at", { mode: "timestamp" }).notNull(),
});

export type BarIngestionRow = typeof barIngestions.$inferSelect;

/**
 * NSE sector classification — see
 * `docs/plans/nse-qc-001/pending-migration/0024_sector_classifications.sql`.
 *
 * EFFECTIVE-DATED REFERENCE DATA, not a stock attribute: NSE reviews its four-level
 * classification annually and reclassifies after mergers and demergers, so a classification is a
 * fact with a date attached and superseding one must not erase what an earlier experiment was
 * judged under.
 *
 * Declared here so the ORM can read it; the migration cannot register itself (`MIGRATIONS` lives
 * in the protected `lib/db/migrate.ts`). Until an owner promotes it,
 * `sectorClassificationReady()` returns false, ingestion refuses with a stated reason, and the
 * trial-activation gate keeps reporting sector representation as UNMEASURABLE — the truthful
 * reading, which keeps the gate shut rather than passing on absence.
 */
export const sectorClassifications = sqliteTable("sector_classifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  isin: text("isin").notNull(),
  instrumentId: text("instrument_id").notNull(),
  symbol: text("symbol").notNull(),
  macroSector: text("macro_sector"),
  sector: text("sector"),
  industry: text("industry"),
  basicIndustry: text("basic_industry"),
  source: text("source").notNull(),
  sourceUrl: text("source_url"),
  sourceEffectiveDate: text("source_effective_date").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
  identityVerification: text("identity_verification").notNull(),
  effectiveFrom: integer("effective_from", { mode: "timestamp" }).notNull(),
  effectiveTo: integer("effective_to", { mode: "timestamp" }),
});

export type SectorClassificationRow = typeof sectorClassifications.$inferSelect;
