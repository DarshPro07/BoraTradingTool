# Blockers (live; remove only with evidence)

## Release blockers (meeting gate FAILED while any remain)
1. **NSE fresh-install bootstrap/search (M1/M2)** — **CORE PROOF PASSED 2026-08-10 20:30 IST**
   (independent verification, production mode, fresh empty DB, zero seeding): boot → bootstrap
   fired → master CURRENT, 3,314 rows, sources MAIN+SME+ETF complete → SBIN / "State Bank of
   India" / RELIANCE / TCS / **ISIN INE062A01020** all resolve canonically → /analyze/SBIN
   renders (HTTP 200, research component present). ETF classification correct; SME rows resolve
   (ST series). REMAINING: REIT/INVIT/SME_EQUITY type classification PARTIAL (Embassy shows
   EQUITY; IRBINVIT absent); their nse-security-master.spec legs must go green in the suite;
   TEST_MODE uses a 5-row fixture by design (different path than production bootstrap).
2. **India market/sector readiness (M3)** — engine lane; readiness contract names the gaps;
   sector series not ingested.
3. **research-provider bridge (M4/M5, P4A)** — M4 KEYLESS RUNTIME PROOF DONE 2026-08-10 20:40;
   **AUTH PATH RESOLVED 21:58 — NO API KEY REQUIRED.** Installed v0.1.13 already defaults to
   `provider=openai-codex`, `model=gpt-5.5`, `base_url=https://chatgpt.com`, `OPENAI_API_KEY:
   unset` — i.e. ChatGPT OAuth, not a key. Its preflight is honest and refuses to start:
   "ChatGPT OAuth login not found (run `vibe-trading provider login openai-codex`)" →
   "Critical check failed - agent cannot start without a working LLM provider."
   Data plane already healthy in the same preflight: **yfinance reachable**, akshare installed,
   ccxt installed (OKX times out — crypto only, irrelevant to NSE work).
   **REMAINING = one interactive OAuth browser login, owner-only** (their ChatGPT credentials;
   an agent must never handle them). Exact command in EXTERNAL section below. M4 steps 3–13
   then run unattended; M5 bridge follows.

## Paused by policy
- P7 autonomy-audit conversion — resumes only after the full desktop journey passes on fresh
  server + fresh DB (owner override 2026-08-10 15:00). AUTONOMY CLASS taxonomy is its vocabulary.

## External / owner-only boundaries
- **RESOLVED 2026-08-10 22:15** — `provider login openai-codex` completed; Scout authenticates
  via ChatGPT OAuth with NO API key. Preflight green, agent loop starts, real call reaches the
  provider.
- **DOWNGRADED 2026-08-10 22:30 — no longer release-blocking.** `claude -p` works headlessly on
  this machine with subscription auth (is_error false, claude-opus-5, cost reported), so the
  meeting path routes through Claude Code instead of waiting six days. Codex quota remains a
  *fallback* gap, not a blocker.
- (was) the Plus plan's Codex usage limit is exhausted:
  HTTP 429 `usage_limit_reached`, **resets 2026-08-16 16:42 UTC (~6 days)**. Ladder state:
  TRY 1 Codex OAuth = auth OK / quota out · TRY 3 local Ollama = unavailable (`ollama` not on
  PATH, nothing on :11434) · **TRY 2 is the only path before the reset**. Owner choice, any one
  of: (a) wait for the reset — costs nothing, M4 resumes unattended; (b) install Ollama and pull
  a small instruct model for FUNCTIONAL validation only (proves the bridge's plumbing, not
  research quality); (c) supply any one approved API key (DeepSeek is the cheapest sensible
  option; OpenRouter/Gemini/Groq/Qwen/Kimi/Anthropic/OpenAI all supported) via
  `vibe-trading init` → `~/.vibe-trading/.env`, never through chat.
  No work stops on this: the M5 bridge contract, Agent Gateway seam, NSE taxonomy spec, India
  readiness and the Golden Journey legs all continue in parallel.
- Kite/Zerodha credentials and broker 2FA — not needed until P4 broker evolution; never via chat.
- Real-money execution — remains disabled by governance; no request pending.
