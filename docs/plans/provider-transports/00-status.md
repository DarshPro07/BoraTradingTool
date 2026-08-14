# Provider transport families — status

**Owner milestone (2026-08-14):** "One scalable provider architecture capable of supporting 75+
providers" — NOT 75 adapter files. A small set of tested TRANSPORT CONTRACTS + a catalog-driven
provider registry; representative proof per family; capability-aware allocation; the binding
invariant preserved (requested vs executed provider/model, with `REQUEST_BOUND_ONLY` stated when
the wire cannot independently verify); provider failures land in the existing Job-OS/dependency
taxonomy, never per-provider retry loops.

## Gate 0 — reality (verified in source)

Already built and staying:
- `providers.ts`: registry with transports (CLI/API/LOCAL_MODEL/HTTP_SERVICE), statuses incl.
  UNAUTHENTICATED (= the AUTH_REQUIRED semantic) and QUOTA_EXHAUSTED, capability flags,
  `CatalogModel` with RELATIVE quality/cost (absolute prices deliberately absent), enableHints.
- `routing.ts`: capability routing with the three invariants (DETERMINISTIC never LLM,
  TIME_SERIES only Kronos, fallback never silent), budget walls, attempted-trail refusals.
- `roster.ts` (A6.1): roster from detection; enumerated models per READY provider (a path that
  has NEVER had a live producer — claude-code does not enumerate) or the truthful
  `<provider>:default` sentinel; ModelRouter learns from the AgentRun ledger.
- `gateway.ts`: detection probes ONLY claude-code; `runAgent` executes ONLY claude-code;
  everything else refuses ADAPTER_MISSING. This is the gap.

## Design

- **Wire families on the descriptor** (`wire`): `OPENAI_CHAT` | `ANTHROPIC_MESSAGES` |
  `GEMINI_GENERATE` | `CLI_CLAUDE` | `NONE`, plus `apiKeyEnv` / `baseUrlEnv` / `defaultBaseUrl`.
  New registry entries: openrouter, nvidia-nim, mistral, kimi, glm, gemini, vllm-local,
  lmstudio — all representable via the three HTTP wires; adding the NEXT provider of a family is
  a registry entry, not code.
- **`lib/runtime/transports/`**: one module per HTTP wire implementing the same contract —
  `listModels` / `chat` / error normalization (401→UNAUTHENTICATED, 429→QUOTA_EXHAUSTED with
  retry-after, network/5xx→UNAVAILABLE, timeout→TIMEOUT) / usage extraction / executed-model
  verification (`RESPONSE_REPORTED` when the response names its model, `REQUEST_BOUND_ONLY`
  otherwise — stored, never pretended).
- **Detection v2**: per-provider by wire — no credential → UNAUTHENTICATED with the enableHint
  (auth-required is a stated state, not a failure); credential → live probe → READY with
  DISCOVERED models (neutral priors BASIC/MEDIUM until the ledger measures — the router's
  existing rule); local providers distinguish not-running (NOT_DETECTED + start hint) from
  READY. Unconfigured providers cost zero probes.
- **Gateway dispatch by wire**: `runAgent` routes CLI_CLAUDE to the proven claude-code path
  BYTE-UNCHANGED; HTTP wires to their transports; binding provenance (requested/executed/
  verification) recorded into the envelope's researchRun (optional, backward-compatible field).
