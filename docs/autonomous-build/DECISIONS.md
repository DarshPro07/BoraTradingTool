# Decisions (durable; newest first — see also docs/adr/ for architecture decisions)

- 2026-08-10 22:00 — **Scout auth = ChatGPT OAuth (openai-codex), not an API key.** Installed
  v0.1.13 defaults to it. One owner-only interactive login unblocks M4/M5. Fallback ladder if it
  ever fails: (1) openai-codex OAuth → (2) a configured API provider (DeepSeek/OpenAI/Anthropic/
  OpenRouter/Gemini/Groq/Qwen/Kimi) → (3) local Ollama for functional validation → BLOCK only
  when no authenticated execution path exists at all.
- 2026-08-10 22:00 — **AGENT GATEWAY: adopted in principle, provider-neutral, with a ToS
  boundary recorded (CONFLICTED → resolved by mechanism).** Owner proposes website → Next.js API
  → local Agent Gateway → agent process (never browser → claude.exe). Two mechanisms must not be
  confused: (a) PROHIBITED — extracting a Pro/Max OAuth token and using it inside the app's own
  HTTP client, which makes the app an unauthorised API client (the 2026-02-19 consumer-terms
  change; see memory claude-subscription-oauth-restriction); (b) DIFFERENT — spawning the actual
  Claude Code binary in its documented headless mode on the owner's own machine, where Claude
  Code remains the authorised client and manages its own credential; the app never sees a token.
  (b) is ordinary local automation of a tool the owner is licensed to use, and is the mechanism
  adopted — **conditional on MarketPulse remaining local, single-owner and undistributed.** If it
  is ever distributed or serves other users, that path must be re-evaluated and the Console-API-
  key adapter used instead. Design consequence: the gateway is an INTERFACE with adapters
  (claude-code | codex | scout | forecast-model | llm-api | fixture) chosen by capability alias
  (DEEP_REASONING / FAST_REASONING / CHEAP_REASONING / CODING / RESEARCH / FORECAST /
  DETERMINISTIC), so the adapter decision is configuration and no UI depends on it.

- 2026-08-10 19:15 — MISSION v7+ installed verbatim as the standing mission; prior digest content
  lives on in WORK_QUEUE/STATE. Contract aligned: envelope evidence carries retrievedSources[]
  (a list, not a count); disallow list extended (guaranteedReturn, promotionStatus).
- 2026-08-10 18:33 — ResearchProposalEnvelope adopted around the unchanged proposal; status is
  assigned by MarketPulse verification, never by the producer; LLM confidence = model confidence.
- 2026-08-10 16:30 — Three capabilities queued post-NSE: autonomous scanner (deterministic
  CandidateScore, quant-filter-first), ChiefOfStaff manager pattern (~8-12 domain agents +
  dynamic workers, never 133 permanent), Daily Decision Brief. AUTONOMY CLASS taxonomy replaces
  human-led/assisted/autonomous.
- 2026-08-10 16:24 — Three release blockers named (NSE bootstrap, India readiness, provider bridge);
  MCP universe access must be bounded slices; app startup never depends on live NSE.
- 2026-08-10 15:00 — P0-MEETING CRITICAL PATH override; P7 paused until the full desktop journey
  passes on fresh server+DB; NSE search failures are product-severity regardless of lane.
- 2026-08-10 13:58 — NSE fix is a product defect at release severity; fresh-install bootstrap
  invariant; /brain becomes the operational cockpit direction.
- 2026-08-10 12:08 — P0 product-reality override adopted; lane split (Claude=UI, OpenCode=engine);
  Scout (external research provider) adopted as research brain over the MarketPulse truth core (MIT; run standalone
  first; never its Yahoo chain as statistical truth).
- 2026-08-10 (earlier) — /brain lives in UTILITY_LINKS chrome (workspaces capped at 6 views by
  design); replay labelling is server-attested; truncation envelope carries ok:false +
  RESPONSE_TRUNCATED.
- Standing (2026-08-09) — desktop-only Playwright; forks pool + 30s test ceilings; test:full
  rebuilds the MCP bundle via node esbuild.mcp.mjs (npm absent from spawned shells).
