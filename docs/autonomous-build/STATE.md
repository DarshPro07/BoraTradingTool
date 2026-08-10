# Master mission state
MISSION v7+ installed 2026-08-10 19:15 as the standing mission (self-contained; read it first).

## §62 readiness scores (2026-08-10 19:25 IST — evidence-based, never test-count-inflated)
| Area | Score | Basis |
|---|---|---|
| Data Foundation | 6.5 | canonical store + immutable snapshots + experiment ledgers VERIFIED; intraday depth thin; backfill owed |
| NSE | **7** | FRESH-INSTALL PROOF PASSED 20:30 (prod mode, empty DB → bootstrap → 3,314 rows MAIN+SME+ETF → SBIN/name/ISIN resolve → page renders). Remaining: REIT/INVIT/SME_EQUITY classification partial; suite legs to green |
| USA | 6 | catalog + providers + dashboards work; no sector-index ingestion beyond proxy breadth |
| Quant Core | 7 | registry/analytics/assumptions/scenario/statarb-formation VERIFIED with parity corpus; portfolio/options queued |
| Strategy Factory | 6 | one-flow VERIFIED (both entrances); instrument picker awaits M2 |
| Research Autonomy | 4.5 | cycle triage/breed/rehearse/bury real + visible; no scanner, no CoS, no per-stock researcher yet |
| Scout Integration | **5** | 22:15: ChatGPT-OAuth auth PROVEN (no API key), preflight green (5/7), agent loop starts, India data plane reachable, real call reaches provider. Research legs blocked by PLUS QUOTA (429, resets 2026-08-16 16:42 UTC), not by credentials. Contract+envelope+UI ready |

## 65-SECTION ACCEPTANCE MATRIX — measured, not assumed (2026-08-10 23:05)
Full desktop suite, fresh DB + fresh prod server: **62 passed · 2 skipped · 5 failed**, and the
5 are STALE SPECS not product defects (see FINDINGS 23:05 — front door verified working).
Verdicts by area (VERIFIED = code+API+UI+persistence+real interaction):
- **VERIFIED**: §11 NSE master (fresh bootstrap 3,314 rows) · §13 search core (symbol/name/ISIN
  resolve, specs 1-3 green) · §16/17 canonical store + snapshots (dss_aaa7c28f82d8f30f pinned
  to 2,963 real bars) · §29 Research-this-stock lifecycle (FIXTURE_ONLY by design) · §31
  envelope (10 contract tests incl. fingerprint) · §34/35 Strategy Factory + IR (25 real trades)
  · §37-40 indicators/analytics/assumptions · §41 scenario · §42 statarb formation · §52 forward
  · §53 LIVE/REPLAY (server-attested) · §54 paper · §57 alpha health · §58 Brain (+activity,
  clickable) · §64 desktop verification harness.
- **VERIFIED 2026-08-10 23:45 (M5 — the release blocker is closed)**: §20 Claude Code provider
  (wired through the gateway, not just proven at the CLI) · §27/§28 Agent Gateway seam
  (`lib/runtime/gateway.ts`: provider detection + `runAgent(capability)` + the headless
  claude-code adapter; browser never touches a binary or a credential) · §29 real-provider
  research leg (**FIXTURE_ONLY retired — the fixture driver is deleted, not disabled**) ·
  §30 source verification (citations checked against the exact packet supplied; fabricated
  citations demoted to CONFLICTED, uncited to INSUFFICIENT_EVIDENCE, hand-off gated on
  SOURCE_VERIFIED). Evidence: two live SOURCE_VERIFIED envelopes (SBIN, RELIANCE) with distinct
  fingerprints, real refusals on missing data, browser spec green — see TEST_RESULTS 23:30.
- **IMPLEMENTED_NOT_VERIFIED**: §22/§24/§25 provider registry + runtime profiles + capability
  router (15 tests; router now EXERCISED by every M5 run, but no UI yet).
- **PARTIAL**: §12 taxonomy (0 SME_EQUITY/REIT/INVIT; 422 SM rows typed EQUITY) · §19 Scout
  (auth proven, quota out) · §47 Kronos (reader/manifest exist, no runs).
