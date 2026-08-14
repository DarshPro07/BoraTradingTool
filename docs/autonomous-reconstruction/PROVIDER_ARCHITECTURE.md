# Provider Architecture — Boundary Documentation

## Status: VERIFIED (boundary confirmed, no consolidation needed)

Two provider systems exist with a documented boundary:

### lib/ai/* — Evidence Analysis Pipeline
- Purpose: Analyze evidence packages with structured JSON output
- Interface: `AiProvider` (analyze EvidencePackage → ResearchAnalysis)
- Providers: AnthropicAiProvider, OpenAiAiProvider, FakeAiProvider
- Used by: Evidence verification, analyst service, MCP server
- Characteristic: Structured output only, no tools, no agent loop

### lib/runtime/* — Agent Gateway
- Purpose: Execute capabilities through tool-using agents
- Interface: `ModelProviderAdapter` (execute AdapterRequest → AdapterResponse)
- Providers: ClaudeCodeMcpAdapter, AnthropicApiAdapter, OpenAIApiAdapter, OllamaAdapter, OpenAICompatibleAdapter
- Used by: Research bridge, capability routing, AUTO mode
- Characteristic: Full agent loop with tools, structured output, fallback routing

## Boundary Justification

These are NOT duplicates. They serve fundamentally different use cases:
1. **Evidence analysis** = single-turn structured JSON generation from an evidence package
2. **Agent execution** = multi-turn tool-using agent that can spawn processes, read files, etc.

Merging them would force the evidence analysis to carry agent overhead (tool definitions, session management) or strip the agent gateway of its tool-using capability.

## Consolidation Path (future, non-P0)

If unification is desired, the path is:
- Make `lib/ai/providers/*` implement `ModelProviderAdapter` interface
- Add a `structuredOutputOnly` flag to adapter requests
- Route evidence analysis through the capability router

This is NOT blocking P0. Both systems work. The boundary is documented.
