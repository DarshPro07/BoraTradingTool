# Test results (append newest first; numbers only from actual runs)

## 2026-08-11 00:45 IST — RESEARCH → STRATEGY HAND-OFF WIRED; A REAL DEFECT CAUGHT BY RUNNING IT
- **Hand-off proven live (:3115):** stored TCS envelope → `POST /api/research/hypotheses` →
  HTTP 201, verdict **EXPRESSIBLE**, authored `stg_f044275a8bc41e3f` in family
  `fam_d4fb4a6dd2abbe44`. Provenance (run id, evidence fingerprint, verification status,
  researcher-declared gaps) travels into the hypothesis rationale.
- **The run immediately exposed a real defect** that reading the code would not have: the authored
  entry rule was `rsi14 > 14` — the extractor had read RSI-**14**'s PERIOD as its THRESHOLD. See
  FINDINGS 00:35. Regression test proven failing (`expected 14 to be 70`) before the fix.
- **After the fix, the honest consequence is visible:** a fresh NIFTYBEES chain returns research
  SOURCE_VERIFIED (fp `3da97446daa9`) and then hand-off **UNCLEAR** — the prose says "RSI-14
  between 55 and 70" and "close above sma_20", which are a band and a feature-vs-feature
  comparison, not `feature <op> number`. **Refusing is the correct behaviour**; the extractor's
  reach is the next task, with its design question recorded rather than guessed.
- **Full unit suite: 1,480 passed / 2 skipped / 6 failed (1,488).** The 6 are the same
  pre-existing NSE-security-master failures as at 23:45 — the triage fix changed nothing else,
  which matters because the learning cycle and the research producer share that extractor.
- **Browser: `e2e/research-this-stock.spec.ts` desktop-chromium 1 passed (38.0s)** against the
  final build — restore-on-load → real model call → SOURCE_VERIFIED → reload → identical thesis.
  Zero page errors. tsc exit 0. `next build` exit 0.


## 2026-08-11 00:15 IST — **PERSISTENCE: THE RESEARCH SURVIVES A RELOAD** (AgentRun ledger)
Golden Journey step 25 ("Reload. Evidence persists.") now passes for the research leg.
- Migration `0015_agent_runs.sql` + `lib/runtime/agent-runs.ts`. **Refusals are recorded with the
  same weight as completions** — a ledger of successes only cannot answer "why did research stop
  last night", which is the question it exists for.
- **Live round-trip, prod server :3114 on the evidence DB:** `GET ?instrumentId=IN:XNSE:TCS` →
  `{found:false}` · `POST` → SOURCE_VERIFIED, `runId agr_e8233947de494eb0`, fp `c1bbe6c482e59ade` ·
  `GET` again → `found:true` with **the same runId**, envelope re-validated through the contract
  schema on the way out (a row from an older build must fail loudly, not render half an envelope).
- **Ledger contents verified directly in SQLite** — 2 rows: `COMPLETED / IN:XNSE:TCS /
  SOURCE_VERIFIED / claude-sonnet-5 / $0.0645 USD` and `REFUSED / IN:XNSE:INFY / NO_STORED_DATA /
  model "none"`. Both outcomes present, as designed.
- **Browser proof:** `e2e/research-this-stock.spec.ts` desktop-chromium **1 passed (40.0s)** —
  restore-on-load → click → real model call → SOURCE_VERIFIED → **reload → identical thesis
  restored from the ledger** (asserted by exact text, not by shape). Zero page errors.
- **The spec caught its own staleness first**, which is worth recording: the original
  `expect(state).toHaveText(/IDLE/)` began failing the moment persistence worked, because a prior
  run was restored on load. Same class as the 23:05 NSE stale-spec finding. Fixed to assert the
  honest invariant (IDLE when the ledger is empty, a labelled restored run when it is not) rather
  than by loosening the assertion.


## 2026-08-10 23:30-23:45 IST — **M5 BRIDGE INTEGRATED: THE FIRST REAL RESEARCH ENVELOPES**
The release blocker is closed. A real model reasoned over real stored evidence and the result
survived MarketPulse's own verification, twice, through the real HTTP path and through a real
browser.