- **NOT_IMPLEMENTED**: §23 AI runtime startup screen · §32/33 scanner · §59 decision brief ·
  §8 chief of staff · §26 AIJob runtime · §44/45/46 portfolio/options/microstructure.
- **BLOCKED**: §21 Codex (quota → 2026-08-16).

## MEETING WAR ROOM (owner 2026-08-10 22:43) — Task 0 DONE
**TASK 0 COMPLETE 22:50 — see MEETING_EVIDENCE.md.** Real evidence DB at
`.tmp/meeting/evidence.sqlite`: 2,963 daily bars (3y × SBIN/RELIANCE/TCS/NIFTYBEES) + 294 5m
bars, provider-fetched, provenance declared (adjusted ⇒ honestly UNFIT FOR VALIDATION), and
PROVEN to carry the workflow — authored `stg_00f05ed4521b7e32` and backtested **25 trades,
9 net-positive, snapshot dss_aaa7c28f82d8f30f**. The "empty DB kills the demo" risk is closed.
Remaining war-room tasks in order: 1 NSE browser search legs · 2 one real research envelope
(claude -p proven working; reuse ONE session via --resume, ~$0.49/call context overhead) ·
3 envelope → factory → IR · 4 backtest visible in browser = ledger · 5 validate/replay/forward/
paper · 6 Brain deltas · 7 e2e/v7-meeting-release.spec.ts · 8 DevTools pass. Stretch only after:
India sectors, AI runtime boot screen. FREEZE after green.

## M5 DONE 2026-08-10 23:45 — NEXT EXECUTABLE TASKS (in order)
War-room task 2 ("one real research envelope") is **COMPLETE and independently re-runnable**:
`POST /api/research/stock {instrumentId}` → evidence packet from the canonical store →
deterministic features → claude-code headless → typed proposal → MarketPulse source verification
→ envelope. Two live SOURCE_VERIFIED runs recorded. Codex quota is now irrelevant to the meeting
path — Claude Code serves RESEARCH.
1) **DONE 00:15 — envelope persists** (migration 0015 + AgentRun ledger + restore-on-mount;
   refusals recorded too; browser reload proven). **Next: render it on /brain's Researching lane** —
   `listAgentRuns()` exists and nothing consumes it, so autonomy is recorded but still invisible.
2) **DONE 00:45 — war-room task 3, envelope → Strategy Factory** (TCS authored
   `stg_f044275a8bc41e3f` live). Running it caught a real defect: triage read an indicator's
   PERIOD as its THRESHOLD, authoring `rsi14 > 14` — fixed, regression-tested (FINDINGS 00:35).
   **Next for this leg:** the extractor reads only `feature <op> number`, so research prose using
   a band ("RSI-14 between 55 and 70") or a feature-vs-feature comparison ("close above sma_20")
   correctly returns UNCLEAR. Settle the DSL band representation BEFORE coding it.
3) **The 6 pre-existing NSE unit failures** (FINDINGS 23:45) — reproduce the duplicate-ISIN
   `NSE_SECURITY_MASTER_UNAVAILABLE` against the live 3,314-row master before editing specs.
4) Then: §23 AI runtime boot screen · §32/33 scanner · §59 decision brief.

PRIOR NEXT TASK (superseded — M4/Codex is no longer the critical path):
1) **The instant the owner runs the one OAuth command** (BLOCKERS → External): run M4 steps 3–13
   (RELIANCE.NS / TCS.NS / SBIN research · actual data loader used · citations/tool trace ·
   autopilot · hypothesis→signal · backtest · restart persistence · scheduled research), record
   runtime truth, then M5's first real envelope into ResearchThisStock — the component consumes
   it unchanged and retires its own FIXTURE banner via provider provenance.
2) Build the Agent Gateway seam (WORK_QUEUE → AGENT GATEWAY): capability aliases + adapter
   interface + AIJob states + AgentRun ledger, fixture adapter first, /brain renders it.
3) Full desktop suite vs a fresh prod-mode server on a PID-verified free port — measure the
   engine lane's remaining nse-security-master legs.
