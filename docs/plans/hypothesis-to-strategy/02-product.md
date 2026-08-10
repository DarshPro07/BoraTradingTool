# Gate 1 — Product

## User problem

The system reads papers, extracts claims and forms hypotheses on its own — and then stops. Three
hypotheses have sat at `proposed` since this morning with no path to being tested. The owner wants
a "professor": something that turns reading into testable ideas without being asked.

## Current behaviour

`papers → sources → claims → hypotheses → ✗`. Nothing converts a hypothesis into a specification.

## Desired outcome

Every hypothesis reaches one of exactly two honest destinations:

- **a draft strategy**, in a family declared from that hypothesis, ready to rehearse; or
- **a refusal that names what is missing** — a feature this deployment cannot derive, or the fact
  that the hypothesis is not about a trade at all.

## Success evidence

1. The gap-and-RVOL hypothesis produces a compiling spec whose conditions come from *its own
   stated thresholds*, not from defaults.
2. The gauntlet-blind-spot hypothesis is refused as **not a trading rule**.
3. The model-disagreement hypothesis is refused as **needs a feature that does not exist**, naming it.
4. A produced spec is placed in a family derived from its hypothesis, so its siblings share a bar.
5. A produced spec is priced at the owner's real cost, or it is refused.
6. Nothing is authored that `compileStrategy` would reject.

## Failure conditions

The feature is wrong if it:

- invents a trading rule for a hypothesis that describes no trade;
- silently drops the part of a hypothesis it cannot express, and authors the remainder — a spec
  that tests something nobody proposed;
- fabricates thresholds the hypothesis did not state;
- authors specs that cannot be validated because they have no family;
- produces a spec for every hypothesis, which would prove only that it never refuses.

**The refusal rate is the primary quality signal.** A converter that converts everything has
learned nothing about which ideas this deployment can actually test.

## User journeys

1. A hypothesis is formed by the research loop.
2. Triage classifies it: expressible / needs-a-feature / not-a-trading-rule / unclear.
3. Expressible → a family is declared from the hypothesis, a spec is authored into it as draft.
4. Everything else → recorded with its reason, visible rather than silently skipped.
5. The rehearsal picks the draft up on the next cycle at no cost.

## Non-goals

- No LLM call from the application. See `01-reality.md`.
- No promotion. A produced spec is a `draft`; the gauntlet remains deliberate.
- No new DSL features. A hypothesis needing one is refused, and the refusal is the product.
- No natural-language understanding. A stated lexicon, applied literally, that abstains when unsure.

## Gate challenge

*If implementation were perfect but this definition were wrong, would we still fail the user?*
Yes, in one way: if "success" were measured by hypotheses converted. It is measured by hypotheses
**correctly refused**, with conversion as the minority case — which matches the evidence that two
of three real hypotheses must not become strategies.
