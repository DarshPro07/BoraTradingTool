# Graph Report - .  (2026-08-09)

## Corpus Check
- 508 files · ~369,499 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3147 nodes · 6954 edges · 204 communities (167 shown, 37 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 174 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 167
- Community 168
- Community 170
- Community 171
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 196
- Community 197
- Community 198
- Community 199
- Community 201
- Community 203

## God Nodes (most connected - your core abstractions)
1. `getDb()` - 218 edges
2. `Candle` - 60 edges
3. `requireMutationAccess()` - 54 edges
4. `StrategyDslSchema` - 43 edges
5. `StrategyDsl` - 38 edges
6. `readJsonObject()` - 30 edges
7. `runCycleBody()` - 30 edges
8. `cn()` - 30 edges
9. `createMarketPulseMcpServer()` - 29 edges
10. `Panel()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `DELETE()` --calls--> `requireMutationAccess()`  [EXTRACTED]
  app/api/owner/session/route.ts → lib/security/request.ts
- `GET()` --calls--> `getDb()`  [EXTRACTED]
  app/api/watchlist/route.ts → lib/db/index.ts
- `AuditPage()` --calls--> `auditView()`  [EXTRACTED]
  app/audit/page.tsx → lib/dashboard/queries.ts
- `EdgeFactoryPage()` --calls--> `researchFunnel()`  [EXTRACTED]
  app/edge-factory/page.tsx → lib/dashboard/queries.ts
- `ExperimentsPage()` --calls--> `experimentLedger()`  [EXTRACTED]
  app/experiments/page.tsx → lib/dashboard/queries.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Domain-Language-Aware Codebase Exploration** — diagnose_skill, qa_skill, improve_codebase_architecture_skill [INFERRED 0.65]
- **Shared Grilling Interview Workflow** — grill_me_skill, grill_with_docs_skill, improve_codebase_architecture_skill [INFERRED 0.85]
- **Design It Twice Family: Radically Different Designs** — design_an_interface_skill, improve_codebase_architecture_interface_design, prototype_ui [INFERRED 0.85]
- **Issue Tracker Configuration Matrix** — setup_matt_pocock_tracker_decision, issue_tracker_github_doc, issue_tracker_gitlab_doc, issue_tracker_local_doc, triage_labels_doc [INFERRED 0.85]
- **TDD Red-Green-Refactor Workflow** — tdd_skill, tdd_behavior_principle, tdd_red_green_refactor, tdd_tracer_bullet, tdd_refactoring [EXTRACTED 1.00]
- **Teaching Workspace Document Set** — teach_teaching_workspace, teach_mission, teach_resources, teach_learning_record, teach_glossary, teach_lessons [EXTRACTED 1.00]
- **Issue workflow** — to_issues_SKILL_vertical_slice, to_prd_SKILL_prd, triage_SKILL_state_machine, triage_AGENT_BRIEF_agent_brief, triage_OUT_OF_SCOPE_kb [INFERRED 0.75]
- **Raw material to article workflow** — writing_fragments_SKILL_fragment, writing_fragments_SKILL_fragment_file, writing_beats_SKILL_beat, writing_shape_SKILL_shaping_session [INFERRED 0.75]
- **Strategy validation pipeline** — CONTEXT_strategy_specification, validate_strategy_SKILL_gauntlet, CONTEXT_trial_ledger, CONTEXT_locked_holdout, quant_validator_refutation [INFERRED 0.75]
- **Execution Safety Boundary (no broker, human confirmation only)** — requirements_ExecutionBoundary, 0003-paper-research-and-manual-execution-boundary_DecisionSupport, runbook_ExecutionBoundary, 2026-08-05-marketpulse-complete-upgrade_DeferredBrokerGate, 2026-08-05-multi-market-upgrade-design_ExactOrderConfirmation [INFERRED 0.90]
- **Data-Grounded Instrument and Resolution Scope** — requirements_InstrumentScope, 0005-instrument-scope_NseAndUsEquities, research_market_data_sources_NseDataLevels, research_market_data_sources_FreeTierConstraint, research_market_data_sources_MetricsBeforeBuying [INFERRED 0.85]
- **Kronos Forecast Intake and Bias-Admission Pipeline** — requirements_KronosIntake, 0004-kronos-forecast-intake_HypothesisNotSignal, research_prompts_v2_PitForecastArchive, research_prompt_master_v3_KronosBiasEngine [INFERRED 0.90]

## Communities (204 total, 37 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (61): dynamic, GET(), GET(), AiOutputError, assertValidCitations(), buildEvidencePackage(), EvidenceItem, EvidenceItemSchema (+53 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (74): AiRunRow, aiRuns, AuditEventRow, auditEvents, evidenceSnapshots, EvolutionProposalRow, evolutionProposals, failureMemory (+66 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (63): dynamic, GET(), HTTP_STATUS, isQuantResource(), failureAt(), FetchOptions, HttpEnvelope, readFromHttp() (+55 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (56): GENERATED_AT, SUITE_ROOT, writeForecast(), BarSchema, FileSchema, FORECAST_FRESHNESS_MS, ForecastErrorCode, ForecastFailure (+48 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (52): assertReachesBack(), contractAsOf(), ContractMasterError, ContractMasterErrorCode, currentCatalogOnly(), InstrumentSnapshot, InstrumentType, isTradableAt() (+44 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (53): dynamic, GET(), seedChain(), temporaryDirectories, claimNode(), contentHash(), countTrials(), forwardNode() (+45 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (49): dynamic, MemoryGraphPage(), NODE_TONE, MemoryMap(), TONE, truncate(), memoryGraphRoots(), barycentre() (+41 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (6): cached(), CachingProvider, FallbackProvider, YahooCandleProvider, DataProvider, getYahooSectorPerformance()

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (41): dynamic, GET(), MODES, PATCH(), AGENT_TOKEN, OWNER_TOKEN, dynamic, GET() (+33 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (21): Props, Props, InsiderPanel(), Props, intensity(), Props, SectorHeatmap(), NEGATIVE (+13 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (37): DATASET_ACTION, DatasetRecord, persistCandles(), recordDatasetImport(), DECLARATION, instrument(), ADJUSTED_MARKERS, ALIASES (+29 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (37): CostViabilityPanel(), LADDER, pct(), rupees(), safely(), Market, CapitalInput, classify() (+29 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (39): MCP_TOOL_CAPABILITIES, authorizeWrite(), canonicalPath(), checkProtectedPath(), isWithin(), matchesPattern(), normalizePath(), pathModuleRelative() (+31 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (37): dynamic, GET(), POST(), dynamic, POST(), getDb(), markHypothesisDuplicate(), recordFailure() (+29 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (33): BacktestOptions, BacktestRefusal, BacktestResult, BacktestRun, closeTrade(), compare(), evaluate(), RefusalCode (+25 more)

### Community 15 - "Community 15"
Cohesion: 0.09
Nodes (32): baseDsl(), basis(), breedGeneration(), BreedReport, Condition, CROSS_PAIRS, logicIdentity(), mutateCondition() (+24 more)

### Community 16 - "Community 16"
Cohesion: 0.10
Nodes (25): Props, ResearchReport(), SIGNAL_CONFIG, Props, rsiColor(), TechnicalsPanel(), CONTEXT_DIR, ensureContextDir() (+17 more)

### Community 17 - "Community 17"
Cohesion: 0.10
Nodes (25): AnalystPage(), dynamic, evidencePreview(), STANCE_TONE, AuditPage(), dynamic, dynamic, dynamic (+17 more)

### Community 18 - "Community 18"
Cohesion: 0.10
Nodes (23): DELETE(), disabled(), dynamic, POST(), DELETE(), disabled(), dynamic, POST() (+15 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (25): BatteryReport, FIXTURES, SimulationResult, SimulationsPage(), Verdict, VERDICT_STYLE, LossLedgerPanel(), money() (+17 more)

### Community 20 - "Community 20"
Cohesion: 0.10
Nodes (35): CLAIM node, label garbled ('TtE'-like), CLAIM node, label starts 'Warrating data…' (truncated), CLAIM node, label garbled ('Inderin…'-like), CLAIM node, label 'eligibility…' (truncated), CLAIM node, label garbled ('yfinace'-like), CLAIM node, label 'Neither source presents…' (truncated), CLAIM node, label 'A pre-…' (truncated), CLAIM node (label not OCR-able) (+27 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (28): dynamic, GET(), POST(), STATUSES, AGENT_TOKEN, OWNER_TOKEN, proposal(), ProposalStatus (+20 more)

### Community 22 - "Community 22"
Cohesion: 0.12
Nodes (27): Badge(), badgeVariants, Button(), buttonVariants, Card(), CardAction(), CardContent(), CardDescription() (+19 more)

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (24): dynamic, PATCH(), dynamic, GET(), POST(), dynamic, POST(), dynamic (+16 more)

### Community 24 - "Community 24"
Cohesion: 0.11
Nodes (30): boardSummary(), buildTradeBoard(), paperEquity(), recordConcept(), CycleReport, emptyReport(), EvidenceLoader, forecastBars() (+22 more)

### Community 25 - "Community 25"
Cohesion: 0.08
Nodes (22): temporaryDirectories, BreedInput, bars(), dailyEvidence(), spec(), temporaryDirectories, QuantCandidate, FiredSignal (+14 more)

### Community 26 - "Community 26"
Cohesion: 0.12
Nodes (29): buildResearchSnapshot(), emptyFundamentals(), fixtureCandles(), fixtureQuote(), getNormalizedCandles(), getNormalizedQuote(), qualityFromAge(), TEST_PRICES (+21 more)

### Community 27 - "Community 27"
Cohesion: 0.15
Nodes (23): dynamic, GET(), dynamic, money(), PortfolioRiskPage(), MarketSession, Instrument, NormalizedQuote (+15 more)

### Community 28 - "Community 28"
Cohesion: 0.10
Nodes (24): CandlestickChart(), computeSMA(), Divergence, Props, Timeframe, TIMEFRAME_CONFIG, AmbiguityPolicy, assertMode() (+16 more)

### Community 29 - "Community 29"
Cohesion: 0.10
Nodes (23): ADR-0004, bar(), crossingBars(), dsl(), DERIVABLE_FEATURES, COMPARISONS, CompiledStrategy, CompileErrorCode (+15 more)

### Community 30 - "Community 30"
Cohesion: 0.10
Nodes (15): BookOptions, Fill, fillPrice(), isPositive(), isTerminal(), Order, OrderBook, OrderRejected (+7 more)

### Community 31 - "Community 31"
Cohesion: 0.11
Nodes (25): boardArtifact(), ForwardCounts, forwardRows(), GenerateOptions, generateQuantCoreArtifacts(), GenerationReport, isoDate(), LOCAL_QUANT_CORE_ROOT (+17 more)

### Community 32 - "Community 32"
Cohesion: 0.14
Nodes (22): dynamic, GET(), ago(), AutonomyStrip(), driverLabel(), ActivityFeed(), clock(), dayLabel() (+14 more)

### Community 33 - "Community 33"
Cohesion: 0.12
Nodes (24): setSpecStatus(), TrialKind, TrialVerdict, costStressReturns(), countSelectionTrials(), GauntletReport, HOLDOUT_QUERY_BUDGET, HoldoutBudgetExhausted (+16 more)

### Community 34 - "Community 34"
Cohesion: 0.10
Nodes (26): listReproductions(), markReproductionError(), recordObservation(), registerReproduction(), ReproductionInput, ReproductionOutcome, reproductionSummary, shortId() (+18 more)

### Community 35 - "Community 35"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 36 - "Community 36"
Cohesion: 0.11
Nodes (22): atrSeries(), buildFeaturePanel(), DerivableFeature, derivableSet, emaSeries(), FeaturePanel, PanelOptions, rollingExtreme() (+14 more)

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (19): EXCHANGES, GET(), dynamic, PreMarketPage(), revalidate, CatalogInput, searchInstruments(), AssetType (+11 more)

### Community 38 - "Community 38"
Cohesion: 0.11
Nodes (21): dynamic, GET(), clockTime(), coarseSession(), EARLY_CLOSES, findNextSessionOpen(), getMarketPhase(), HOLIDAYS (+13 more)

### Community 39 - "Community 39"
Cohesion: 0.15
Nodes (20): dynamic, POST(), RequestSchema, BatteryOptions, blockBootstrapSimulation(), costStressSimulation(), insufficient(), lag1Autocorrelation() (+12 more)

### Community 40 - "Community 40"
Cohesion: 0.12
Nodes (20): dynamic, metric(), STATUS_TONE, StrategyLabPage(), FeatureSupportPanel(), Outcome, RunGauntletButton(), StarMap() (+12 more)

### Community 41 - "Community 41"
Cohesion: 0.13
Nodes (17): buildProposal(), DEFAULT_VALID_FOR_MINUTES, isExpired(), ProposalDecision, ProposalInput, input(), NOW, CheckStatus (+9 more)

### Community 42 - "Community 42"
Cohesion: 0.11
Nodes (18): AnalyzePage(), dynamic, revalidate, AnalystPanel(), ClaudePromptBlock(), formatMoney(), EarningsPanel(), Props (+10 more)

### Community 43 - "Community 43"
Cohesion: 0.17
Nodes (20): DataQualityPage(), dynamic, ResourceRow(), ForecastValidationPanel(), IntradayDepthPanel(), PROVIDER_WINDOW, StateBadge(), TONE_CLASS (+12 more)

### Community 44 - "Community 44"
Cohesion: 0.14
Nodes (21): Repair, RepairOutcome, repairUnderstatedCosts(), reportCapitalDrift(), runSelfRepair(), SelfRepairReport, saveSpec(), setPaperCapital() (+13 more)

### Community 45 - "Community 45"
Cohesion: 0.13
Nodes (20): allSources(), arxivQuantFinance(), collapse(), DEFAULT_MAX_PER_PASS, DiscoveredSource, parseArxivAtom(), pick(), ProduceOptions (+12 more)

### Community 46 - "Community 46"
Cohesion: 0.13
Nodes (19): GET(), dynamic, GET(), dynamic, NewsPage(), CATEGORIES, Category, classify() (+11 more)

### Community 47 - "Community 47"
Cohesion: 0.11
Nodes (21): DashboardPage(), dynamic, MarketView, revalidate, sectorBreadth(), SECTORS, toMover(), VIEW_CONFIG (+13 more)

### Community 48 - "Community 48"
Cohesion: 0.08
Nodes (25): drizzle-kit, esbuild, @modelcontextprotocol/client, devDependencies, drizzle-kit, esbuild, @modelcontextprotocol/client, @playwright/test (+17 more)

### Community 49 - "Community 49"
Cohesion: 0.13
Nodes (16): dynamic, GET(), dynamic, geistMono, metadata, formatMoney(), TAPE_INSTRUMENTS, TickerTape() (+8 more)

### Community 50 - "Community 50"
Cohesion: 0.09
Nodes (23): @anthropic-ai/sdk, @base-ui/react, better-sqlite3, clsx, drizzle-orm, lightweight-charts, dependencies, @anthropic-ai/sdk (+15 more)

### Community 51 - "Community 51"
Cohesion: 0.17
Nodes (16): dynamic, POST(), dynamic, POST(), GraveyardPanel(), StrategyDslSchema, spec(), BURIED_STATUSES (+8 more)

### Community 52 - "Community 52"
Cohesion: 0.17
Nodes (18): firstDecisive(), ForwardBarLoader, ForwardDriverReport, ForwardProposal, ForwardOutcome, forwardRecord, MIN_FORWARD_OBSERVATIONS, observationId() (+10 more)

### Community 53 - "Community 53"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 54 - "Community 54"
Cohesion: 0.13
Nodes (19): atr(), ConditionResult, DEFAULT_PARAMS, emaSeries(), evaluateScalpingSetup(), RefusalCode, refuse(), rsi() (+11 more)

### Community 55 - "Community 55"
Cohesion: 0.13
Nodes (14): DEFAULT_TICKERS, dynamic, TICKER_META, WatchlistPage(), fmtVol(), formatMoney(), Props, QuoteHeader() (+6 more)

### Community 56 - "Community 56"
Cohesion: 0.16
Nodes (16): NextStep(), collectFeatures(), isDerivable(), nextStep, StepId, empty(), loadDataset(), NO_DATA_REASON (+8 more)

### Community 57 - "Community 57"
Cohesion: 0.17
Nodes (20): audit_events, evolution_proposals, failure_memory, forward_outcomes, holdout_ledger, knowledge_claims, knowledge_concept_edges, knowledge_concepts (+12 more)

### Community 58 - "Community 58"
Cohesion: 0.17
Nodes (18): BoardInput, bookReturnSeries(), buildGateContext(), BuiltContext, ContextInput, marketFor(), realisedRToday(), getMarketSession() (+10 more)

### Community 59 - "Community 59"
Cohesion: 0.15
Nodes (21): Communities for Wisdom, Feedback Loops, Fluency vs Storage Strength, GLOSSARY.md Format, Glossary Building as Learning Evidence, Glossary Writing Rules, Knowledge Skills Wisdom Philosophy, Learning Record Format (+13 more)

### Community 60 - "Community 60"
Cohesion: 0.20
Nodes (17): GATES, DeflatedSharpeInput, deflatedSharpeRatio(), DeflatedSharpeResult, erf(), expectedMaxSharpe(), kurtosis(), mean() (+9 more)

### Community 61 - "Community 61"
Cohesion: 0.13
Nodes (19): D-1: zero market data ever persisted, Revised D-1: live-fetch by design, schema vestigial, Deep Quant Pass & Database Ground-Truth Annex, Gauntlet 7 stages with holdout budget, Deflated Sharpe with selection cost, Bailey-Lopez lineage, Bailey & Lopez de Prado 2014, The Deflated Sharpe Ratio, First validated result: rsi_reversion_30 buried, DSR 0.936, Bridge protocol between two agents (+11 more)

### Community 62 - "Community 62"
Cohesion: 0.17
Nodes (16): ablateStrategy(), AblationOptions, AblationReport, AblationStep, delta(), describeCondition(), entryComponents(), MINIMUM_TRADES (+8 more)

### Community 63 - "Community 63"
Cohesion: 0.16
Nodes (12): AutoGauntletOptions, AutoGauntletReport, AUTONOMOUS_ACTOR, CandleLoader, DEFAULT_DAILY_TRIAL_BUDGET, parseDsl(), runAutonomousGauntlet(), selectTrialCandidates() (+4 more)

### Community 64 - "Community 64"
Cohesion: 0.25
Nodes (13): databasePath(), openDatabase(), seedDefaults(), addColumnIfMissing(), applyEvidenceLifecycleMigration(), applySecurityIntegrityMigration(), backupDefaultDatabase(), columns() (+5 more)

### Community 65 - "Community 65"
Cohesion: 0.17
Nodes (12): closeDatabase(), useTemporaryDatabase(), accumulateForwardEvidence(), dsl(), NOW, passGauntlet(), promotedSpec(), seedSpec() (+4 more)

### Community 66 - "Community 66"
Cohesion: 0.20
Nodes (15): BoardEntry, DECISION_RANK, EligibleStrategy, Proposal, holdoutStanding, Advance, Stage, StageEvidence (+7 more)

### Community 67 - "Community 67"
Cohesion: 0.12
Nodes (18): HITL/AFK slice classification - prefer AFK slices that can be implemented and merged without human interaction, Issue template (Parent, What to build, Acceptance criteria, Blocked by), Vertical Slice (tracer bullet) - thin end-to-end path through all layers, demoable on its own, Complete acceptance criteria - concrete, testable, independently verifiable, Agent Brief - authoritative specification posted on an issue when it moves to ready-for-agent, Behavioral over procedural - what the system should do, not how to implement it, Durability over precision - name interfaces and types, never file paths or line numbers (they go stale), Explicit scope boundaries - prevents gold-plating and assumption about adjacent features (+10 more)

### Community 68 - "Community 68"
Cohesion: 0.15
Nodes (17): Requirement R0: two-mode workstation, Prioritized backlog B-P0-1 to B-P4, Intermittent HTTP 500 finding, MarketPulse OS — Comprehensive Read-Only Audit, Security: loopback mutations, CSRF, HMAC owner sessions, D-6: gauntlet route untracked, 500 on /api/strategy/gauntlet, MCP readOnlyHint vs persistEvidencePackage, Audit annex: Research-Backed Findings (+9 more)

### Community 69 - "Community 69"
Cohesion: 0.23
Nodes (13): bad(), dynamic, GET(), PATCH(), AGENT_TOKEN, OWNER_TOKEN, strategies, AgentConfigPatch (+5 more)

### Community 70 - "Community 70"
Cohesion: 0.23
Nodes (15): DELETE(), POST(), configuredOwnerToken(), cookieValue(), createOwnerSession(), effectivePort(), GovernedActorResult, hasSameLoopbackOrigin() (+7 more)

### Community 71 - "Community 71"
Cohesion: 0.17
Nodes (12): dynamic, Account, money(), Order, PaperOrderTicket(), Portfolio, Position, Blame (+4 more)

### Community 72 - "Community 72"
Cohesion: 0.15
Nodes (15): robinhoodPortfolio, clearHeartbeat(), getRobinhoodStatus(), isRobinhoodLive(), AccountPosition, clearRealPortfolio(), getAccountState(), getRealPortfolio() (+7 more)

### Community 73 - "Community 73"
Cohesion: 0.14
Nodes (17): Accept Dependencies, Do Not Create Them, Bad Test Red Flags, Behavior-Over-Implementation Principle, Good Test Characteristics, Horizontal Slices Anti-Pattern, Interface Design for Testability, Mock at System Boundaries Only, Designing for Mockability (+9 more)

### Community 74 - "Community 74"
Cohesion: 0.19
Nodes (12): dynamic, GET(), CommandCenterPage(), assessIdle(), FindingKind, IDLE_THRESHOLDS, IdleState, inspectMemory() (+4 more)

### Community 75 - "Community 75"
Cohesion: 0.14
Nodes (13): APPEND_ONLY, candidate, IRREVERSIBLE, isWithin(), matches(), normalise(), OWNER_REVIEWED, payload (+5 more)

### Community 76 - "Community 76"
Cohesion: 0.14
Nodes (13): APPEND_ONLY, candidate, IRREVERSIBLE, isWithin(), matches(), normalise(), OWNER_REVIEWED, payload (+5 more)

### Community 77 - "Community 77"
Cohesion: 0.15
Nodes (15): Data honesty: 14 panel states, MarketPulse OS — Architecture, Loss memory and bounded adaptation, Six planes: Control, Evidence, Research, Simulation, Portfolio/Risk, Confirmation, Bloomberg terminal UX design principles, Phase C: loss memory + risk adaptation, Error codes: UNAVAILABLE/NOT_PROVIDED/STALE/MALFORMED/VERSION, Three planes: control/evidence/quant (+7 more)

### Community 78 - "Community 78"
Cohesion: 0.13
Nodes (15): Execution boundary: no agent-to-broker path, Simulation battery: 5 independent attacks, Validation pipeline: source to proposal, Gap audit — video frames vs what exists, Particle brain knowledge visual, Rationale: STALE refuses correct, $0.00 false, Star Map (strategy constellation visual), Validation funnel with survivor counts (+7 more)

### Community 79 - "Community 79"
Cohesion: 0.21
Nodes (13): dynamic, GET(), POST(), MasteryUpdate, GradeFailure, GradeInput, GradeResult, gradeStudyAnswer() (+5 more)

### Community 80 - "Community 80"
Cohesion: 0.20
Nodes (11): DSL_RESOLUTION, failedUntil, fetchMarket(), fetchMarketSample(), instrumentsForMarket(), marketCandleLoader(), marketIsCoolingDown(), REHEARSAL_SAMPLE_SIZE (+3 more)

### Community 81 - "Community 81"
Cohesion: 0.19
Nodes (11): activeChild(), ALL_CHILDREN, APP_DIR, INTENTIONALLY_UNLINKED, linked, reachable, LEGACY_ROUTES, MARKETS (+3 more)

### Community 82 - "Community 82"
Cohesion: 0.15
Nodes (6): dynamic, AiResearchDesk(), AnalysisResult, EvidenceItem, ProviderId, ProviderStatus

### Community 83 - "Community 83"
Cohesion: 0.20
Nodes (8): LearningModeControl(), MODES, KINDS, ResearchIntake(), Activity, Status, SystemPulse(), mutationFetch()

### Community 84 - "Community 84"
Cohesion: 0.14
Nodes (14): Skill description rules - max 1024 chars, third person, 'Use when [specific triggers]', the only selection signal, Progressive disclosure - split files and add scripts for deterministic operations to save tokens, Skill structure - SKILL.md required; REFERENCE.md, EXAMPLES.md, scripts/ split beyond ~100-500 lines, Beat - one move in a narrative journey; stops at a pivot point, sized by what it needs, Beat journey - write starting beat, user picks, offer candidate next beats, loop until natural end, One-beat-at-a-time rhythm - never write ahead, re-read file before every write, preserve user edits, Fragment - heterogeneous nugget of writing mined for raw material; readable by the author, not a cold reader, Fragment file - H1 working title only, fragments separated by horizontal rules, append-only (+6 more)

### Community 85 - "Community 85"
Cohesion: 0.21
Nodes (13): Two workspaces: RESEARCH and EXECUTE, MNQ intraday vs NSE/US daily equities decision, Phase A: two-workspace navigation, GOAL — read this first after any interruption, NSE + US cash equities on daily bars (ADR 0005), Non-negotiable constraints, Rationale: daily engine cannot measure intraday edge, One sentence: two workspaces (+5 more)

### Community 86 - "Community 86"
Cohesion: 0.21
Nodes (13): Rationale: Finnhub key in git history must rotate, Owner-session TTL regression (365d vs 15m), Full Research & Audit v2 2026-08-07, Owner-session gate removed, test red, Test isolation: refuse production DB, useTemporaryDatabase, DNS-rebinding regression suite (GitHub blog 2025), Full Research & Audit 2026-08-07, Simulation CPU-DoS advisory fixed (+5 more)

### Community 87 - "Community 87"
Cohesion: 0.24
Nodes (10): buildScanUniverse(), findNearestSupport(), GET(), PickResult, runScan(), scoreSetup(), TAG_COLORS, tagStyle() (+2 more)

### Community 88 - "Community 88"
Cohesion: 0.21
Nodes (10): dynamic, LibraryPage(), SourceCoveragePanel(), researchLibrary(), Cadence, CoverageReport, RESEARCH_SOURCES, ResearchSource (+2 more)

### Community 89 - "Community 89"
Cohesion: 0.15
Nodes (12): agent_config, market_briefings, news_articles, orders, price_candles, quote_snapshots, robinhood_portfolio, stock_analysis_reports (+4 more)

### Community 90 - "Community 90"
Cohesion: 0.19
Nodes (9): CacheDeadlineError, CacheOptions, cacheSize(), clearCacheForTests(), Entry, inflight, store, timeBucket() (+1 more)

### Community 91 - "Community 91"
Cohesion: 0.29
Nodes (10): AgentConfig, Strategy, evaluateFence(), FenceContext, FenceResult, OrderIntent, makeAccount(), makeConfig() (+2 more)

### Community 92 - "Community 92"
Cohesion: 0.28
Nodes (9): Currency, evaluatePaperOrder(), roundPrice(), SLIPPAGE_RATE, calculatePaperFees(), feePolicyId(), PaperFeeInput, roundMoney() (+1 more)

### Community 93 - "Community 93"
Cohesion: 0.17
Nodes (12): Kronos integration with manifest.ts and kronos.ts, Provenance envelope, ADR 0004 kronos-forecast-intake, Kronos runner specification, Rationale: never regenerate forecasts over history, Two files contract, lookback clamped, Scored vs persistence baseline, Rationale: bricks first, generation only behind declared search (+4 more)

### Community 94 - "Community 94"
Cohesion: 0.18
Nodes (12): ADR Conflict Flagging, Domain Docs Consumer Rules, Glossary Vocabulary Adherence, Multi-Context Repository Layout, Single-Context Repository Layout, Parallel Sub-Agent Review Execution, Two-Axis Review Skill, Standards Review Axis (+4 more)

### Community 95 - "Community 95"
Cohesion: 0.33
Nodes (8): acquireLease(), currentLease(), LEASE_TTL_MS, LeaseOutcome, readHolder(), releaseLease(), SUITE_ROOT, withCycleLease()

### Community 96 - "Community 96"
Cohesion: 0.27
Nodes (11): Path, future_timestamps(), load_predictor(), main(), The Kronos runner — the last piece of the forecast seam. Reads the manifest…, A refusal. Raised rather than writing a file that would be wrong., Mirrors `forecastPath` in lib/forecast/kronos.ts., run_request() (+3 more)

### Community 97 - "Community 97"
Cohesion: 0.17
Nodes (12): Refactor Requirements Interview, Refactor Plan Issue Template, Martin Fowler Refactoring Advice, Request Refactor Plan, Testing Decisions Guidance, Tiny Commits Plan, Deep Modules, Interface Reduction Questions (+4 more)

### Community 98 - "Community 98"
Cohesion: 0.18
Nodes (11): scripts, audit:prod, build, build:mcp, check, dev, start, test (+3 more)

### Community 99 - "Community 99"
Cohesion: 0.18
Nodes (10): after, before, candles, db, FetchedFile, file, outside, removed (+2 more)

### Community 100 - "Community 100"
Cohesion: 0.27
Nodes (10): Phase 2: crossover/crossunder DSL operators, Delta Audit Triage 2026-08-06, Rationale: 9 of 10 P0 claims already fixed in tree, Master Architecture, Workflow and Requirements, Governing principle: prove it works before it trades, Re-el admits: creditor split and SYNTHETIC label, THREEPIO / Millennium Falcon reel reference, Plan — backtest hardening, then India + USA pre-market (+2 more)

### Community 101 - "Community 101"
Cohesion: 0.31
Nodes (10): A Philosophy of Software Design (Ousterhout), Design an Interface, Design It Twice, Deepening, HTML Report Format, Interface Design Exploration, Architecture Language Glossary, Adapter (+2 more)

### Community 102 - "Community 102"
Cohesion: 0.27
Nodes (10): ADR Offering Criteria, Diagnostic Feedback Loop, HITL Loop Template Script, Diagnose, Grill Me, ADR Format, CONTEXT.md Format, Grill with Docs (+2 more)

### Community 103 - "Community 103"
Cohesion: 0.27
Nodes (9): DELETE(), authenticateGovernedActor(), problem(), requireOwnerMutationAccess(), browserRequest(), OWNER_TOKEN, ownerRequest(), request() (+1 more)

### Community 104 - "Community 104"
Cohesion: 0.24
Nodes (7): dynamic, SettingsPage(), AutonomousTradingSettings(), Config, Strategy, StrategyEditor(), isConfigured()

### Community 105 - "Community 105"
Cohesion: 0.31
Nodes (7): isMarket(), MARKETS, MarketSelector(), ModeBadge(), TopNav(), activeSection(), NAV_SECTIONS

### Community 106 - "Community 106"
Cohesion: 0.27
Nodes (10): GitHub Issue Tracker Doc, gh CLI Conventions, Publish/Fetch Mapping (GitHub), GitLab Issue Tracker Doc, glab CLI Conventions, Merge Request Terminology, Local Markdown Issue Tracker Doc, .scratch/ Feature-Slug Layout (+2 more)

### Community 107 - "Community 107"
Cohesion: 0.22
Nodes (9): The autonomous loop (runLearningCycle), Rationale: rehearsal not gauntlet — seal the holdout budget, Spaced-repetition study loop producer, Learning Feature Audit 2026-08-07, Deterministic evidence/governance loop, not model training, Candidate review skipped rather than guessed, knowledge_quizzes no production writer, Phase B: autonomy made visible (run log) (+1 more)

### Community 108 - "Community 108"
Cohesion: 0.22
Nodes (9): MarketPulse control plane - Claude Code reasons; the app holds evidence, memory, deterministic machinery, Evidence discipline - record_analysis rejects stance supported only by inference and analyses with no invalidation condition, Learning mode - off -> observing -> learning -> evolving; 11 actions prohibited in every mode, MCP tool surface - 20 tools, READ (evidence) and WRITE_LOCAL (records); no broker/external/filesystem reach, Quant core bridge - coordinate with E:\Trading_BOT via claims/requests/responses dirs; must not write to it, Learning Mode - governed state machine: off -> observing -> learning -> evolving; never permits financial mutation, MCP Capability Class - READ, WRITE_LOCAL, EXTERNAL_WRITE, FINANCIAL_MUTATION, UNKNOWN; research agents limited to READ/WRITE_LOCAL, False-approval asymmetry - a false approval costs real money; a false rejection costs one idea, and there are always more (+1 more)

### Community 109 - "Community 109"
Cohesion: 0.25
Nodes (9): Analysis Record - cited bull/bear/neutral debate with stance, conviction, risks, invalidation conditions, missing evidence, Epistemic Status - known, historically observed, inferred, not forward validated, conflicting, unknown, Abstain is a real answer - confident call on weak evidence is the failure mode the system exists to prevent, Bull/bear/neutral debate - if you cannot articulate the bear case you do not understand the trade, Epistemic status vocabulary - known, historically_observed, inferred, not_forward_validated, conflicting, unknown, Invalidation conditions - explicit conditions that would prove the view wrong; required on every record, Claim extraction - marketpulse_record_claim, one per assertion; workers archive but never invent claims, Hypothesis registration - marketpulse_record_hypothesis for testable claims; duplicates detected automatically (+1 more)

### Community 110 - "Community 110"
Cohesion: 0.25
Nodes (9): Locked Holdout - limited unbiased validation sample; differs re-query converts it into training data, Paper Challenger - strategy that passed the historical gauntlet and may collect forward paper evidence; not live-approved, Trial Ledger - append-only record of every validation attempt; trial count is part of the multiple-testing denominator, Cost modelling - Indian cash equities carry STT, exchange charges, GST, SEBI turnover fees, stamp duty; 5bps round-trip not realistic, Trial count / selection bias - Sharpe 1.5 from best of 200 configurations is selection, not evidence, Deflated Sharpe - observed Sharpe vs best of N random strategies where N is every trial ever recorded, Validation gauntlet - 7 stages: replay, walk_forward, parameter_stability, causality, cost_stress, monte_carlo, no_trade_comparison, Locked holdout - one query per strategy, ever; append-only ledger prevents budget reset (+1 more)

### Community 111 - "Community 111"
Cohesion: 0.31
Nodes (8): boardDataset(), DECISION_TONE, dynamic, ExecutePage(), revalidate, eligibleMarkets(), TradeBoard, orderTicket()

### Community 112 - "Community 112"
Cohesion: 0.39
Nodes (9): Footer disclaimer - Yahoo-derived research data may be delayed, Market hero header - MKT/XNAS kicker, United States, NASDAQ and NYSE cash equities, market session status with live indicator dot, Row of 4 market leader index cards (AAPL, MSFT, NVDA, AMZN) with price quote and change, Live market data pipeline concept - 30s auto-refresh, market session clock, status-dot-live indicator, Market news feed section of recent headlines, Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI), Research queue panel listing canonical instruments with exchange and native currency, Sector breadth heatmap (Technology, Consumer, Financials, Energy, Broad Market) (+1 more)

### Community 113 - "Community 113"
Cohesion: 0.31
Nodes (7): ExitReason, bar(), GOLDEN_DSL, goldenBars(), lcg(), randomWalk(), ReferenceTrade

### Community 114 - "Community 114"
Cohesion: 0.25
Nodes (8): Failure Memory - durable record of failed ideas, causes, lessons; prevents deletion or accidental repetition, Forward Outcome - observation created after a decision point; distinguished from historical or in-sample results, Learning Plane - governed source-to-outcome chain: source, claim, concept, hypothesis, strategy spec, trial, validation, forward outcome, failure memory, lesson, Research Snapshot - bounded hashable packet of normalized evidence; hash attributes opinion to exact evidence, marketpulse_quantcore checks - board candidate blockers and forwardOutcomes unbiased evidence before forming a view, Forward evidence - live resolved observations are the only unbiased evidence; usually a tiny fraction, Sample size check - <30 out-of-sample trades: no conclusion; <100: effects <0.3R indistinguishable from noise, failure_memory - rejected strategies recorded with enough detail to recognize the same dead end; cannot be deleted

### Community 115 - "Community 115"
Cohesion: 0.29
Nodes (7): NSE + US Equities on Daily Bars (MNQ Out), Read-Only MCP Server (Seven Tools), Canonical Instrument Identity (market/exchange/symbol/currency), Instrument Scope (R1: NSE and US Daily Equities), Free-Tier Intraday Binding Constraint, NSE Real-Time Data Levels (L1/L2/L3/tick), MarketPulse MCP Server (20 tools)

### Community 116 - "Community 116"
Cohesion: 0.29
Nodes (7): Non-standard Next.js - read node_modules/next/dist/docs/ before writing code; block maintained by 'next dev', Paper Research Mode - only in-application order lifecycle; separate USD and INR ledgers, deterministic fills, estimated fees, Quant Core - separate Python system in E:/Trading_BOT; versioned contract over loopback HTTP or approved filesystem artifacts, Disclaimer - decision-support software, not financial advice; real orders are the owner's manual responsibility, MarketPulse OS - local-first equity research terminal for US, NSE, BSE instruments, Quant bridge - versioned JSON contract to E:/Trading_BOT with HTTP-first and filesystem fallback, Tech stack - Next.js 16.3, React 19, TS, Tailwind 4, shadcn/ui, Lightweight Charts, SQLite, Drizzle ORM, Yahoo/Finnhub, Anthropic/OpenAI SDKs, MCP over stdio

### Community 117 - "Community 117"
Cohesion: 0.38
Nodes (5): dynamic, GET(), Order, orders, listOrders()

### Community 118 - "Community 118"
Cohesion: 0.43
Nodes (5): dynamic, ResearchOverviewPage(), experimentLedger(), researchFunnel(), strategyLab()

### Community 119 - "Community 119"
Cohesion: 0.43
Nodes (6): date, bar_time(), fetch(), main(), NSE daily history from the exchange's own bhavcopy, via jugaad-data. ## Why…, Unix seconds at the Indian session open for a calendar day.

### Community 120 - "Community 120"
Cohesion: 0.38
Nodes (6): ai_runs, instruments, paper_accounts, paper_ledger, paper_orders, paper_positions

### Community 121 - "Community 121"
Cohesion: 0.47
Nodes (6): No broker adapter - EXECUTION_ADAPTER_MISSING; no autopilot, no confirm-mode, orders placed manually by owner, Confirmed Live - reserved unavailable capability state; stays false until separate owner/broker/compliance/security reviews, Execution Adapter Missing - fail-closed response of retired live-order endpoints; app cannot authorize or place orders, Manual Advisory Ticket - research suggestion for owner manual orders; no authorization or execution capability, Safety boundary - no broker execution, no Autopilot, manual owner orders - only, MCP exposes reads and local writes only, No order authority - the system has no broker adapter; analysis never implies execution

### Community 122 - "Community 122"
Cohesion: 0.33
Nodes (4): ALLOWED, candidates, PATTERNS, payload

### Community 123 - "Community 123"
Cohesion: 0.60
Nodes (5): DatasetPanel(), spanLabel(), when(), importedDatasets(), storedCoverage

### Community 124 - "Community 124"
Cohesion: 0.33
Nodes (5): MARKETPULSE_DB_PATH, QUANT_CORE_ROOT, QUANT_CORE_URL, node, marketpulse

### Community 125 - "Community 125"
Cohesion: 0.33
Nodes (6): Archive source - marketpulse_record_source, content hashed, re-archiving dedupes; include licence, Licence discipline - AGPL/GPL/LGPL read-and-learn; clean-room reimplementation behind own contracts, Audit decision - REUSE / ADAPT / CLEAN_ROOM / REFERENCE / REJECT with licence analysis, Licence first - GPL/AGPL read-and-learn only; LGPL service boundary only; no licence treated as all rights reserved, Pinned commit - record exact SHA audited; 'Latest' is not a version, marketpulse_record_source - archive audited repo as kind 'repository', locator = commit SHA, verdict as claim

### Community 126 - "Community 126"
Cohesion: 0.33
Nodes (6): Local Status Line Triage, Triage Label Decision (Section B), Five Canonical Triage Roles, Triage Labels Mapping Doc, mattpocock/skills Label Source, ready-for-agent Role (AFK-Ready)

### Community 127 - "Community 127"
Cohesion: 0.47
Nodes (5): BARS, dsl(), lcg(), population(), walk()

### Community 128 - "Community 128"
Cohesion: 0.33
Nodes (5): candles, failures, FetchedFile, file, result

### Community 129 - "Community 129"
Cohesion: 0.50
Nodes (5): Confirm / Autopilot Modes (Superseded), Real-Money-Only Broker (Superseded), Decision-Support Software / Manual Execution Boundary, Execution Boundary (R8: No Broker Adapter), Runtime Execution Boundary (EXECUTION_ADAPTER_MISSING)

### Community 130 - "Community 130"
Cohesion: 0.40
Nodes (5): Strategy Specification - bounded versioned research hypothesis in local Strategy DSL; not an order instruction, indiaRelevant flag - most US equity research does not transfer unchanged to NSE cash markets, Lookahead - survivorship, restatement, point-in-time correctness of earnings dates, Market assumptions - crypto and US equity assumptions rarely transfer to NSE cash markets; look for lookahead/survivorship, Strategy DSL - closed vocabulary of point-in-time features; lookahead becomes a compile error not a backtest bug

### Community 131 - "Community 131"
Cohesion: 0.50
Nodes (4): dynamic, MODE_MEANING, SystemOverviewPage(), dataQuality()

### Community 132 - "Community 132"
Cohesion: 0.50
Nodes (4): Card, days(), Graded, StudyPanel()

### Community 134 - "Community 134"
Cohesion: 0.40
Nodes (5): Validation Gauntlet, Trial Accounting and Sealed Holdout (R3), Measure Modelling Quality Before Buying Data, Reuse Not Rebuild: Feed the Existing Gauntlet, Unbiased Forward Validation (forward_outcomes), Derived, Never Stored Promotion Ladder

### Community 135 - "Community 135"
Cohesion: 0.50
Nodes (5): Exercise Directory Naming Scheme, git mv Rename Workflow, Scaffold Lint Gate (ai-hero-cli), Scaffold Exercises Skill, Exercise Variants (problem-solution-explain)

### Community 136 - "Community 136"
Cohesion: 0.60
Nodes (5): Husky Pre-Commit Hook, lint-staged + Prettier, Package Manager Detection, Typecheck and Test Gate, Setup Pre-Commit Hooks

### Community 137 - "Community 137"
Cohesion: 0.40
Nodes (5): setup-matt-pocock-skills - precondition providing issue tracker and triage label vocabulary, PRD (Product Requirements Document) - synthesized from conversation context, no interview, ready-for-agent triage label - PRDs are published already triaged, Test seams - favor existing seams, use the highest seam possible, ready-for-agent - fully specified, ready for an AFK agent to act on

### Community 138 - "Community 138"
Cohesion: 0.67
Nodes (4): Kronos: Hypothesis Source, Never a Signal, Kronos Foundation Model Intake (R7), Kronos as Bias Engine (BIAS_MODE: KRONOS_FORECAST), Kronos Point-in-Time Forecast Archive

### Community 139 - "Community 139"
Cohesion: 0.50
Nodes (4): Bounded Evidence Package + SHA-256 Snapshot, Deferred Broker Adapter Gate, Local Mutation Security Boundary (requireMutationAccess), Exact-Order Confirmation State Machine

### Community 140 - "Community 140"
Cohesion: 0.83
Nodes (3): capture(), hitl-loop.template.sh script, step()

### Community 141 - "Community 141"
Cohesion: 0.67
Nodes (3): dynamic, POST(), AiAnalysisRequestSchema

### Community 144 - "Community 144"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 147 - "Community 147"
Cohesion: 0.67
Nodes (3): fetch(), main(), Deep NSE history — daily and intraday — via tvdatafeed. ## Why this source,…

### Community 148 - "Community 148"
Cohesion: 0.50
Nodes (3): minutes, outfile, ROOT

### Community 149 - "Community 149"
Cohesion: 0.50
Nodes (4): Flagged ambiguities - same word/different concepts, synonyms, overloaded terms, UBIQUITOUS_LANGUAGE.md - structured output file with term tables, relationships, example dialogue, Ubiquitous language glossary - DDD-style canonical terms with aliases to avoid, Zoom out - go up a layer of abstraction, map relevant modules and callers in domain glossary vocabulary

### Community 150 - "Community 150"
Cohesion: 0.67
Nodes (3): Missing is not zero - never fill a quant-core gap with a plausible number, never treat empty as nothing, Evidence Quality - explicit source state (live, delayed, stale, conflicted, auth-required, unavailable); missing never zero, Quant core absent in CI - bridge must degrade to explicit unavailable states; conformance tests skip themselves

### Community 151 - "Community 151"
Cohesion: 0.67
Nodes (3): Protected paths - governance, security, capabilities, risk, contracts, hooks, mcp, workflows, migrations enforced by hook and test, Guardrail pipeline - typecheck, MCP build, unit/integration, spawned MCP, governance vitest, build, Playwright e2e, prod audit, Prohibited actions policy - broker order-mutation calls and governance prohibitions block CI (lib/governance/policy.ts)

### Community 153 - "Community 153"
Cohesion: 0.67
Nodes (3): Block Dangerous Git Hook Script, PreToolUse Hook Pattern, Git Guardrails (Claude Code)

### Community 155 - "Community 155"
Cohesion: 1.00
Nodes (3): Logic Prototype, Prototype, UI Prototype

### Community 156 - "Community 156"
Cohesion: 0.67
Nodes (3): Data Honesty: Missing Is Never Zero (R9), Determinism Spot-Check, Negative Tests (Break It on Purpose)

### Community 157 - "Community 157"
Cohesion: 0.67
Nodes (3): Two Workspaces (RESEARCH / EXECUTE), Layered Dependency Model (app -> components -> lib), Two Workspaces x 5 Views (Implements R0)

### Community 158 - "Community 158"
Cohesion: 0.67
Nodes (3): Silent-Corruption-First Build Order, 1.7% Configuration Survival Funnel Prior, PriceDomain Gap (Critical)

### Community 159 - "Community 159"
Cohesion: 0.67
Nodes (3): In-Repo Python Quant Core (quant/), Two-Repo Hard Boundary (FOREIGN_TREE), Two-Agent Bridge Coordination

### Community 161 - "Community 161"
Cohesion: 0.67
Nodes (3): guard-writes.mjs PreToolUse Hook, Single-Fault Root Cause (node.exe PATH), Protected Paths (Agent-Uneditable)

## Ambiguous Edges - Review These
- `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` → `Footer disclaimer - Yahoo-derived research data may be delayed`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: shows
- `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` → `Market hero header - MKT/XNAS kicker, United States, NASDAQ and NYSE cash equities, market session status with live indicator dot`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: shows
- `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` → `Row of 4 market leader index cards (AAPL, MSFT, NVDA, AMZN) with price quote and change`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: shows
- `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` → `Market news feed section of recent headlines`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: shows
- `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` → `Live market data pipeline concept - 30s auto-refresh, market session clock, status-dot-live indicator`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: conceptually_related_to
- `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` → `Research queue panel listing canonical instruments with exchange and native currency`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: shows
- `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` → `Sector breadth heatmap (Technology, Consumer, Financials, Energy, Broad Market)`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: shows
- `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` → `Top movers panel - top gainers and losers columns`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: shows
- `Market hero header - MKT/XNAS kicker, United States, NASDAQ and NYSE cash equities, market session status with live indicator dot` → `Live market data pipeline concept - 30s auto-refresh, market session clock, status-dot-live indicator`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: conceptually_related_to
- `Row of 4 market leader index cards (AAPL, MSFT, NVDA, AMZN) with price quote and change` → `Sector breadth heatmap (Technology, Consumer, Financials, Energy, Broad Market)`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: conceptually_related_to
- `Row of 4 market leader index cards (AAPL, MSFT, NVDA, AMZN) with price quote and change` → `Top movers panel - top gainers and losers columns`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: conceptually_related_to
- `Top movers panel - top gainers and losers columns` → `Live market data pipeline concept - 30s auto-refresh, market session clock, status-dot-live indicator`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: conceptually_related_to
- `Research queue panel listing canonical instruments with exchange and native currency` → `Live market data pipeline concept - 30s auto-refresh, market session clock, status-dot-live indicator`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: conceptually_related_to
- `Market news feed section of recent headlines` → `Live market data pipeline concept - 30s auto-refresh, market session clock, status-dot-live indicator`  [AMBIGUOUS]
  E:/BoraTradingTool/dashboard-live.png · relation: conceptually_related_to
- `MEMORY page screenshot (memory map)` → `Summary strip: SOURCES 4 ... STRATEGIES 2 ... LESSONS 3 ... CONTRADICTIONS`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: shows
- `MEMORY page screenshot (memory map)` → `Section header 'THE WHOLE' (meaning ambiguous)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: shows
- `Section header 'THE WHOLE' (meaning ambiguous)` → `Lane CLAIMS (header shows 14/16; 8 boxes drawn)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: conceptually_related_to
- `Lane CLAIMS (header shows 14/16; 8 boxes drawn)` → `CLAIM node (label not OCR-able)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: shows
- `Lane TESTS (count 0)` → `LESSON node, label starts 'brain…'`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: references
- `Lane TESTS (count 0)` → `LESSON node, label starts 'that a tutorial-…'`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: references
- `Lane TESTS (count 0)` → `LESSON node, label starts 'Preventive-…'`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: references
- `Lane TESTS (count 0)` → `STRATEGY node marked 'ORPHAN' (no edges)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: conceptually_related_to
- `Lane TESTS (count 0)` → `STRATEGY node marked 'ORPHAN' (no edges)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: conceptually_related_to
- `SOURCE node (label unreadable at this zoom)` → `CLAIM node, label starts 'Warrating data…' (truncated)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: references
- `SOURCE node (label unreadable at this zoom)` → `CLAIM node, label garbled ('Inderin…'-like)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: references
- `SOURCE node (label unreadable at this zoom)` → `CLAIM node, label 'eligibility…' (truncated)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: references
- `SOURCE node (label unreadable at this zoom)` → `CLAIM node, label 'Neither source presents…' (truncated)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: references
- `CLAIM node, label garbled ('TtE'-like)` → `HYPOTHESIS node, label starts 'disagr-…'`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: references
- `CLAIM node, label starts 'Warrating data…' (truncated)` → `HYPOTHESIS node, label starts 'screen t-…'`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: references
- `CLAIM node, label garbled ('Inderin…'-like)` → `HYPOTHESIS node, label garbled ('I.htri-…'-like)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: references
- `HYPOTHESIS node, label starts 'disagr-…'` → `STRATEGY node marked 'ORPHAN' (no edges)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: conceptually_related_to
- `HYPOTHESIS node, label starts 'screen t-…'` → `STRATEGY node marked 'ORPHAN' (no edges)`  [AMBIGUOUS]
  E:/BoraTradingTool/memory-map.png · relation: conceptually_related_to

## Knowledge Gaps
- **919 isolated node(s):** `block-dangerous-git.sh script`, `PATTERNS`, `ALLOWED`, `payload`, `candidates` (+914 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **37 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` and `Footer disclaimer - Yahoo-derived research data may be delayed`?**
  _Edge tagged AMBIGUOUS (relation: shows) - confidence is low._
- **What is the exact relationship between `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` and `Market hero header - MKT/XNAS kicker, United States, NASDAQ and NYSE cash equities, market session status with live indicator dot`?**
  _Edge tagged AMBIGUOUS (relation: shows) - confidence is low._
- **What is the exact relationship between `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` and `Row of 4 market leader index cards (AAPL, MSFT, NVDA, AMZN) with price quote and change`?**
  _Edge tagged AMBIGUOUS (relation: shows) - confidence is low._
- **What is the exact relationship between `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` and `Market news feed section of recent headlines`?**
  _Edge tagged AMBIGUOUS (relation: shows) - confidence is low._
- **What is the exact relationship between `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` and `Live market data pipeline concept - 30s auto-refresh, market session clock, status-dot-live indicator`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` and `Research queue panel listing canonical instruments with exchange and native currency`?**
  _Edge tagged AMBIGUOUS (relation: shows) - confidence is low._
- **What is the exact relationship between `Live Trading Dashboard Screenshot (dashboard-live.png, 1440x900 viewport, market overview UI)` and `Sector breadth heatmap (Technology, Consumer, Financials, Energy, Broad Market)`?**
  _Edge tagged AMBIGUOUS (relation: shows) - confidence is low._