v7-FINAL additions queued in WORK_QUEUE (Kronos-"Corners" alias check, "core loss" discovery,
§28 noise policy, §35 nightly order, §36 meeting showcase, §37 severity, §9 runtime identity).
| Forward | 7 | shadow trigger-immutable, watermarked, policy-versioned, e2e-proven |
| Paper | 7 | three ledgers, rejections-as-evidence, funds-move-once PK; e2e-proven |
| Risk | 6.5 | fail-closed gate + correlation + loss-memory + cost gates VERIFIED; portfolio-level engine queued |
| UI/Product | 6 | brain cockpit + factory + replay + journeys; India parity + scanner surfaces missing |
| Testing Reality | 6.5 | fresh-server journey discipline in force; flake log live; failure-injection matrix (§57) partial |
| Self-Learning | 5 | study/curriculum/introspection/lessons live; knowledge-vault verification chain (§35) partial |
| Self-Development | 3.5 | proposal governance + build-mode guard exist; §45 worktree loop not yet operating |
| Live Broker Readiness | 2 | contract + effective-dated profiles VERIFIED; no adapter, correctly (P4) |

## §9 baseline verification (this session, fresh-server evidence — see TEST_RESULTS.md)
VERIFIED today: /brain (+activity+clickable lanes), readiness contract, LIVE/REPLAY
(server-attested), guided factory (both entrances), P5 v1 journey, P4A contract+envelope
(9 tests), ResearchThisStock (FIXTURE_ONLY, honestly labelled), nav+MCP truncation fixes.
VERIFIED prior sessions (spot-reconfirmed by suite): identity/trials/holdout, snapshots/
manifests, forward/paper ledgers, alpha health, quant registry/analytics, statarb formation+F.2.
IN-FLIGHT (engine lane): NSE master bootstrap/search + extended meeting journey. FIXTURE_ONLY:
Scout path. MISSING: scanner, CoS, decision brief, India sectors, AI job gateway.

# Prior mission state (2026-08-09 22:51, retained for continuity)

Six coordinated workstreams. Statuses: NOT_STARTED · DISCOVERING · DESIGNING · IMPLEMENTING ·
IMPLEMENTED_NOT_VERIFIED · FAILED · BLOCKED · VERIFIED. IMPLEMENTED never becomes VERIFIED
automatically.

| # | Workstream | Status | Notes |
|---|---|---|---|
| 1 | Forward Evidence Engine (shadow stage) | **VERIFIED** (shadow); paper-stage integration = next slice | `docs/plans/forward-evidence/`; migration 0012; `lib/forward/shadow.ts`; cycle leg; /paper panel; 11 unit tests + desktop e2e |
| 1b | Paper stage for forward challengers | **VERIFIED** 2026-08-10 | docs/plans/paper-forward/; migration 0013; three immutable ledgers; enroll/run APIs; /paper surface; 10 unit tests + e2e journey. Deferred with reasons: resting LIMIT/SL book, partial fills, depth/latency execution model |
| 2 | NSE security master / universe / listing history | DISCOVERING (owned by the OpenCode agent — do not compete) | Their migration 0011 + `nse_securities`/`nse_listing_versions` + `listCurrentInstruments` landed mid-mission and already feeds `snapshotFromStore`. Integrate, verify, never fork |
| 3 | Model router + capability registry | DISCOVERING | Inventory produced: `docs/plans/model-routing/01-current-model-inventory.md`. Router NOT built — per the mission, no router before the inventory is owner-visible |
| 4 | LLM runtime gateway + MCP | NOT_STARTED | Constraint recorded: NO consumer-subscription auth (Claude Max / ChatGPT) as the website backend; Anthropic/OpenAI APIs behind a provider-neutral AiJob service; existing `lib/ai/` adapters are the seed |
| 5 | Multi-model research + disagreement | NOT_STARTED | Depends on 4 (bounded evidence packets; independent runs; disagreement first-class) |
| 6 | Architecture consolidation + desktop Playwright | IMPLEMENTING (standing) | Desktop-only Playwright policy ADOPTED this session (mobile suites not run, not reported); plane map lives in MASTER; duplicates consolidated as found |

