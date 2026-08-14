# Provider Verification Status

| Provider | Adapter | Health | Models | Status |
|----------|---------|--------|--------|--------|
| Claude Code | ClaudeCodeMcpAdapter | READY (CLI 2.1.227) | sonnet | RUNTIME_VERIFIED |
| Anthropic API | AnthropicApiAdapter | NOT_CONFIGURED (no key) | claude-sonnet-5, claude-opus-4, claude-haiku-4 | ADAPTER_IMPLEMENTED_NOT_RUNTIME_VERIFIED |
| OpenAI API | OpenAIApiAdapter | NOT_CONFIGURED (no key) | gpt-5, gpt-4o, gpt-4o-mini | ADAPTER_IMPLEMENTED_NOT_RUNTIME_VERIFIED |
| Ollama | OllamaAdapter | NOT_CONFIGURED (not running) | (none) | ADAPTER_IMPLEMENTED_NOT_RUNTIME_VERIFIED |
| DeepSeek | OpenAICompatibleAdapter | NOT_CONFIGURED (no key) | deepseek-chat, deepseek-reasoner | ADAPTER_IMPLEMENTED_NOT_RUNTIME_VERIFIED |

## Summary

- 5/5 adapters implemented
- 1/5 runtime-verified (Claude Code — CLI present)
- 4/5 need external credentials/runtime to verify