- **Acceptance** (owner's list, honestly scoped to a machine with no external API keys):
  transport contracts proven against LOCAL WIRE-FIXTURE servers (real HTTP, fixture upstream —
  never presented as live-provider proof); binding asserted at the wire (request body carries
  the assigned model); one-model and five-model roster assignment from mixed-family detection;
  auth distinction (UNAUTHENTICATED vs UNAVAILABLE); usage telemetry into AgentRun; e2e — a
  spec-spawned OpenAI-compatible fixture upstream + product server env → detection READY with
  discovered models THROUGH the product surface (the Local family's representative proof);
  claude-code stays the CLI family's live proof (30/30 sweeps, golden baseline).

## Slices — ALL COMPLETE 2026-08-14

- [x] Gate 0
- [x] S1 `transports/contract.ts` + `openai-compatible.ts` — the shared contract (boundedFetch,
      normalizeHttpError: 401/403→UNAUTHENTICATED, 429→QUOTA_EXHAUSTED with the wire's own
      retry-after, network/5xx→UNAVAILABLE, hang→TIMEOUT, junk→BAD_RESPONSE) and the family that
      unlocks the widest roster. 6/6 wire-fixture tests incl. THE BINDING ASSERTED AT THE WIRE
      (the request body carries exactly the assigned id) and the REQUEST_BOUND_ONLY honesty case.
- [x] S2 `anthropic-native.ts` (content blocks, top-level system, x-api-key + version header,
      native usage) + `gemini-native.ts` (model bound IN THE URL, parts, usageMetadata,
      modelVersion). 6/6.
- [x] S3 registry: 16 providers, 12 LLMs over THREE HTTP wires + one CLI — `wire` +
      `apiKeyEnv`/`baseUrlEnv`/`defaultBaseUrl` on the descriptor. Adding the next provider of an
      existing family is a registry entry. Detection v2 is wire-driven with the LADDER: no
      credential → UNAUTHENTICATED with the fix (auth-required is a stated state); key rejected →
      UNAUTHENTICATED with the wire's words; local not answering → NOT_DETECTED with the start
      hint; answering → READY with DISCOVERED models under NEUTRAL priors (BASIC/MEDIUM — the
      ModelRouter replaces priors with measured stats; no fabricated benchmarks). Unconfigured
      providers cost zero network traffic.
- [x] S4 `runAgent` dispatches by wire — CLI_CLAUDE runs the proven claude-code path unchanged;
      HTTP wires run their transports; an HTTP wire without a bound model REFUSES rather than
      inventing an id; failures map into the existing vocabulary (TIMEOUT→AGENT_TIMEOUT,
      BAD_RESPONSE→UNPARSEABLE_RESULT, rest→PROVIDER_UNAVAILABLE with the normalized prefix).
      Binding provenance: `modelVerification` (RESPONSE_REPORTED / USAGE_REPORTED /
      REQUEST_BOUND_ONLY) on every success, carried into the envelope's researchRun as the
      optional backward-compatible `modelBinding`. claude-code's claim is now honestly
      USAGE_REPORTED (discovered from its usage payload) or REQUEST_BOUND_ONLY when usage is
      empty. 3/3 detection+dispatch tests against the fixture upstream.
- [x] S5 the owner's one-model/five-model acceptance on the real pieces: a one-entry roster
      serves every role; a five-model mixed-family roster (2 local + 2 API + the CLI sentinel)
      assigns per role with CAPABILITY GATING (a structuredOutput-needing role can never land on
      a local model whose provider does not declare it) and EMPIRICAL steering once a model earns
      history. 4/4 + adjacent runtime suites 35/35.
- [x] S6 `e2e/provider-transports.spec.ts` — the Local family's representative proof THROUGH THE
      PRODUCT: a real OpenAI-compatible fixture upstream + app booted with the local-provider
      env → /api/brain states the whole ladder (vllm-local READY with the fixture's discovered
      models; openrouter UNAUTHENTICATED naming OPENROUTER_API_KEY; lmstudio NOT_DETECTED "Not
      running"; codex "No adapter"). Two clean runs: 2 passed (31.7s) / 2 passed (56.8s), each
      booting its own server on a fresh DB.

**Family proof status (honest):** OpenAI-compatible / Anthropic-native / Gemini-native — wire
contracts pinned by fixture tests (this machine holds no external API keys; live-provider claims
are deliberately NOT made). Local — proven through the product with a real HTTP upstream. CLI —
claude-code, live-proven by the golden suite (30/30 research sweeps). MCP — explicitly NOT a
model provider; a capability/tool connection, out of this architecture by design. Cost —
transports report tokens, never fabricate money (cost stays null; economics belong to
effective-dated catalog metadata when pricing sources arrive). Empirical capability PROBES
beyond declaration remain queued (a controlled probe spends real tokens — owner-triggered when
keys exist).