**Live run 1 — SBIN (curl → /api/research/stock, prod server :3112, evidence DB):**
`ok: true` · status **SOURCE_VERIFIED** · provider **claude-code / claude-sonnet-5** (model
DISCOVERED from the run's own usage report, not a literal) · 741 real daily bars 2023-08-11 →
2026-08-10 · 8 deterministic features computed by the quant core BEFORE the call · evidence
fingerprint `9ac419b1bf71867e…` · **3 of 3 citations verified, 0 rejected** · 2,796 tokens ·
$0.0826 USD · 40s wall clock. Direction LONG/SWING, model confidence 0.50, and the model
volunteered **6 missing-evidence items** (volume/order-flow, fundamentals, news, intraday,
longer history, liquidity/shortability) rather than claiming a complete picture.

**Live run 2 — RELIANCE:** status SOURCE_VERIFIED · same provider/model · fingerprint
`a87b939fc7e3b1f3…` — **different instrument ⇒ different fingerprint**, which is the property
that makes "same prose over different evidence" structurally impossible. 3/3 verified, $0.0429.

**Refusal paths, live and real (not simulated):** `IN:XNSE:INFY` and a nonexistent id both
return `ok:false · NO_STORED_DATA` naming the bar count (0 of 60 required) and the remedy
(ingestion). Nothing was fabricated to fill the gap.

**Browser proof (§64):** `e2e/research-this-stock.spec.ts` on desktop-chromium against the
evidence-DB server — **1 passed (34.7s)**. The 34.7s IS the proof: the spec asserts a real
`/api/research/stock` response arrives (200), so a real model call ran from a real click. Zero
page errors.

**Unit tests:** `lib/research/bridge.test.ts` 16 new tests + `lib/runtime/runtime.test.ts`
15 (2 new) — all green. Full unit suite **1,478 passed / 2 skipped / 6 failed (1,486)**; the
6 are PRE-EXISTING NSE-security-master failures, structurally isolated from this work (none of
the three failing files imports any module changed here — verified by import inspection). See
FINDINGS 23:45.

**Cost control measured:** stripping settings/CLAUDE.md/skills/MCP/tools from the headless call
(`--setting-sources '' --strict-mcp-config --allowed-tools '' --system-prompt`) cut context
overhead from ~70k to ~24k cached tokens, **$0.42 → $0.15 per call**. It is also a correctness
control: a research run must not inherit this repository's instructions.


## 2026-08-10 22:30-22:35 IST — `claude -p` PROVEN + AI RUNTIME CORE LANDED
- **P0-C decisive probe PASSED.** `claude -p "…" --output-format json` from this machine:
  `is_error: false` · `session_id` returned · `modelUsage: claude-opus-5` · `total_cost_usd`
  reported · exit 0. Subscription auth works headlessly; **the Codex 429 no longer blocks the
  meeting path.** Cost note for BudgetPolicy: the trivial probe cost ~$0.49 because each
  invocation creates ~48k cache tokens of context — per-call context loading dominates, so
  batch research into few calls rather than many small ones.
- AI runtime core: `lib/runtime/{providers,routing}.ts` + 13 tests **13/13 green**, tsc exit 0
  (checked unpiped).

## 2026-08-10 22:15-22:20 IST — M4 AUTH **PROVEN**, RESEARCH LEG **QUOTA-BLOCKED**
- `provider login openai-codex` COMPLETED (owner finished the browser consent):
  "Authenticated with OpenAI Codex  1113476a-82b1-42e8-abb0-5fdd381192a1". No API key involved.
- Preflight on the next run flipped to: **`OK LLM (openai-codex) — gpt-5.5 via ChatGPT OAuth …
  base=https://chatgpt.com timeout=120s retries=2`** · yfinance OK · akshare OK · ccxt OK ·
  Tushare N/A · OKX FAIL (crypto only) → **5/7 services ready**, agent started.
- Real research run on RELIANCE.NS reached the provider and was refused by QUOTA, not auth:
  `CodexStreamError: HTTP 429 {"type":"usage_limit_reached","plan_type":"plus",
  "resets_at":1786898565}` → run FAILED after 16s, run id 20260810_221519_11_891018.
  **Quota resets 2026-08-16 16:42 UTC (~144h / 6 days).**
- Ladder position now: TRY 1 (Codex OAuth) = AUTH VERIFIED / QUOTA EXHAUSTED ·
  TRY 3 (local Ollama) = **unavailable — `ollama` not on PATH, nothing serving :11434**.
  TRY 2 (an API provider) is the only remaining path before the reset.
- Honest read: the *integration* is proven end-to-end up to the model call — auth, provider
  selection, preflight, agent loop, India data plane (yfinance reachable). What is unproven is
  everything downstream of a successful completion (citations/tool trace, autopilot, hypothesis
  →signal, backtest, restart persistence, scheduled research).

## 2026-08-10 21:58 IST — SCOUT AUTH PATH RESOLVED (installed-artifact inspection + live run)
- `provider login --help` → "OAuth provider name, e.g. **openai-codex**" (present in v0.1.13).
- `provider doctor` → provider=openai-codex · model=gpt-5.5 · base_url=https://chatgpt.com ·
  api_key {} · OPENAI_API_KEY **unset** · LANGCHAIN_PROVIDER set. ChatGPT OAuth is the default.
- Live `run -p "…"` preflight (the decisive evidence):
  `N/A LLM (openai-codex): ChatGPT OAuth login not found (run provider login openai-codex)` ·
  `OK yfinance: reachable` · `OK akshare/ccxt: installed` · `FAIL OKX: ConnectTimeout (crypto
  backtest unavailable — irrelevant to NSE)` · then
  **"Critical check failed - agent cannot start without a working LLM provider."**
- Conclusion: **NO API KEY NEEDED.** One owner-only interactive OAuth login remains; every other
  M4 leg is unblocked the moment it completes. India data path (yfinance) already reachable.

## 2026-08-10 20:30-20:40 IST — FRESH-INSTALL NSE PROOF + PROVIDER RUNTIME PROOF
- **NSE (production mode, fresh DB .tmp/e2e-nse-prod.sqlite, :3103, no seeding): PASS.**
  Master state CURRENT · totalRows 3,314 · sourceKinds [MAIN, SME, ETF] · missing [].
  Search battery: SBIN→IN:XNSE:SBIN ✓ · "State Bank of India"→SBIN ✓ · RELIANCE ✓ · TCS ✓ ·
  ISIN INE062A01020→SBIN ✓ · NIFTYBEES classified ETF ✓ · SME rows resolve (ST series) ✓.
  Partial: REIT/INVIT classification (Embassy=EQUITY, IRBINVIT absent). /analyze/SBIN: HTTP 200.
- **Provider (isolated venv, keyless): CLI v0.1.13 runs; data status mode=free; skills registry
  loads; `serve` boots uvicorn to "Application startup complete" (9s).** Research legs blocked:
  ANTHROPIC_API_KEY & OPENAI_API_KEY ABSENT (presence-checked only). Log: .tmp/scout-serve.log.
- Foreign-listener trap avoided: :3101 was held by an engine-lane server (PID-checked); all
  proofs above ran against servers whose DB file provably materialized from MY env.

## 2026-08-10 19:55 IST (envelope fingerprint + verified-mode UI)
- Contract tests: 10/10 (fingerprint required, recipe-pinned, malformed refused).
- tsc --noEmit: TRUE exit 0 (checked directly, not through a pipe — see FINDINGS on the $? trap)
  even while the engine lane's dev server ran, after the tsconfig .tmp exclusion root-fix.
- e2e/research-this-stock.spec on fresh :3101 prod server: 1/1 (6.4s).

## 2026-08-10 19:20 IST (post v7-alignment)
- tsc --noEmit: 0 errors.
- Contract tests (lib/research/proposal-contract.test.ts): 9/9 after retrievedSources[] +
  expanded disallow list.

## 2026-08-10 18:45 IST (U3/U4 delivery)
- Full desktop suite on fresh prod server (:3100, fresh DB): **61 passed / 2 skipped / 6 failed**
  — all 6 in the engine lane's in-flight NSE work (nse-security-master.spec ×5,
  app.spec market-selector ×1). The two OLD interaction.spec search failures are GONE.
- All 7 UI-lane journey specs re-run together on same server: 7/7 (brain, replay ×2,
  meeting-journey, factory ×2, research-this-stock).
- Unit suite: 117 files, 1434 passed / 2 skipped (16:34 IST run).

## 2026-08-10 16:33 IST (Brain activity + clickable lanes)
- Full desktop suite, fresh server+DB: 62 passed / 2 skipped / 2 failed (the then-current
  interaction.spec NSE pair).

## 2026-08-10 14:35 IST (P5 v1 meeting journey)
- Full desktop suite, fresh server+DB: 62 passed / 2 skipped / 2 failed (same pair).

## 2026-08-10 13:30 IST (P0 close-out fixes)
- Unit suite: 116 files, 1429 passed / 2 skipped — twice consecutively. tsc clean.

Caveat per §1/§62: these counts are evidence of what ran, never proof the product works; the
meeting gate is judged only by the Golden Journey on a fresh server (§49), currently FAILED on
the three blockers in BLOCKERS.md.
