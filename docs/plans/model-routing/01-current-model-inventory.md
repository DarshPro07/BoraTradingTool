# Current model inventory (mission terminology discovery, 2026-08-09)

Repo-inspected. **"Corners model" does not exist anywhere in this repository** — the owner's
term maps to **Kronos** (documented below). No router exists yet; none is built until this
inventory is owner-visible (mission rule).

| System | Location | Kind | Inputs → outputs | Deterministic? | May influence promotion? | May influence execution? |
|---|---|---|---|---|---|---|
| Strategy DSL compiler + backtest/portfolio engines | `lib/strategy/dsl.ts`, `lib/backtest/*` | Deterministic quant | DSL + snapshot bars → trades, refusals, evidence | Yes | Yes (via gauntlet) | No (no broker) |
| Gauntlet statistics (DSR, PBO, bootstrap, Monte Carlo) | `lib/strategy/{gauntlet,statistics}.ts` | Deterministic quant (seeded) | returns series → stage verdicts | Yes (seed 42) | Yes | No |
| Fee/capital/feasibility engines | `lib/paper/{cost-model,capital,feasibility,fees}.ts` | Deterministic | market/date/notional → costs, verdicts | Yes | Yes (cost gate) | No |
| Simulation battery | `lib/simulation/battery.ts` | Deterministic (seeded) | returns → pass/fail/inconclusive | Yes | Rehearsal verdicts | No |
| Forward shadow evaluator | `lib/forward/shadow.ts` (new) | Deterministic | store bars + frozen DSL → signals/outcomes/scorecards | Yes | Yes (forward policy) | No |
| **Kronos** | quant-core (Python, `QUANT_CORE_*`; weights at `D:\models\kronos`; contract `lib/quantcore/contract.ts`) | ML time-series model | bar windows → forecast artifacts (see `lib/quantcore/signals.ts`, `lib/forecast/*`) | No (probabilistic) | Forecast scoring only today; NOT wired into gauntlet/promotion | No |
| Classical signal rules | `lib/quantcore/signals.ts`, scalping core | Deterministic | bars → signal reads | Yes | Indirect (research) | No |
| Strategy factory (breed/screen) | `lib/factory/*` | Deterministic search | parent DSLs → candidates (+ selection-cost accounting) | Yes | Yes (screen feeds gauntlet with `screenedCandidates`) | No |
| LLM research/authoring | `lib/research/{hypothesis-triage,hypothesis-author}.ts` + MCP tools + `lib/ai/` adapters | LLM + lexicon | prose → triage verdicts, constrained DSL proposals | Triage lexicon: yes; LLM paths: no | Only through the constrained author + gauntlet | No |
| Learning cycle orchestration | `lib/learning/cycle.ts` | Deterministic control loop | mode + state → leg reports | Yes | Schedules evaluations | No |

**Routing reality today**: there is no ambiguity to route — deterministic engines are called
directly by name; Kronos is confined to forecast artifacts; LLMs touch nothing numeric. The
future ModelRouter's job (WS3) is to make this explicit and displayable, not to change it.

**Runtime requirements**: Kronos needs the Python quant-core + local weights; everything else is
in-process TypeScript. **Cost/latency**: all in-process paths are sub-second on this data scale;
Kronos inference is minutes-scale batch; LLM calls are external API (WS4's job budget will own
their cost accounting).
