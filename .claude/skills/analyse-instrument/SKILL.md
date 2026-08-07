---
name: analyse-instrument
description: Use when asked to analyse, research, or form a view on a stock, ticker, or instrument. Produces an evidence-bound analysis recorded into MarketPulse with citations, a bull/bear/neutral debate, and explicit invalidation conditions.
---

# Analyse an instrument

You are the analyst. The application holds the evidence and the memory; you do the reasoning.

## Rules

1. **Never state a view without evidence you can point to.** Every claim carries an epistemic
   status. If you are reasoning beyond the source, that is `inferred`, not `known`.
2. **Abstain is a real answer.** If evidence is stale, thin, or conflicting, record
   `stance: "abstain"`. A confident call on weak evidence is the failure mode this system exists
   to prevent — and `marketpulse_record_analysis` will reject it anyway.
3. **You have no order authority.** This system has no broker adapter. Do not imply one exists.

## Workflow

1. `marketpulse_get_research_snapshot` — the instrument's evidence with provenance.
2. `marketpulse_quantcore` with `resource: "board"` — is this name a quant-core candidate, and
   what blockers does it carry? A blocked candidate is a reason to be careful, not to ignore.
3. `marketpulse_quantcore` with `resource: "forwardOutcomes"` — how much unbiased forward
   evidence exists for the relevant strategy? Small samples mean provisional conclusions.
4. `marketpulse_list_analyses` for this instrument — what did you conclude before, and has
   anything actually changed since?
5. Form the view. Write the bull case, the bear case, and the neutral case honestly. If you
   cannot articulate the bear case, you do not understand the trade.
6. `marketpulse_record_analysis` with:
   - `evidence[]` — each item tagged `known` / `historically_observed` / `inferred` /
     `not_forward_validated` / `conflicting` / `unknown`
   - `invalidation[]` — what would prove you wrong. Required.
   - `levels` — entry, stop, target where you have a view. A long stop sits below entry.

## Epistemic vocabulary

| Status | Use when |
|---|---|
| `known` | Directly observed in the data you fetched |
| `historically_observed` | Held in the past; not necessarily now |
| `inferred` | Your reasoning, beyond what the source says |
| `not_forward_validated` | Backtested but with insufficient forward evidence |
| `conflicting` | Sources disagree |
| `unknown` | You looked and could not determine it |

## Stale data

If the snapshot or quant-core resource is marked stale, say so in the summary and lower
conviction. Do not silently treat old data as current.