## Standing policies adopted this session
- Playwright: desktop Chromium only (1440×900 default). Mobile only when a task is explicitly
  mobile. Never report mobile as verified when it did not run.
- One writer per overlapping file; the NSE plane belongs to the other agent.

## Quant Core mission (2026-08-10)
| Q1 IndicatorRegistry + Analytics + AssumptionRegistry | **VERIFIED (engine level)** | 24 reference tests; UI journeys = Q1b |
| Q2–Q8 | queued in WORK_QUEUE with dependencies | Alpha Health and Microstructure ordered ahead of options per owner |

## P0 PRODUCT-REALITY OVERRIDE (2026-08-10 12:08 — ACTIVE, suspends quant expansion)
Lane split: Claude Code = UI/integration/Playwright/demo · OpenCode = engine/data/autonomy/bridge.
| P0 SystemReadiness + /brain | **VERIFIED 2026-08-10 13:30** | readiness.ts + /api/readiness + /brain + brain.spec green; suite 1429 passed / 2 skipped ×2; tsc clean; /brain linked in chrome (UTILITY_LINKS); MCP truncation envelope now carries ok:false/RESPONSE_TRUNCATED |
| P2 LIVE/REPLAY product surface | **VERIFIED 2026-08-10 13:47** | mode toggle + required instant + server-attested labels; replay-mode spec 2/2 on fresh prod server; docs/plans/p2-live-replay/ |
| P3 Strategy Factory one-flow | **VERIFIED 2026-08-10 14:18** | GuidedStrategyFlow, two entrances, e2e green; docs/plans/p3-strategy-factory/ |
| P1 India parity (UI half) | NOT_STARTED (blocked on engine-lane sector ingestion for data; readiness rows render meanwhile) |
| P5 meeting journey | **v1 VERIFIED 2026-08-10 14:35** | Brain→factory→backtest→REPLAY→Brain-deltas, network-asserted; search/India legs blocked on engine lane's master bootstrap |
| Brain AUTONOMY ACTIVITY | **VERIFIED 2026-08-10 15:12** | six ledger-backed lanes; brain.spec extended; owner's "see the system thinking" directive |
| P7 autonomy audit | **PAUSED by owner override 15:00** — resumes only after the full journey passes on fresh server+DB (NSE search is the gate) |
| Brain clickable lanes (U6) | **VERIFIED 2026-08-10 16:33** | six lanes link to their surfaces; nav asserted in brain.spec; suite 62 passed |
| P4A contract seed | **DONE 2026-08-10 16:29** — IMPLEMENTED_AGAINST_CONTRACT / NOT_INTEGRATION_VERIFIED | lib/research/proposal-contract.ts (+5 tests): ResearchProposal zod (verdict-smuggling refused by .strict()), session states, fixture. Unit suite 1434 passed / 2 skipped |
| U3/U4 Research-this-stock surface | **DONE 2026-08-10 18:45 — IMPLEMENTED_AGAINST_CONTRACT / NOT_INTEGRATION_VERIFIED** | components/research/ResearchThisStock.tsx on /analyze: owner lifecycle IDLE→…; provenance-driven FIXTURE banner (provider==="fixture"); hand-off DISABLED in fixture mode (fixture content never enters the ledger); envelope rendered with model-confidence labelling. e2e/research-this-stock.spec green. Same component consumes real envelopes when M5 lands — no separate demo UI |
| Envelope contract | **DONE 18:40** | ResearchProposalEnvelopeSchema + FIXTURE_ENVELOPE (+4 tests, 9 total): producer cannot invent verification status; inner proposal stays strict |
| UI lane now | Remaining meeting items consume engine deliverables: U1 (M2 search contract), U2 (M3), real U3/U4 wiring (M5), P5 legs. **Engine lane is actively landing M1/M2 mid-session** (resolveInstrument + currency threading observed on /analyze; their nse-security-master.spec has 6 in-flight failures — theirs to close, release-blocking per owner rule) |
| Post-NSE additions | QUEUED (owner 16:30): scanner + /scanner funnel UI · ChiefOfStaff + AgentBudgetPolicy + AgentRun ledger + AUTONOMY CLASS · Daily Decision Brief on /brain |
