# AutoHedge intake — audit

2026-09-19. Owner: "use this as the code and connect it fully".
Source: https://github.com/The-Swarm-Corporation/AutoHedge @ `c549c79` (2026-03-05). MIT, so reuse is
permitted with attribution.

## What it is (STATICALLY_CONFIRMED, read in full)

About 2,350 lines of Python. The working core is about 160 lines:

| Piece | What it does |
|---|---|
| `main.py` `AutoHedge.run(task)` | hands the task text to one Director agent and returns the conversation |
| `workers.py` | five `swarms.Agent` LLM prompts: Director (gpt-4.1), Sentiment (gpt-4o-mini + Exa web search), Quant, Risk, Execution (gpt-4.1). The Director hands off to the other four |
| `prompts.py` | the prompt text, roughly 200 lines |
| `tools/yahoo_api.py`, `polygon_api.py` | US stock data (not wired into the agents) |
| `tools/ultra_tools.py` | **signs and executes Solana swaps** through Jupiter Ultra with `SOLANA_PRIVATE_KEY`. It is registered in `tools_registry.py` but not attached to the default Director |

## What it does not do

- **The Quant agent computes nothing.** It is asked for VaR, Greeks and success probabilities
  "based on historical data", but it receives only the Director's text and has no data tool. Its
  numbers are generated text. This breaks this repository's rule "never fill a gap with a plausible
  number".
- No backtest, no cost model, no out-of-sample test, no record of what was tried.
- The Execution agent writes an order as prose. The only real execution path is a Solana crypto
  swap signed with a wallet private key.
- No NSE data, no Indian broker, and no INR costs.
- It needs `OPENAI_API_KEY`. The Sentiment agent needs `EXA_API_KEY`, and execution needs
  `JUPITER_API_KEY` plus a wallet key.

## Verdict: ADAPT the architecture, do not REUSE the code

The reusable idea is the desk shape: a Director fanning out to Sentiment, Quant, Risk and
Execution roles. MarketPulse already holds what AutoHedge lacks:

| AutoHedge role | MarketPulse capability that should back it |
|---|---|
| Quant | research snapshot, quant core, indicator registry: numbers that are computed, not generated |
| Risk | `lib/paper/risk.ts` risk kernel, `roundTripCost` cost model |
| Execution | the paper engine (`lib/forward/paper.ts`); there is no broker adapter by design |
| Director's record | `record_analysis`, which already rejects inference-only stances |
| LLM | `lib/ai/provider.ts`, which supports both Anthropic and OpenAI keys |

## Human-only boundaries this request crosses

1. **Real-money execution.** AutoHedge's only live path is a crypto wallet. `CLAUDE.md`: this
   system places no orders.
2. **Credentials.** An LLM API key for unattended runs, and optionally Exa.
3. **Market.** AutoHedge targets US stocks and Solana; the owner's data and cost model are NSE.
