# Final — provider transport families

## Objective

The owner's milestone verbatim: "one scalable provider architecture capable of supporting 75+
providers" — a small set of tested transport contracts plus a catalog-driven registry, never 75
adapter files. Representative proof per family; the binding invariant preserved and STORED;
failures normalized into the existing status vocabulary; no per-provider retry loops.

## What was built

- **Three HTTP wire transports** under one contract (`lib/runtime/transports/`):
  OpenAI-compatible (the widest family: OpenAI, OpenRouter, DeepSeek, Mistral, Kimi, GLM,
  NVIDIA NIM, vLLM, LM Studio, Ollama), Anthropic-native (`/v1/messages`), Gemini-native
  (`generateContent`) — each with error normalization (401→UNAUTHENTICATED, 429→QUOTA_EXHAUSTED
  + retry-after, network→UNAVAILABLE, hang→TIMEOUT), usage extraction, and executed-model
  verification (RESPONSE_REPORTED vs REQUEST_BOUND_ONLY — the claim's honesty class, stored).
- **Registry-driven scale**: 16 providers described; 12 LLMs ride the three wires + one CLI.
  `wire` + `apiKeyEnv`/`baseUrlEnv`/`defaultBaseUrl` on the descriptor — the next provider of an
  existing family is a REGISTRY ENTRY.
- **Detection v2** (wire-driven ladder): unconfigured → UNAUTHENTICATED with the exact fix;
  rejected key → UNAUTHENTICATED with the wire's words; local-not-running → NOT_DETECTED with
  the start hint; answering → READY with DISCOVERED models under neutral priors (the router's
  measured stats replace priors — no fabricated benchmarks). Zero network cost when nothing is
  configured.
- **Gateway dispatch by wire**: claude-code path byte-unchanged; HTTP wires executable through
  the same `runAgent`; a wire without a bound model refuses rather than inventing an id;
  `modelVerification` on every success, carried into the research envelope (`modelBinding`,
  optional, backward-compatible). claude-code's own claim is now truthfully USAGE_REPORTED.
- **Roster acceptance**: one-model and five-model mixed-family assignment on the real
  `buildDetectedRoster` → `routeRoleModel` path, with capability gating (structuredOutput roles
  can never land on providers that do not declare it) and empirical steering.

## Evidence

- Unit: **158 files / 1820 passed / 0 failed** (+19 new across transports, detection/dispatch,
  roster acceptance); tsc clean throughout.
- E2E (the Local family through the product): fixture OpenAI-compatible upstream + app booted
  with local-provider env → /api/brain states the full ladder truth. Two clean runs (31.7s /
  56.8s), each on its own fresh server + DB.
- Wire binding asserted AT THE WIRE in fixtures: the request body carries exactly the assigned
  model id.

## Honest scope

- This machine holds no external API keys: the API families are proven at the WIRE-CONTRACT
  level against fixtures and deliberately not claimed as live-provider-verified. The moment a
  key lands in the environment, detection begins telling its truth with no code change.
- Cost stays null on chat wires (they report tokens, not money); effective-dated pricing
  metadata is the catalog's next step when a pricing source exists.
- Empirical capability probes (structured-output/tool-call trials) are designed but deferred —
  a probe spends real tokens and is an owner-triggered act once keys exist.
- MCP is explicitly NOT a model provider here — a capability/tool connection, by design.

## Rollback

One commit; no migrations; the research-envelope contract change is an optional field.

## Verdict

**VERIFIED_FOR_DEFINED_SCOPE** — the architecture supports the 75+-provider roster through
tested contracts and registry configuration; representative proof per family at the honest
level available on this machine; binding provenance stored, never pretended.
