# Gate 0 — Reality

## The shape of a hypothesis

**STATICALLY_CONFIRMED.** `research_hypotheses` carries `title`, `statement`, `rationale`,
`market`, `claimId`, `status`. Every content field is **free prose**. There is no structured
carrier for features, thresholds, entry shape or exit shape.

**REPRODUCED.** All three hypotheses in the database were written by `claude_code` and sit at
`proposed`. None has ever produced a strategy spec.

## The finding that changes the product

Read the three actual hypotheses, not an imagined one:

| # | Hypothesis | Expressible in this DSL? |
|---|---|---|
| 1 | *"Untriggered-signal blind spot in our own gauntlet"* — a strategy whose entry rarely fires can pass every stage while unverified | **No — not a trading rule.** It is a claim about the validation machinery. There is nothing to buy. |
| 2 | *"Gap-and-RVOL screen transferred to NSE liquid mid-caps"* — gap ≥ 3%, relative volume ≥ 1, price and liquidity floors | **Yes.** Names quantities that map onto `gap_pct`, `rvol`, `close`, `adv_20d`, with thresholds stated in the prose. |
| 3 | *"Model disagreement as a risk filter"* — instruments where two models take opposing stances resolve worse | **No — needs a feature that does not exist.** Model agreement is not in `POINT_IN_TIME_FEATURES` and is not derivable from bars. |

**Two of three real hypotheses must not become strategies at all.**

That is the whole design constraint. A converter — deterministic or LLM-driven — that takes a
hypothesis and emits a specification would produce a plausible spec for all three. For #1 it would
invent a trading rule from a statement about the gauntlet; for #3 it would either invent a feature
or silently drop the one that carries the entire idea.

Both failures are the house failure mode: individually correct code, wrong model of reality,
confident output.

## What already exists and must not be duplicated

- **STATICALLY_CONFIRMED.** `propose_strategy_spec` is in `AUTONOMOUS_PERMITTED` at `learning`
  (`lib/governance/policy.ts:50`) and is implemented by nothing.
- **STATICALLY_CONFIRMED.** `recordStrategySpec` accepts a `hypothesisId` and is the sanctioned
  authoring path (`lib/knowledge/repository.ts:182`, protected).
- **STATICALLY_CONFIRMED.** `compileStrategy` is the authority on whether a DSL is a strategy —
  closed vocabulary, lookahead refusal, session-feature rules.
- **STATICALLY_CONFIRMED.** `costStanding` refuses a spec priced below the owner's real cost.
- **OBSERVED.** Research identity now requires a campaign and family before validation, and
  `placeStrategy` is the sanctioned placement path.

## The architectural constraint on reasoning

**STATICALLY_CONFIRMED.** `CLAUDE.md`: *"the app does not call Claude — **you** call the app."*
The application has no licence to invoke an LLM on the owner's subscription; `lib/ai/` exists for
unattended jobs behind an optional API key.

So a prose→DSL step cannot be a hidden model call. The options are a deterministic lexicon, the
optional API-key path, or a queued job an agent completes over MCP.

## Gate question

*Do I understand reality well enough to design the correct product?* Yes — and the answer inverted
the brief. The valuable artefact is not a converter. It is a **triage that refuses**, because two
of the three real cases must be refused and only one may proceed.
