# Gate 2 — Architecture

## Proposed fit

One new module, `lib/research/hypothesis-triage.ts`, between the knowledge layer and the strategy
layer. It reads a hypothesis and returns a verdict. It authors nothing by itself.

A thin driver (`proposeFromHypotheses`) performs the writes through existing sanctioned paths:
`recordStrategySpec`, `placeStrategy`, `compileStrategy`, `costStanding`.

```
research_hypotheses
      │
      ▼
 hypothesisTriage()        ← pure, no database, no network
      │
      ├─ EXPRESSIBLE ──→ declare family from hypothesis ──→ recordStrategySpec (draft)
      │                                                  └─→ placeStrategy (confirmed)
      └─ refused ──────→ audit event naming the reason
```

## Why a lexicon rather than a model

The prose→DSL step is the only reasoning in the chain, and the application may not call Claude.
A **stated lexicon** — a frozen table mapping phrases to DSL features — is the honest alternative:

* it is auditable, so an author can see exactly why `"relative volume"` became `rvol`;
* it abstains by construction on anything unmapped, which is the required behaviour for two of the
  three real hypotheses;
* it cannot hallucinate a feature, because it can only emit names already in the DSL vocabulary.

Its weakness is real and stated: it understands phrasing, not meaning. A hypothesis expressing the
same idea in unmapped words is refused as `UNCLEAR`. That is the safe direction — a false refusal
costs a hypothesis nobody tests today anyway; a false conversion costs a trial and a lie.

## Hypothesis as family

A hypothesis *is* a research family: one economic claim, with variants. So an expressible
hypothesis declares a family whose `economicHypothesis` is its own `statement`, and every spec
derived from it is a member.

This closes the loop opened by `factory-lineage`: specs finally have a non-null lineage, and it
comes from the idea that produced them rather than from a machine-generated label.

## Failure paths

| Condition | Behaviour |
|---|---|
| no phrase matches | `UNCLEAR`, refuse, record |
| a matched quantity is not in `POINT_IN_TIME_FEATURES` | `NEEDS_FEATURE`, name it, refuse |
| statement is about the system, not a market | `NOT_A_TRADING_RULE`, refuse |
| thresholds absent | refuse rather than default — a fabricated threshold is a fabricated claim |
| `compileStrategy` rejects the draft | refuse, record the compiler's own message |
| cost below the owner's real cost | refuse via `costStanding` |
| research identity absent | spec is still authored as draft, unplaced and unvalidatable |

## Alternatives considered

- **LLM conversion via `lib/ai/`** — rejected for now: needs an API key the owner has not supplied,
  and it converts *everything*, which is the failure mode identified in Gate 1.
- **Queue a job for an agent over MCP** — viable and complementary; deferred because it reintroduces
  a human/agent in the loop the owner wants removed. The lexicon handles the cases it can and
  refuses the rest; the refusals are exactly the queue for an agent later.
- **Structured hypothesis fields at authoring time** — the right long-term fix (a hypothesis would
  carry its features and thresholds). Rejected now because `recordHypothesis` lives in the
  protected `lib/knowledge/repository.ts` and the three existing hypotheses are already prose.

## Architecture risks

- The lexicon is the whole quality ceiling. If it grows to cover phrasing rather than meaning it
  becomes a bad NLP system; it must stay small and refuse often.
- A hypothesis stating thresholds in unusual units (basis points, ratios) would be mis-parsed.
  Mitigated by requiring an explicit `%` or a bare comparison and refusing otherwise.
