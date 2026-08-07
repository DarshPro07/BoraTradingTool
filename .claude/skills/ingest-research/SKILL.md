---
name: ingest-research
description: Use when given a paper, video, repository, article, or report to bring into the system. Archives the source, extracts claims with epistemic status, registers hypotheses, and records what could not be verified.
---

# Ingest a research source

The worker archives, links and deduplicates. **You** extract the claims — it will not invent
them from raw text, by design.

## Workflow

1. **Read the source properly.** Fetch it. Do not summarise from the title or the abstract.
2. **Archive it** with `marketpulse_record_source` — include the licence if stated. Content is
   hashed, so re-archiving the same text returns the existing id rather than duplicating it.
3. **Extract claims** with `marketpulse_record_claim`, one per distinct assertion:
   - `historically_observed` for an empirical result the source reports
   - `inferred` for anything you are concluding on the source's behalf
   - Set `indiaRelevant` deliberately — most US equity research does not transfer unchanged
     to NSE cash markets given different costs, settlement and microstructure.
4. **Register hypotheses** with `marketpulse_record_hypothesis` only where the claim suggests
   something testable here. Duplicates are detected automatically and marked, which is a
   success, not a failure.
5. **Record what you could not verify.** If the source's code is missing, its data is
   proprietary, or its result cannot be reproduced, use `marketpulse_record_failure` with
   scope `data` or `system`. An unverifiable claim that is silently accepted is worse than one
   that is rejected loudly.

## What to reject

- Marketing content, or a backtest with no methodology.
- Results with no cost model. A strategy that ignores costs is not a result.
- Claims that only hold in one narrow period, presented as general.
- Anything requiring data the system does not have and cannot obtain.

Record the rejection with a reason via `setSourceStatus`; a rejected source stays archived so
the same idea is not reconsidered from scratch later.

## Licence discipline

Record the licence. AGPL, GPL and LGPL sources may be **read and learned from** but their code
must not be copied into this repository. Reimplement behind our own contracts, and note in the
claim that the implementation is clean-room.
