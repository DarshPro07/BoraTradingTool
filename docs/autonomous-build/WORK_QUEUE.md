# Work queue (ordered; every item carries its dependency)

## P0 NSE 30-STOCK BREADTH (masterclass A75/C33) — **DONE 2026-08-14, VERIFIED_FOR_DEFINED_SCOPE** (docs/plans/nse-30-breadth/)
The full two-stage breadth acceptance on ONE fresh DB against a production build (`next start`,
isolated dist dir, :3100, identity-gated). **Stage 1 (fresh DB): 34/34** — all 30 stratified
stocks (10 large / 10 mid / 10 smaller incl. MCDOWELL-N, BECTORFOOD) resolve through the real UI,
run research via the real control, and reach the truthful `FAILED :: NO_STORED_DATA` refusal;
catalog ≥30 canonical XNSE, no BSE contamination, search→canonical identity; zero console/network
problems. **Defect found by the program and FIXED** (C35 bug-finder rule): the TEST_MODE fixture
master seeded only 5 securities → first sweep honestly FAILED at 3/30 researchable
(INSTRUMENT_UNKNOWN ×27); `lib/db/index.ts seedTestSecurityMaster` now carries the full pinned
30-symbol acceptance universe (synthetic, TEST_FIXTURE-provenanced identities; computed sync
counts; TEST_MODE + empty-DB gated). **Stage 2 (after product-path ingestion): 38/38** — ingestion
sweep 30/30 INGESTED (260 bars each via `POST /api/market/ingest`, the UI button's own route);
research 30/30 → **PROPOSAL READY** through the real UI with REAL model runs (claude-code CLI) and
citation verification **SOURCE_VERIFIED on every one**; matrix gate
`{"total":30,"researchable":30,"terminals":{"PROPOSAL READY":30}}`, problems 0. **Persistence:**
agent_runs = 30 COMPLETED/SOURCE_VERIFIED + 30 REFUSED (Stage 1's refusals, recorded with equal
weight); price_candles = 30 tickers × 260 = 7,800 bars. Artifact:
docs/plans/nse-30-breadth/matrix-2026-08-14.json. New spec `e2e/nse-30-stock-stage2.spec.ts`
(sweep with MIN_READY≥25 anti-vacuous floor + 30 research tests + completeness gate). STATED
limitation: market DATA fixture-served (deterministic, declared unfit-for-validation); model runs
real; a live-master variant exists via MARKETPULSE_E2E_REAL_BOOTSTRAP=1.
**NEXT (masterclass order): C34-36 Master Golden Journey Playwright program** (deep lifecycle on
6-10 diverse equities: research→hypothesis→strategy→backtest→validation→forward→paper→memory→brain,
every handoff real) · C39 crash acceptance · additional provider adapters.

## P0 REAL ROSTER + EXECUTION BINDING (masterclass A6) — **DONE 2026-08-14, VERIFIED** (docs/plans/real-roster-binding/)
Closes the two production gaps the model-routing leg named. **A6.1:** `lib/runtime/roster.ts`
`buildDetectedRoster(detectProviders())` is now the PRODUCTION default roster (worker path confirmed
by the verifier at the real call site) — discovered `CatalogModel`s become entries with the
catalog's own relative cost and registry-declared capabilities (no fabricated names/benchmarks;
`contextWindow 0` = unreported); a READY non-enumerating LLM (claude-code today) gets ONE truthful
`<provider>:default` sentinel; non-LLM/non-READY excluded; explicit `[]` stays an honest
no-assignments. **A6.2:** `AgentRunRequest.model` → the claude adapter's `--model` (binding IS
supported); the team threads each role's assignment through (sentinel → null → provider default);
the plan records `binding: REQUESTED | PROVIDER_DEFAULT` — the limitation REPRESENTED, never
hidden; executed model still discovered from telemetry, so assigned==executed==recorded is
verifiable. MODEL_SELECTED event now reports the bound model. Tests: roster 5/5 + team [A6.2]
assigned==executed proof + production-default assertions; single path zero-diff (7/7); route()
zero-diff. Binding thread-through MUTATION-PROVEN. Full suite (verifier's fresh run) **152 files /
1789 passed / 2 skipped**, tsc 0. Independent verifier VERIFIED / 0 blockers; its one actionable
residual (event misreport) closed + re-verified. STATED coverage shape: only claude-code has a real
adapter, so the live roster is the one-provider sentinel today — multi-provider enumeration is
proven at unit/fixture level and activates as adapters land.
**NEXT (owner-steered):** owner-facing 1-5 ACTIVE-model selection surface consuming
`buildDetectedRoster` · additional provider adapters (each new READY provider auto-expands the
roster) · surface TeamRun/artifacts/dissent + assignments/binding on /brain.

## P0 MODEL ROUTING (rung 4) — **DONE 2026-08-14, VERIFIED** (docs/plans/model-routing/)
Learned, role-based model selection — the layer ABOVE the unchanged capability→provider `route()`.
`routeRoleModel(req, roster, stats, capability)` (`lib/runtime/model-router.ts`) picks the model that
EARNED a role, scoring on each model's verification-rate/latency HISTORY from the AgentRun ledger
(`computeModelStats`, `lib/runtime/model-stats.ts`) — no hard-coded `if research → X`. Roster-agnostic
(owner's choice): pure policy over a `ModelEntry[]` roster (reused from the existing catalog), fixture
roster for tests, real detected-roster wiring deferred. Verification LEADS the score; unproven models
are TRIED on a prior (never rejected for lacking history); the verification floor bites only for
proven models; a refusal is EXPLICIT with the attempt trail (NO_MODEL_AVAILABLE vs
NO_MODEL_MEETS_REQUIREMENTS) — never a silent downgrade, matching route()'s doctrine. The team records
the router's per-role decision in `TeamExecutionPlan.modelAssignments` when a roster is present (honest
empty default otherwise). `route()` is BYTE-FOR-BYTE unchanged (verifier-confirmed); the invariants
(arithmetic never an LLM, forecast never a chatbot, fallback never silent) are untouched. Router/stats
`model-router.test.ts` 11/11 + team integration 2 (the better-ledger model wins from SECOND in the
roster, proving the LEDGER drives it, not order; ledger-learning proven to bite by a revert-checked
mutation). Full suite 1779 passed / 2 skipped, tsc 0, MCP 4/4, next build 0. Independent verifier
VERIFIED / 0 blockers (read all files, hand-traced the scoring math, confirmed route() zero-diff +
strictly-additive lib/agents diff, root-caused the one full-suite mcp anomaly as environmental
parallelism flake). Its one actionable gap (refusal code classified by re-parsing prose) CLOSED —
now a structural `sawCapableButCapped` flag.
**Owner status wording: Model Router (policy + learned signal) — VERIFIED_INTEGRATION.**
**NEXT (the explicit deferred wiring, owner to steer scope):** build the real detected roster
(`detectProviders()` + a populated model catalog with priors) and BIND execution to the assigned model
(the gateway selecting a specific model), so learned routing drives real runs — today it is exercised
by tests and observable in the plan, but the production caller passes no roster yet. Also: surface
TeamRun/artifacts/dissent + model assignments on /brain; a CI mutation-testing step on the router.

## P0 CHIEF-OF-STAFF / TEAM OS (rung 3, second leg) — **DONE 2026-08-14, VERIFIED** (docs/plans/team-os/)
A bounded semantic team on the verified single-agent slice. A `depth:"deep"` (or `team:true`)
`instrument_research` job escalates DETERMINISTICALLY (`decideTeamExecution`) to a Chief-of-Staff that
builds one shared evidence packet, persists a `TeamExecutionPlan` BEFORE members run, runs 3 members
(Researcher / Source Verifier / Critic — same model) in bounded parallel each producing a PERSISTED
`AgentArtifact` (not chat), then synthesizes deterministically into a `TeamResult` that PRESERVES
dissent, records a chief AgentRun, emits RESEARCH_COMPLETED once, and lets the durable job complete so
dependents wake. Four concepts, not a framework: `TeamDefinition` (static/versioned, pinned by a
`TeamRun`) · `TeamRun` · `TeamExecutionPlan` · `AgentArtifact`. Owner invariants enforced in code:
the CoS coordinates only (no privileged authority — every role READ+RECOMMEND_ONLY by type; strongest
output is a recommendation); failures reuse the existing Job OS grammar (no TeamRetryLoop —
CONTRACT_VIOLATION / provider code / TEAM_BUDGET_EXCEEDED all fall through the generic taxonomy);
deterministic budget the CoS can't widen; **the single-agent path is byte-for-byte unchanged**
(`runtime.ts` zero-diff, verifier-confirmed). Additive migration 0021 (`team_runs`, `agent_artifacts`,
`agent_runs.team_run_id`). Acceptance `lib/agents/team.test.ts` 11/11 (owner's 17 cases + a retry-honesty
regression); single slice still 7/7. Full suite 1766 passed / 2 skipped, tsc 0, MCP 4/4, next build 0.
Independent verifier VERIFIED / 0 blockers (read all files, diffed vs HEAD, reproduced all 17,
mutation-tested dissent itself). Two non-blocking gaps it found were CLOSED + re-verified: a stale
FAILED member row on retry (→ `recordAgentRun` now `onConflictDoUpdate`, latest outcome wins, proven
by test [15b]); an unguarded member throw (→ wrapped → clean coded failure). One inherited risk
DOCUMENTED not fixed: "exactly once across a whole-process crash" — the single-agent path
(`bridge.ts:556`) shares the identical emit-then-complete pattern; it's a Job-OS-level idempotent-
completion follow-up, out of this slice's scope.
**Owner status wording: Agent/Team OS Core — VERIFIED_INTEGRATION.**
**NEXT (owner-directed): 1-5 model routing (rung 4)** — now with real roles/tasks/team contracts as a
meaningful destination. Router consumes role requirements + provider health + cost + latency +
historical AgentRun verification rate → model assignment. Do NOT hard-code if-research→X; learn from
the AgentRun/TeamRun ledgers. Optional near-term: model-based synthesizer (config swap, version bump);
checkpoint-resume of completed members on retry; surface TeamRun/artifacts/dissent on /brain.

## P0 FIRST AGENT SLICE (rung 3) — **DONE 2026-08-14, VERIFIED** (docs/plans/agent-first-slice/)
The Job-OS → Agent → Model → Ledger → Event → dependent-wake seam, proven end to end. New durable
kind `instrument_research` runs a **versioned specialist agent** through the existing gateway/bridge
and records ONE AgentRun with provenance. The owner's load-bearing invariant is enforced structurally:
**AgentDefinition (static, versioned — `lib/agents/definitions.ts`, `RESEARCH_INSTRUMENT_V1`) is
DISTINCT from AgentRun** — the run pins the definition by `version`, never by copying the prompt, so a
future prompt change can't make historical runs irreproducible. The agent holds READ + RECOMMEND_ONLY
only (no trial spend, no order — it recommends, deterministic governance decides). Every failure
returns to the Job OS / Dependency Resolver: provider-down → FAILED + coded throw (retry); invalid
output → FAILED (CONTRACT_VIOLATION); INSTRUMENT_UNKNOWN → REFUSED + kill; NO_STORED_DATA → REFUSED +
auto-enqueued ingestion AND a dependent research job (deferred, resumes when bars land). Handler
records once (bridge called with `record:false`); provenance columns added via additive nullable
migration `0020`. Acceptance: `lib/agents/instrument-research.test.ts` 7/7 (5 handler-logic injecting
a fake core + 2 full-path through `runWorker` with ONLY the gateway mocked — real bridge, real
citation verification, real event bus); provenance assertions proven to BITE by a revert-checked
mutation. Full suite 1755 passed / 2 skipped, tsc 0, MCP 4/4, next build 0. Independent verifier
VERIFIED / 0 blockers (read all files, re-ran everything, traced every assertion to its production
line, audited fake-completion → 0 across `lib/`); its two non-blocking coverage gaps (success-path
provider/model assertion; a worker-driven failure integration) were CLOSED and re-verified.
**Owner status wording: Job OS Core Mechanics — VERIFIED_INTEGRATION (not "complete").**
**NEXT (deferred to owner steer, in order):** (1) Chief-of-Staff / team coordination — ONE manager,
domain agents, dynamic workers, artifacts-not-chat, bounded team size, dissent preserved; (2) 1-5
model routing ABOVE the agent layer, consuming empirical AgentRun history. Optional near-term
hardening: surface agent identity on /brain's Researching lane (columns exist, unshown); a registry
lint that forbids editing a shipped AgentDefinition in place (bump, don't edit).

## P0 JOB OS COMPLETION (rungs 1-2) — **DONE 2026-08-14** (docs/plans/job-os-completion/)
Rung 1: structured warm-up refusals — `warmupBarsFor` + `FEATURE_WARMUP_BARS` (pinned against the
real feature panel so it can't drift); `SignalSweep.warmups` carries the owner's TWO-CONCEPT split
`{barsHeld, barsNeeded, timeGated}` — DATA shortage (countable, ingest more) vs TIME gate (enough
bars, session/opening-range window not closed → market clock resolves). Rung 2: two durable kinds
wired to REAL deterministic handlers — `paper_reconcile` (runPaperPass, bar-time only, idempotent)
and `incident_repair` (runSelfRepair, fixes only provably-understated costs, audited, never touches
code/governance). `forward_resolve` deliberately skipped (redundant with forecast_resolve or
network-dependent). 148 files / 1752 passed / 0 failed; verifier PASS 0 blockers.
**NEXT — rung 3 (Agents/Teams):** first slice **DONE + VERIFIED** — see the P0 FIRST AGENT SLICE
section at the top. Remaining rung-3 legs (Chief-of-Staff team coordination, then 1-5 model routing)
are deferred to owner steer.

## ✅ GOVERNANCE RESOLVED — Trial Budget Governor (docs/plans/trial-governor/, mode-taxonomy/)
Owner decided (2026-08-14): removed `run_gauntlet` from the broad `AUTONOMOUS_PERMITTED`; the
deterministic Trial Budget Governor (`lib/strategy/trial-governor.ts`) is now the SOLE authorizer
of a trial spend — OFF by default (`MARKETPULSE_AUTONOMOUS_TRIALS=1`, dedicated owner switch,
never the mode/model). Safe by default again: no autonomous trial unless the owner enables the
lane. `auto-mode.ts` landmine deleted; stale comments corrected; mode-coercion honesty fixed on
non-protected surfaces (mode-taxonomy Option A — the protected `getLearningMode` coercion + 4-value
type — still owner-to-apply). Verifier PASS 0 blockers, 7/7 incl. sole-path.
**Trial-budget durability — DONE 2026-08-14** (docs/plans/trial-reservation/): the file-lease
budget fix was replaced by a **durable trial reservation** (drizzle/0019) — a `UNIQUE(trading_date,
budget_slot)` atomic exclusion, `id` as a fencing token (zombie finalize rejected), an explicit
state machine (RESERVED→SPENT/RELEASED/ABANDONED), stale reclaim, and restart reconstruction.
`withAuthorizedTrial` finalizes on LEDGER TRUTH (consume iff a selection_trial landed), closing a
latent budget undercount the verifier found. All 7 owner adversarial scenarios pinned; atomic
exclusion empirically proven (SQLITE_BUSY + SQLITE_CONSTRAINT_UNIQUE). 147 files / 1735 passed / 0
failed; verifier PASS 0 blockers. The autonomous trial lane (`MARKETPULSE_AUTONOMOUS_TRIALS=1`) is
now fully safe to enable. Still open: the uncommitted single-RUN/ownerless-auth refactor awaits the
owner's commit decision + the mode-taxonomy protected-file edit (Option A).

## P0 CONTINUOUS CHAIN (rung 3) — **DONE 2026-08-14 ~02:00** (docs/plans/continuous-chain/)
WakeInstant split (epochMs schedules, display presents — the lexical-bug class closed) ·
event-driven job wake (JOB_CREATED/JOB_COMPLETED → drain; 5s timer kept as reconciliation) ·
auth boundary adversarially proven (16 forged-request attacks rejected, happy path allowed —
the owner's gate before autonomy expansion) · durable `backtest` kind (real specId event) +
double-gated `validation` kind (nothing autonomous enqueues it) · **continuous-chain proof**:
backtest → BACKTEST_COMPLETED → dependent wakes waiting_dependency→queued→succeeded in one sweep,
no owner; unconfirmed validation dies with 0 trials. 146 files / 1712 passed / 0 failed; verifier
PASS 0 blockers. **NEXT:** structured warm-up refusals (panel barsHeld/barsNeeded) · durable-kind
ladder (forward_resolve/paper_reconcile/incident_repair, each WITH its handler) · Agents/Teams as
job workers · then 1-5 model routing.

## P0 PROTECTED-PATH PROVENANCE — **RESOLVED 2026-08-14 00:42** (docs/plans/protected-path-provenance/)
Owner-gating item before further schema work. `drizzle/0014_autonomy_default.sql` (applied
migration, edited in place by an earlier session) **restored to canonical** after proving the
edit dead three ways: the runner executes a TS twin (`migrate.ts:200`), applied migrations never
re-run, and runtime coerces the stored mode anyway (`runtime.ts` + `auto-mode.ts` — the
single-RUN refactor). **No data migration needed**; optional one-line 0019 recorded, not taken.
The wider single-RUN/ownerless-auth refactor (governance/policy +4 allowlisted actions incl.
run_gauntlet, security/request local-session rewrite, owner route deleted) stays as inherited
test-green owner-directed WIP — NOT committed, auth surfaces NOT e2e-verified yet (named risk).

## P0 DEPENDENCY GRAMMAR v2 — **DONE 2026-08-14 ~00:50** (docs/plans/dependency-grammar/)
The owner's one-grammar directive: 9 prerequisite kinds (DATA/TIME/MARKET_STATE/FUTURE_EVENT/
PROVIDER/JOB/CAPABILITY/EXTERNAL_AUTH/PERMANENT_FACT) → 6-way BlockedClass (RESOLVABLE_NOW/
LATER/ON_EVENT/VIA_ALTERNATIVE/EXTERNAL_REQUIRED/IMPOSSIBLE) with dominance + `nextCheckAt`
(min-wake, never a fabricated ETA). **Two-concept warm-up rule pinned by test**: TIME satisfied +
market open + DATA missing → NOT ready; the same composition becomes ready through the durable
queue with no owner. Job OS grew its first non-ingestion kinds WITH real handlers:
`forecast_resolve`, `memory_validate` (ladder documented in queue.ts — no decorative enum
entries). CycleReason gained dependencyType/retryClass/instrument/jobId.
**NEXT in this lane:** structured warm-up refusals (panel `ready()` → barsHeld/barsNeeded) ·
event-driven queue wake beyond the 5s lane · durable kinds ladder (backtest → validation →
forward_resolve → paper_reconcile → incident_repair), each WITH its handler · then Agents/Teams
as workers on those jobs · then multi-model routing above.

## P0 DEPENDENCY ENGINE — **DONE 2026-08-13 (late)** (docs/plans/dependency-engine/)
The owner's feedback chain on Resolver v1, all five rungs: failure taxonomy (PERMANENT dies on
attempt 1; dead RETRYABLE **revives after 15m cooldown** — a corpse's dedupe key no longer blocks
remediation of a transient outage forever) · generic resolver (`lib/brain/dependency-resolver.ts`,
six truthful states; cycle delegates; **self-resolution loop test passes** — blocked → job
auto-created → worker → SATISFIED, no owner) · typed reasons (`CycleReason` w/ severity;
**configured-but-unreachable quant core now degrades the run**, proven fail-first; warm-up stays
INFO) · forecast resolver (DATA_INGESTED → store-only grading the moment bars land, no cycle) ·
eligibility clock (waiting reasons carry `resumeAt` from `getMarketPhase`).
Suite 142 files / 1675 / 0 failed; tsc 0. **NEXT in this lane:** event-driven wake for queue jobs
beyond the 5s research lane; per-strategy warm-up bar arithmetic; DataRequirement
timeframe/session dimensions when an intraday consumer exists.

## P0 §9 RUNTIME IDENTITY — **DONE 2026-08-11, VERIFIED** (docs/plans/runtime-identity-control-audit/)
`GET /api/system/identity` (build/commit+dirty-hash · pid · start · schema · database fingerprint,
never the path) + a Playwright `identity` setup project both browser projects depend on. Proven in
four states: correct → pass · wrong database → **150 tests did not run** · foreign server → named
diagnosis · stale server → names the pid to kill. It caught its own defect mid-session: a
"restarted" server reported the same pid because the old process still held the port and the new one
died of EADDRINUSE — nine minutes of e2e had already run against the wrong configuration. Hence
`MARKETPULSE_E2E_EXPECT_STARTED_AFTER`, since build/schema/database were identical and only the
ENVIRONMENT differed.
**NEXT in this lane:** the 15-route control inventory, now that its answers can name their server.

## P0 — spaCy resolver rebuilt per request — **FIXED + VERIFIED 2026-08-11** (docs/plans/parser-worker-lifetime/)
`hypothesis-author.ts:155` built the resolver in a DEFAULT PARAMETER, re-evaluated every call.
**Interpretation 20,000ms → ~530ms steady state, measured on a real server.** Shared per-process
worker; borrower no longer disposes it; route returns a stated 503 not a 500; readiness has a
non-spawning "Syntax parser" row (warm/pid/model); supervisor warms it on Start. Regression test
proven by failing first. The 20s was NOT the model: `import spacy` 14.5s + `spacy.load` 20.7s
because **torch and transformers load for a model needing neither** — environment, reported not
fixed (removing them would take boot ~35s → ~1s).

## P0 NOW TOP OF THE RESEARCH PATH — AMBIGUOUS_ATTACHMENT (exposed once the latency was removed)
The parser fix cleared **no** e2e failure; it removed the mask. The dominant failure is now a
compiler verdict, fast instead of slow: `UNCLEAR — No entry rule could be read. 2 clause(s) named a
feature but stated no usable threshold: AMBIGUOUS_ATTACHMENT, AMBIGUOUS_ATTACHMENT` where specs
expect EXPRESSIBLE. Hits strategy-factory:22, golden-journey:257, dataset-ledger:143. This is the
already-queued "wire resolveAttachment into compileResearchProse" task. Engine lane.
Also still open and NOT parser-related: `golden-journey:71` exceeds 300s (undiagnosed), NSE search
navigation (2 specs).

## P1 DATA IDENTITY — NSE/BSE collapse (found 2026-08-11, owner-observed)
`lib/strategy/dsl.ts:12` maps both `"NSE"` and `"BSE"` to `"IN"`, so an NSE-only universe cannot be
enforced; `lib/market/catalog.ts:59-68` hardcodes ten XBOM instruments under `"IN"` — the `.BO`
candidates seen under `orb_nse_5m`. See FINDINGS. Needs its own gates.

## P0 §66 — RESEARCH DEAD-ENDS ON AN UNINGESTED INSTRUMENT (owner hit this live, 2026-08-11 03:47)

`Research this stock` on `IN:XNSE:360ONE` returned:

> NO_STORED_DATA — The canonical store holds 0 daily bars for IN:XNSE:360ONE; 60 are required.

**The refusal is CORRECT and must not be softened.** `lib/research/bridge.ts:96` refuses rather
than researching an instrument it cannot see — that is the guardrail working, and lowering the bar
or synthesising history would be exactly the fabrication the product forbids.

**The defect is that the product offers no way out.** The only path to ingest history is two manual
CLI steps the owner must know about and run outside the app:

1. `quant/nse_history.py` → writes `nse-daily.json`
2. `npx tsx scripts/import-nse-history.mts [path]` → `persistCandles` + `recordDatasetImport`

There is **no API route** for either (`app/api/market/` has only `instruments` and `quote`). By the
V7 §4 standard — a capability is not complete if the user must run a CLI, execute a script, or know
an internal ID — this whole path is `BACKEND_ONLY`.

**Required:** the refusal must carry an ACTION. "Ingest history for this instrument" should be a
control on the research surface that runs fetch→import server-side, streams progress, and re-enables
research when the 60-bar floor is met. It must keep the import's existing honest declarations
(`adjustment: "none"`, `includesDelisted: false`, therefore UNFIT_FOR_VALIDATION) — the point of
that import is the declaration, not the bars.

Not started. Depends on nothing in the parser work.

## SYNTAX ATTACHMENT — **PARSER PROVEN 2026-08-11 03:40, NOT YET WIRED IN**
Full detail and the exact next task: `docs/plans/syntax-attachment/00-status.md`. Checkpoint `f852a31`.

Built and verified: `quant/syntax_parser.py` (persistent spaCy worker, one model load, syntax only),
`lib/research/syntax/resolver.ts` (`SyntaxAttachmentResolver` — the compiler never imports spaCy),
`lib/research/syntax/attachment.ts` (COPULA / QUANTIFIER / COORDINATED climbs, else
`AMBIGUOUS_ATTACHMENT`). **10/10 operators attached correctly, 0 wrong**, on the real
TCS/RELIANCE/NIFTYBEES/SBIN prose via the running worker
(`npx tsx scripts/verify-syntax-attachment.mts`). Suite 1538 → 1544, tsc clean.

**Model pinned `en_core_web_sm` 3.8.0 ON MEASUREMENT, against expectation** — 86% vs
`en_core_web_trf` 79% on this corpus, 8.6× faster. Generic parser benchmarks did not transfer.

**Config is mandatory, not discoverable** — `SYNTAX_PARSER_PYTHON` /  `SYNTAX_PARSER_MODEL`.
`python` first on PATH here is `/d/hermes/hermes-agent/venv/Scripts/python` and has no spaCy.

**NEXT EXECUTABLE TASK:** wire `resolveAttachment` into `compileResearchProse`, deleting the five
positional rules (`semantic-compiler.ts:461,482,506,622-627,668-671`). Feed the **ORIGINAL** prose
to the parser — `:576` currently hands the masked text to everything, and masking alters syntax;
keep the mask for clause segmentation only and merge by character offset. All existing guards still
run after attachment. Then items 11–14 (corpus acceptance, metamorphic, cross-layer parity,
parser provenance persisted with the authored strategy).

**BLOCKER (external to this work):** `agent_runs` and `stock_analysis_reports` are **both empty** —
there is no persisted research envelope, so any Golden-Journey step specified as "replay an already
persisted SOURCE_VERIFIED envelope" cannot run until a live provider run persists one.

**NOT A CODE DEFECT:** the `/ai` hydration mismatch the owner hit is a stale `.next` client bundle
(`UTILITY_LINKS` is a frozen literal with no branching; server had `/brain`, client did not).
Stop dev server → delete `.next/` → restart. Must be cleared before the DevTools gate.

## M5 RESEARCH BRIDGE — **DONE 2026-08-10 23:45** (was the meeting-release blocker)
Path built, live-proven, and re-runnable: browser → `POST /api/research/stock` →
`lib/research/bridge.ts` → `lib/runtime/gateway.ts` → headless `claude` → typed envelope.
- `lib/runtime/gateway.ts` — the Agent Gateway (§27/§28). `detectProviders()` probes what this
  machine can actually serve; `runAgent({capability})` routes through the existing capability
  router and executes. Only claude-code has an adapter; every other provider reports
  NOT_DETECTED **with its reason**, so an unimplemented adapter can never look like an
  unavailable one. Binary discovery: override → PATH → `~/.local/bin` (fresh-install safe).
- `lib/research/bridge.ts` — evidence packet (canonical store bars + features computed by the
  QUANT CORE before the call) → sha256 fingerprint → model → `verifyProposalSources()` →
  envelope. Three verification outcomes, each a different kind of result:
  SOURCE_VERIFIED / CONFLICTED (some citations unsupplied) / INSUFFICIENT_EVIDENCE (none).
- `components/research/ResearchThisStock.tsx` — fixture driver DELETED. Hand-off enabled iff
  SOURCE_VERIFIED; unverified real runs carry a banner as loud as the old fixture one.
- Contract: `researchRun.costCurrency` added — Claude Code reports USD and the UI hardcoded `₹`.
  A bare number under the wrong symbol is a fabricated conversion.
**PERSISTENCE DONE 2026-08-11 00:15** — migration `0015_agent_runs.sql`, `lib/runtime/agent-runs.ts`
(recordAgentRun / latestResearchRun / listAgentRuns), `GET /api/research/stock?instrumentId=`,
restore-on-mount in the surface. Refusals land in the ledger too. Live round-trip + browser reload
proven (TEST_RESULTS 00:15).
**REMAINING (next slice, in order):**
1. `/brain` Researching lane renders `listAgentRuns()` — the ledger exists and nothing shows it
   yet, so autonomy is recorded but still invisible. Small: one panel over an existing function.
2. **DONE 00:35 — hand-off wired** (envelope → `/api/research/hypotheses` → triage → authored
   spec; provenance — run id, evidence fingerprint, verification status, researcher-declared gaps
   — travels into the hypothesis rationale so "which run produced this strategy" stays answerable).
   Proven live: TCS → `EXPRESSIBLE` → `stg_f044275a8bc41e3f`. **That run also exposed the
   period-as-threshold defect (FINDINGS 00:35), now fixed.**
   **REMAINING and it is the real blocker for this leg:** the extractor only reads
   `feature <op> number`. Real research prose says "RSI-14 between 55 and 70" and "close above
   sma_20" — a band and a feature-vs-feature comparison — so NIFTYBEES correctly returns UNCLEAR.
   Design question to settle BEFORE coding: the DSL `Condition` is a single {feature, op, value},
   so a band needs either a two-condition entry or a new condition type. **Do not shortcut it to
   `gte lowerBound`** — dropping the upper bound silently is the same defect class just removed.
3. Unit coverage for `agent-runs.ts` (currently proven live and by e2e, not by unit test).


## AI RUNTIME BOOT GATE (owner directive 2026-08-10 22:29 — CORE v7 CAPABILITY, not a setting)
**Landed 22:35 (engine core):** `lib/runtime/providers.ts` (ProviderRegistry: claude-code · codex
· anthropic-api · openai-api · deepseek · scout · kronos · local-model — each with transport,
auth, **costClass SUBSCRIPTION|API|LOCAL|SERVICE**, kind LLM|FINANCIAL_MODEL|RESEARCH_SERVICE,
capability flags, enableHint; DetectedProvider carries status/reason/models/quota — model ids are
DISCOVERED, never literals in our source) + `lib/runtime/routing.ts` (capabilities DETERMINISTIC ·
TIME_SERIES · CHEAP · FAST · RESEARCH · DEEP_REASONING · CODING · INDEPENDENT_REVIEW; five
profiles SUBSCRIPTION_FIRST/LOW_COST/BALANCED/MAX_QUALITY/CUSTOM with BudgetPolicy; `route()`
returning requested/resolved/**fallbackReason**/costClass or a refusal with the full attempt
trail). **13 tests green, tsc 0.** Invariants under test: arithmetic is NOT routable (DETERMINISTIC
always → quant core, even with every model available); TIME_SERIES refuses rather than letting a
chatbot answer a forecast; fallback is never silent (the 2026-08-10 Codex 429 is encoded as a
test); a subscription is never called free; the daily API cap blocks metered spend while prepaid
capacity keeps working.
**REMAINING (UI lane, next):** `/startup/ai-runtime` boot screen (providers detected + profile
radio + budget inputs + routing table + "ask me every restart" default ON) · `/settings/ai` ·
/brain AI RUNTIME panel (provider health, profile, spend-vs-cap, fallbacks) · boot detection
probes · RuntimeProfile persistence + AIJob.runtimeProfileId provenance.
**SAFETY RULE**: deterministic recovery (DB, forward/paper reconciliation, market clock, risk,
security master, feed monitoring) must NEVER wait on this screen — only model-dependent work does.

## AGENT GATEWAY / MODEL ROUTER (owner architecture 2026-08-10 21:55 — implements §37/§38/§32)
Path: Browser → Next.js API (AI JOB API) → **local Agent Gateway** → agent process. The browser
NEVER executes an agent binary; shell access and credentials stay out of browser JavaScript.
- **Capability aliases** (the website never names a vendor): DEEP_REASONING · FAST_REASONING ·
  CHEAP_REASONING · CODING · RESEARCH · FORECAST · DETERMINISTIC. Website asks
  `runAgent({capability, instrument})`; the router picks the adapter.
- **Adapters**: claude-code (headless, local subprocess — see DECISIONS ToS boundary) · codex ·
  scout · forecast-model (Kronos — a TIME-SERIES model, never a chatbot; never owns fees/P&L/
  backtest accounting/risk/broker rules) · llm-api (Console keys) · fixture.
- **Hard routing rules**: DETERMINISTIC_CALCULATION may NEVER route to an LLM; deterministic
  engines own math/P&L/fees/backtests/risk. A missing adapter REFUSES with a named reason and
  records the fallback — never a silent downgrade.
- **AIJob** (§38 states already mandated): QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED + jobId,
  type, agent, requestedCapability, sessionId, startedAt, resultArtifactId, tokens/cost,
  fallback reason. The web request must NOT hang — job + stream, UI shows step progress
  (✓ loading NSE evidence · ● deep research · ○ challenge · ○ generate strategy).
- **Session continuity**: create/resume agent sessions (e.g. an SBIN research session resumed
  when quarterly results arrive) — BUT durable research facts live in the MarketPulse Knowledge
  Vault, never only in an agent's conversation context.
- **Chief of Staff governs cross-calls** (Claude may request a Kronos forecast or a Codex second
  opinion) so agents cannot call each other unboundedly; AgentBudgetPolicy caps agents/tokens/
  time/tools; every run lands in the AgentRun ledger and renders on /brain.

## v7-FINAL execution-order additions (owner 2026-08-10 20:25; MISSION stays authoritative)
- §26 Kronos alias: owner's "Corners" = Kronos. Inventory actual integration before any work;
  never invent a "Corners" model. (Existing reality: file-contract reader + manifest + live
  scoring vs persistence exist; weights at D:\models\kronos.)
- §27 "core loss": discover meaning from actual ML/Kronos training code; never invent a loss
  function; ask owner only if genuinely design-changing.
- §28 noise/retraining policy: RAW→QUALITY→NORMALIZATION→ANOMALY→CLEAN/FLAG/QUARANTINE→
  VERSIONED DATASET→TRAIN→VALIDATION→LOCKED TEST→FORWARD; never delete real crashes as
  outliers; never re-peek locked test until success.
- §35 nightly order · §36 tomorrow meeting showcase (REPLAY-based; every screen labels
  LIVE/REPLAY/FIXTURE/RESEARCH_ONLY/PAPER) · §37 severity policy (P0/P1 never postponed for
  P2/P3 quant) · §9 runtime identity (PID/start-time/build fingerprint/schema/app version
  exposed — queued; the foreign-listener traps this session are the motivating defect).

1. **DONE** — WS1 shadow stage (this session): challenger/signal/outcome + policy + scorecard +
   cycle leg + UI + tests + desktop e2e.
2. **DONE 2026-08-10 — WS1b paper stage** (docs/plans/paper-forward/). Remaining sub-items fold into later broker work: resting order book, partial fills, depth/latency model, forward-vs-paper drift view (needs accumulated history). Original scope: route MEETS_POLICY challengers' eligible signals into the existing
   paper engine (trade board → forward-driver ledger); paper capital/sizing/limits block
   impossible positions (owner test 10); promotion `paper_forward` rung reads BOTH ledgers
   distinctly. Depends: live shadow evidence accumulating (market-time, not software-time).
3. **WS2 — verify + integrate the other agent's NSE work** once they mark it complete: review
   0011, sync jobs, point-in-time universe (`UniverseSnapshot` pinning for cross-sectional
   experiments), search states, back-listing ingestion jobs. Blocker: their completion signal.
4. **WS3 — ModelCapabilityRegistry + ModelRouter** from the inventory doc; typed task classes;
   provenance block in every model-derived UI result.
5. **WS4 — AiJob service + provider adapters (Anthropic/OpenAI/fake) + MCP read/write scoping**;
   async job model with QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED; no consumer tokens.
6. **WS5 — disagreement layer** on one evidence snapshot; AGREE/PARTIAL/MATERIAL/INSUFFICIENT.
7. **WS6 — continuous**: consolidate duplicates met along the way; desktop golden journeys per
   major feature.

## Audit-derived additions (owner repo audit, 2026-08-09 23:32 — see docs/external/repo-audit-2026-08-09-intake.md)
8. **DONE** — BrokerAdapterContract + capability declarations + error taxonomy + contract-test
   categories (lib/broker/adapter-contract.ts, clean-room; 5 tests). Paper adapter implements it
   in WS1b; Kite later, credentials via local env only.
9. IndicatorRegistry behind our own Indicator Contract (catalog mined from openalgo-indicator-skills,
   MIT; never their market heuristics or timezone stripping).
10. DeterministicMarketClock — **first consumer DONE** (/api/forward/run accepts asOf, validated;
    the watermark still forbids retroactive signals, so travel cannot rewrite history). A shared
    clock module waits for a second consumer (YAGNI until then); replay-driven Playwright
    journeys build on asOf.
11. STATISTICAL_ARBITRAGE/PAIRS research family (IntManear methodology, rebuilt on our snapshots;
    needs cointegration/hedge-ratio features → enters via NEEDS_FEATURE triage, honestly held).
12. Algo-Trading-Map taxonomy → research-vault topic seeds (CC0; links verified at fetch time).
13. Feed/broker failure-simulation suite (zero-ticks, reconnect gaps, token rollover, duplicate/late
    ticks, leak-after-100-reconnects) — builds WITH the live feed plane, not before it.

## Quant Core mission (owner directive 2026-08-10 09:27 — supersedes item ordering above where they overlap)
Q1+parity. **DONE 2026-08-10** (features.ts cross-pin landed: registry-parity.test.ts pins values AND missing-ness) — IndicatorRegistry v1 (lib/quant/indicator-registry.ts: SMA/EMA/EWMA/RSI/
    MACD/ATR/Bollinger/RVOL/rolling vol/zscore/correlation + session VWAP export; warmup=null
    contract; deferred with reasons: ADX, covariance-matrix/PCA→QuantMathKernel, VWAP registry
    entry with session map) + Risk/Performance engine (lib/quant/analytics.ts: Lo-adjusted Sharpe
    beside naive, historical VaR/ES beside labelled normal VaR, honest nulls) +
    ModelAssumptionRegistry (lib/quant/model-assumptions.ts, display-gating: unregistered model
    throws). 24 reference tests.
Q1b. **DONE 2026-08-10** — /api/quant + /api/quant/analytics + QuantAnalyticsPanel on /strategies; desktop journey green (docs/plans/quant-core/). Hardening 1-7 complete (ADX still parity-gated; ta-lib wheel had no binary here).
Q2. **DONE 2026-08-10** — AlphaHealthMonitor (lib/quant/alpha-health.ts): decay ratios, measured TCA (fees/slippage from ledgers), ESTIMATED missed-trade proxy with registered assumption, unmeasured components NAMED (impact/timing/capacity/regime); statuses earned with reasons; on the forward panel + journey. CAPACITY_LIMITED/REGIME_BROKEN cannot fire until their inputs exist — by design.
Q3. ScenarioEngine (GBM labelled Model #1 + historical/block bootstrap — REUSE battery sims;
    extension contracts for GARCH/SV/jumps/regime).
Q4/Phase F. **FORMATION STAGE DONE 2026-08-10** — lib/quant/statarb.ts: I(1) checks recorded per
    series, EG-ADF with registered approximation assumptions, OLS hedge, OU half-life, rolling
    stability fraction, candidatesTested counted for EVERY attempt (mining = search), full
    StatArbFormationManifest persisted in the audit ledger (STATED-NOT-VERIFIED shortability/
    liquidity assumptions carried to the trading stage). NEXT stages: formation/trading split +
    walk-forward + two-leg costs + point-in-time universe wiring (needs WS2) + quant-core
    statsmodels parity + a dedicated statarb_formations table + pair→strategy authoring
    (screenedCandidates = candidatesTested).
Q5. PortfolioAnalytics + Optimizer (min-var/mean-var/max-Sharpe; then shrinkage/BL/HRP; random
    portfolios = visualization only). Every optimization records estimators/constraints/costs.
Q6. Microstructure plane (trade_flow_delta naming rule; aggressor-classification provenance;
    absorption/exhaustion states; OFI ≠ trade delta) — DATA-GATED on a feed with honest
    aggression classification.
Q7. Options/Volatility research plane (paper-only): BS + IV solver + Greeks + surface contracts;
    StochVolModels behind adapter, QuantLib parity; Heston/LogSV after surface verified.
Q8. Knowledge vault claim verification (KnowledgeClaim schema with source_type/verification_status;
    the Carver/Chan mislabel is the canonical test case).

## Foundation-hardening closures (2026-08-10 midday)
- Flake capture LIVE: npm run test:full writes .tmp/vitest-run.json; FLAKE_LOG.md discipline
  enforced. First two outings captured file names immediately.
- ROOT FIXES: vitest pool=forks (env-mutating suites raced a shared process.env under threads —
  the mcp 208ms assertion failure class); 30s ceilings on the two slow multi-run suites
  (research-identity, forecast/live). Two consecutive fully-green runs after.
- SCENARIO_BLOCK_POLICY sbp-2026-08-10.1: block length is versioned provenance on every block-
  bootstrap result; stationary/circular + optimal block-length estimation recorded as upgrade path.

## Phase F.2 + parity closure (2026-08-10 midday)
- **F.2 DONE**: lib/quant/statarb-trading.ts — walk-forward formation/trading split (frozen,
  hashed parameters; trading strictly after formation), z entry/exit + stop + half-life timeout,
  BOTH legs priced separately with hedgeError, assessPairMode gate (India: no naked shorts ⇒
  overnight equity pairs are RESEARCH_ONLY without verified borrow). 11 tests.
- **PARITY CORPUS DONE and it found a real defect**: statsmodels installed (use
  C:/Users/marke/AppData/Local/Programs/Python/Python312/python.exe — plain `python` on PATH is a
  different venv). 108-case corpus: agreement 91.7% → **99.1%** after replacing plain-ADF
  critical values with ENGLE_GRANGER_CRITICAL for residual tests; false positives on independent
  walks 13.9% → 5.6% (nominal 5%). COINTEGRATION_METHOD_STATUS = APPROXIMATE_PARITY_MEASURED.
- **Test-infra root fixes**: test:full now builds the MCP bundle first (it was testing a STALE
  dist/mcp/server.mjs — not a flake, a stale artifact); `npm run X &&` inside a script fails on
  this box (no npm on PATH in spawned shells) so it calls `node esbuild.mcp.mjs` directly;
  global testTimeout/hookTimeout 30s in vitest.config.ts closes the 5s-default class that the
  JSON capture caught in three separate files.

## P0 PRODUCT-REALITY OVERRIDE (owner 2026-08-10 12:08 — supersedes all quant expansion; see MISSION.md)
Lane = CLAUDE_CODE_UI_INTEGRATION (this agent). Engine/data/scheduler/MCP-bridge/Scout items belong
to the OpenCode lane and are NOT worked here.

P0. **DONE 2026-08-10 13:30** — SystemReadiness contract + /brain (lib/product/readiness.ts,
    /api/readiness, app/brain/page.tsx, e2e/brain.spec.ts). Evidence: brain spec green on clean
    :3100 server (2.0s); full suite 116 files / 1429 passed / 2 skipped ×2 consecutive; tsc clean.
    Close-out fixed the two real defects verification found:
    - /brain was nav-orphaned → added to UTILITY_LINKS (chrome, every page; RESEARCH is at its
      6-view cap by nav.test.ts design).
    - mcp/server.ts bounded() truncation envelope had neither ok nor data (256KB quantcore
      universe artifact tripped it) → envelope now carries ok:false, code:"RESPONSE_TRUNCATED";
      integration test accepts the code; dist rebuilt via node esbuild.mcp.mjs.
P2. **DONE 2026-08-10 13:47 — VERIFIED** (docs/plans/p2-live-replay/). LIVE/REPLAY mode toggle on
    the forward panel; REPLAY requires an explicit instant (run disabled until parsed); the run
    route attests mode + evaluatedAsOf in its response and the note renders the SERVER's label —
    `REPLAY — HISTORICAL EVIDENCE as of …` vs `LIVE (wall clock …)`. e2e/replay-mode.spec.ts 2/2
    green on a fresh prod server; full desktop suite 59 passed / 2 pre-existing NSE-search
    failures (engine lane).
P1 (this lane, UI half). India parity screens over the readiness contract; sector data itself is
    engine-lane (NSE sector ingestion → readiness item already names it).
P3. **DONE 2026-08-10 14:18 — VERIFIED** (docs/plans/p3-strategy-factory/). GuidedStrategyFlow on
    /strategies: two entrances (Build my idea / Find a strategy for me), five-step rail, refusals
    as stated outcomes, gauntlet gated behind a completed backtest, forward/paper hand-off with
    the REPLAY pitch. e2e 2/2; professor path + inbox unbroken (full desktop 61 passed).
    Deferred into engine-lane dependency: per-instrument picker (needs security-master bootstrap).
P5. **v1 VERIFIED 2026-08-10 14:35** (docs/plans/p5-meeting-journey/): e2e/meeting-journey.spec.ts
    chains Brain → factory prose→strategy → backtest → server-attested REPLAY → Brain counts
    provably increased; per-step network assertions; zero pageerrors; 62-passed clean-server
    suite. REMAINING P5 (blocked on engine lane's security-master bootstrap): search + India
    legs, then the full UI control inventory sweep.
P7. **PAUSED by owner override 2026-08-10 15:00** — resumes only after the full desktop journey
    (NSE search → research → strategy → backtest → replay → paper → brain) passes on a fresh
    server + fresh DB. Scope when resumed: classify MANDATORY_HUMAN vs LEGACY_MANUAL
    (requireOwnerMutationAccess sites are the list; owner-session login already removed).
P-MEETING (UI lane, current order per override):
    1) **Brain AUTONOMY ACTIVITY — DONE 2026-08-10 15:12 VERIFIED**: six ledger-backed lanes on
       /brain (Researching: queue running/queued+kinds · Testing: last cycle rehearsed/would-pass
       + mid-validation count · Waiting for evidence: active challengers signals/policy+verdict ·
       Rejected: recent burials with reason · Data jobs owed: readiness MISSING items with their
       fixing job · Next: the guide's single step, needs-you vs runs-on-its-own). Every lane
       states what its zero means. brain.spec extended (six-lane assertion); full desktop suite
       62 passed / 2 skipped / 2 pre-existing NSE failures on fresh server+DB; tsc+build clean.
    2) consume NSE contract when engine lane publishes it ·
    3) Research-this-stock UX (honest v1 waits for the P4A bridge; no fake research from a
       model-less app) · 4) consume provider research stream · 5) finish blocked P5 legs.

## P0-MEETING RELEASE — REMAINING CRITICAL PATH (owner, 2026-08-10 16:24; sits under the 15:00 override)
State: P0/P2/P3/P5-partial/Brain-activity ✅ · **blocker #1 NSE bootstrap ❌ · blocker #2 India
readiness ❌ · blocker #3 provider bridge ❌** · full P5 journey depends on all three · P7 ⏸.
NOT meeting-ready while the desktop suite carries the 2 NSE-entry failures.

ENGINE LANE
- M1 NSE MASTER BOOTSTRAP: official current NSE sources; Equity + SME; classify
  EQUITY/SME_EQUITY/ETF/REIT/INVIT/PREFERENCE_SHARE/PARTLY_PAID/OTHER (never one STOCK bucket);
  symbol/name-change history; persistent verified master; background sync with ATOMIC
  replacement; stale-last-good (sync failure ⇒ SEARCH STILL WORKS + "Security Master: STALE +
  last successful sync"); deterministic fresh-DB bootstrap. App startup NEVER depends on live
  NSE availability.
- M2 SEARCH CONTRACT: SBIN/RELIANCE/TCS/SME/ETF/REIT resolve; old-symbol alias → canonical
  current security; response = {instrumentId, isin, exchange, symbol, name, series,
  instrumentType, board, tradingStatus, dataStatus}.
  **TAXONOMY TAIL (open, owner-corrected 2026-08-10 22:00; MEASURED 22:15)**: classify from
  NSE's DEDICATED source files, not the broad equity file — ETF source→ETF · REIT-units
  source→REIT · InvIT-units source→INVIT. **SME rule corrected**: `instrumentType = SME_EQUITY`
  with `series ∈ {SM (rolling settlement), ST (trade-for-trade), SO (SME odd-lot)}` as METADATA —
  "series ST ⇒ SME" is wrong and must not be the classification rule.
  **MEASURED EVIDENCE (bootstrapped master, :3103, 1,700 of 3,314 rows sampled — counts are
  LOWER BOUNDS; the offset sweep returned empty past ~1700, itself worth a pagination check):**
  - `assetType` distribution: **EQUITY 1,529 · ETF 171 — and nothing else.**
    SME_EQUITY = 0, REIT = 0, INVIT = 0, PREFERENCE_SHARE = 0, PARTLY_PAID = 0.
  - `series` distribution: EQ 1,273 · **SM 199** · BE 145 · **ST 65** · BZ 16 · **SZ 2**.
  ⇒ At least **266 SME securities (SM+ST+SZ) are currently typed EQUITY**. The SME source file
  is already ingested (sourceKinds includes SME) — only the CLASSIFICATION step is missing, so
  this is a mapping fix, not an ingestion project. NOTE: `SZ` also appears and is not in the
  owner's SM/ST/SO list; give it a documented mapping rather than a guess. REIT/INVIT need their
  dedicated unit files added to sourceKinds (currently MAIN+SME+ETF only).
- M3 INDIA MARKET READINESS: broad indices + NSE sector indices (Capital Goods, Chemicals,
  Commercial & Transport Services, Construction, Consumer Services, Financial Services, FMCG,
  Healthcare, IT, Media, Metal, Pharma, Power, Realty, Telecommunications, Oil & Gas, …);
  every value carries source/asOf/freshness; missing = UNAVAILABLE, never 0.00%.
- M4 RESEARCH-PROVIDER STANDALONE PROOF — **MANDATORY, sources are CONFLICTED** (changelog says Autopilot
  Phase 3 shipped; README says "Next"/manual-first — see RESEARCH_LEDGER). Runtime checklist
  (owner 19:43, record everything that fails): 1 start cleanly · 2 initialize provider ·
  3 research RELIANCE.NS · 4 research SBIN + TCS.NS · 5 Indian-equity path used · 6 inspect the
  ACTUAL market-data source consumed · 7 form hypothesis · 8 invoke research autopilot ·
  9 generate signal/strategy artifact · 10 run backtest · 11 inspect citations/tool trace ·
  12 restart and verify persisted state · 13 verify scheduled-run behavior · 14 record failures.
- M5 MARKETPULSE ↔ RESEARCH PROVIDER P4A — **intentionally small first**: canonical SBIN → MarketPulse
  evidence snapshot → provider research → ResearchProposalEnvelope → MarketPulse source verification
  → Strategy Factory. Envelope now REQUIRES `inputEvidenceFingerprint` (sha256 of the exact
  packet the producer received; implemented + tested in lib/research/proposal-contract.ts) —
  same prose over different evidence can never read as the same result. Scout's Yahoo chain NEVER
  silently feeds a MarketPulse statistical experiment — loader chain: marketpulse → approved
  sources → external fallback for discovery only. Post-M5 UI item: /brain Researching lane
  renders the live provider run from the AgentRun ledger (agent/model/sources/tokens/cost/elapsed/
  status).

UI LANE
- U1 consume NSE search contract · U2 India market UX · U3 Research-this-stock UX ·
  U4 Scout streaming activity UX · U5 Strategy Factory handoff · U6 Brain clickable autonomy
  activity. Contract-first work permitted with typed fixtures, marked
  IMPLEMENTED_AGAINST_CONTRACT / NOT_INTEGRATION_VERIFIED — never presented as integrated.
  Research-this-stock state machine: LOADING → RESEARCHING → VERIFYING_SOURCES →
  PROPOSAL_READY | NEEDS_EVIDENCE | FAILED.

INTEGRATION GATE (release rule)
I1 fresh server · I2 fresh DB · I3 bootstrap NSE · I4 search SBIN · I5 research SBIN ·
I6 proposal · I7 strategy · I8 backtest · I9 validation · I10 REPLAY · I11 paper · I12 Brain
confirms persisted evidence. No mobile. No screenshot-only acceptance. Every step: UI ACTION →
REQUEST → RESPONSE → DATABASE/EVIDENCE → UI RESULT. Gate FAILED until the uninterrupted journey
passes. No new major quant modules until then.

## POST-NSE ADDITIONS (owner two-links verdict, 2026-08-10 ~16:30 — build AFTER NSE bootstrap,
## alongside the provider bridge; three new product capabilities + guardrails)
1. **AUTONOMOUS MARKET SCANNER** (engine lane; UI lane owns /scanner visual): lifecycle
   UNIVERSE→SCAN→FILTER→RESEARCH→SCORE→RISK→STRATEGY MATCH/GENERATE→VALIDATE→FORWARD/PAPER.
   Beyond the source doc's "alert human": if a validated strategy covers the setup → forward/
   paper; else → hypothesis → Strategy Factory → validation. **CandidateScore is DETERMINISTIC**
   (trend/volume/rvol/momentum/volatility/liquidity/spread/catalyst-evidence/data-quality/
   strategy-match/risk/execution-feasibility → total); LLM may add research_quality/
   catalyst_interpretation/contradicting_evidence but NEVER fabricates numeric market strength.
   Cost order: deterministic quant filter first (2,000→~30), Scout deep research only on
   survivors. UI: /scanner pipeline funnel with CLICKABLE stage counts (each exclusion bucket
   named: low liquidity N, no volume signal N, missing data N…).
2. **CHIEF-OF-STAFF ORCHESTRATOR** (engine lane): manager pattern — ONE ChiefOfStaff, ~8-12
   domain agents (MarketData/Premarket/Scanner/Research/Strategy/QuantValidation/Risk/Forward/
   Execution/Learning/SoftwareEvolution/Verification), DYNAMIC temporary workers spawned and
   destroyed per task. NOT 133 permanent agents; NOT peer-to-peer agent chatter — CoS decides
   task → delegates → structured result → durable state. Learning modes evolve into the
   AUTONOMY SCHEDULER sessions (pre-market/open/post-market/off-hours workloads as specified).
   **AgentBudgetPolicy**: CoS scales workers/token budget/tool budget/timeout to task complexity
   (simple filter = NO LLM; important candidate = ~3 researchers; new family = ~5 + quant
   challenger). **AgentRun work ledger**: run_id/parent/role/task/trigger(SCHEDULE|MARKET_EVENT|
   USER|LEARNING|FAILURE)/model/tools/input_evidence/result/tokens/cost/status/next_action —
   Brain renders it (autonomy observable, with cost).
   **AUTONOMY CLASS taxonomy** (replaces human-led/assisted/autonomous): AUTO_ALLOWED ·
   AUTO_WITH_POLICY · EVIDENCE_WAIT · EXTERNAL_AUTH_REQUIRED · OWNER_GOVERNED · PROHIBITED
   (research paper AUTO_ALLOWED; backtest AUTO_ALLOWED; paper trade AUTO_WITH_POLICY; Kite login
   EXTERNAL_AUTH_REQUIRED; holdout history PROHIBITED). This feeds P7 when it resumes.
3. **DAILY MARKET DECISION BRIEF** (UI lane surface on /brain, engine lane assembly): one
   consolidated brief — market state, scan funnel counts, top candidates (quant score + research
   evidence + data quality + covering strategy + forward count + paper eligibility), new research
   (generated/rejected-by-reason/promoted), strategy health, paper signals with rejection
   reasons, learning counts, NEXT AUTONOMOUS ACTION.
Updated meeting path: NSE MASTER → INDIA OVERVIEW → SCANNER → SCOUT RESEARCH → SCORE/RISK →
FACTORY → BACKTEST/GAUNTLET → REPLAY → FORWARD → PAPER → ALPHA HEALTH → BRAIN/BRIEF.
Sources judged: scanner doc 8/10 concept (copy pipeline, not the yfinance/text-file build);
133-agent article 8.5/10 for shared-context+orchestrator (never the headline number); Anthropic/
OpenAI primary guidance: central manager + effort scaling; multi-agent is token-expensive.

## Owner rulings 2026-08-10 13:58 (verbatim severity + direction)
- **NSE search is a PRODUCT defect at RELEASE severity — "ownership does not change release
  severity."** Engine lane, FIRST: fresh install → deterministic security-master bootstrap/sync →
  search usable without manual DB edits. Required behaviour: master present → use; absent →
  initialize/sync; sync fails → last verified snapshot; nothing → DATA_NOT_READY + reason +
  retry job. Release invariant test: search SBIN/RELIANCE/TCS/an SME on a fresh install and
  validate canonical identity. Never fix by seeding an e2e fixture alone.
- **MCP universe access must be bounded slices, not one 256KB payload** (RESPONSE_TRUNCATED guard
  stays as the backstop, never the normal path): search_instruments gains market/type/page/
  page_size; add get_instrument(id), get_universe_summary(), export_universe_snapshot(). Backlog,
  UI-lane-adjacent (mcp/server.ts), after P3/P5.
- **/brain grows into the default operational cockpit**: SYSTEM rows (Data/Research/Learning/
  Market OPEN|CLOSED/Mode LIVE|REPLAY/Paper), CURRENT WORK counts (researching/testing/forward/
  paper/blocked), WHAT NEEDS ATTENTION list. Direction, folds into P5/P8 passes.
- **P3 needs TWO entrances**: A "Build my idea" (guided interpret→strategy) and B "Find a
  strategy for me" (visible autonomous discovery: candidates, refusals with reasons, currently
  testing). B is what demonstrates autonomy.
- **provider bridge stays small first** (engine lane): one connection — provider researches an NSE
  opportunity → structured hypothesis → MarketPulse validates. No engine migration into Scout.
- Owner product score 2026-08-10: overall ~5/10; fastest path to 6.5 = NSE search reliable + P3
  guided factory + research-provider bridge + P5 real golden journey + Brain showing autonomy.

NEXT (engine lane, not mine): **NSE security-master bootstrap (release severity, above)**, then
NSE sector/VIX/pre-market ingestion, scheduler/DataSufficiencyPolicy, provider standalone + bridge,
WS2 point-in-time universe. Deferred behind P-items: selection-search linkage, richer
Scenario/Alpha-Health UI, Phase G Portfolio Engine, MCP universe pagination (spec above).

