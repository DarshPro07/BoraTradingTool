# The "research hang" — root cause

**Date:** 2026-08-13. **Verdict: there was no hang.** Research was *failing*, non-deterministically,
for a formatting reason, and every layer of the earlier diagnosis mis-attributed it.

## The chain of wrong answers, and why each was wrong

1. **"Research takes 9.5–11 minutes."** Wrong. It takes ~58s. I attributed a *test's* wall time to
   the call inside it without measuring the call.
2. **"Then the AUTO lanes must be starving interactive requests."** Wrong, and it was my own change
   under suspicion, so it was worth testing: 57.5s with the machine running vs 58.0s idle.
3. **"Then the browser must be hanging after the response."** Also wrong.

Only instrumenting every boundary against one clock settled it.

## The measurement that ended it

`e2e/research-hang-diagnostic.spec.ts`, on a fresh database:

```
+2.4s    research#2 clicked
+2.4s    DOM state -> RESEARCHING
+50.8s   DOM state -> FAILED             ← the UI updated promptly and correctly
+302.6s  locator.textContent() -> FAILED  (returned in 0.1s)
         pending requests: 0
```

- The response was received. The wire was clean; nothing pending.
- The DOM updated ~48s after the click, which matches the server exactly.
- `locator.textContent()` answered in 100ms. **No harness hang.**

The server, same run:

```
[gateway]  claude-code wall=47149ms api=42452ms cli=40455ms turns=1 tokens=3658
[research] evidence-packet=8ms provider-probe=506ms model-call=47155ms
```

The gateway *succeeded*. So the failure is after the model call.

## Root cause

From the persisted `agent_runs` ledger:

```
status:           FAILED
refusal_code:     CONTRACT_VIOLATION
refusal_message:  risks[1] — Too big: expected string to have <=300 characters
tokens:           3658
cost:             $0.0645
```

`ResearchProposalSchema` caps `catalysts`, `risks` and `missingEvidence` items at **300
characters**, `requiredFeatures` at 80, `sources` at 500, `entryConcept`/`exitConcept` at 1000,
`thesis` at 2000, `rationale` at 4000.

**The system prompt stated none of them.**

The model was asked "what would break it" with no length guidance, answered in 301 characters, and
a complete 47-second, $0.06 research run was discarded whole. Because it depends on how verbosely
the model happens to write on a given call, the *same request succeeds sometimes and fails
others* — which is exactly what made it read as an intermittent hang rather than a contract defect.

A contract the producer is never shown is not a contract. It is a trap.

## The fix

The prompt now states every enforced limit, with the consequence spelled out ("a violation
discards the entire response") and guidance to prefer several short items over one long one.

**Deliberately NOT fixed by truncating on our side.** Silently shortening a risk the analyst chose
to state changes what was said, and the entire purpose of this envelope is that the producer's
claims survive intact for verification. Nor was the cap raised: an arbitrary larger number has the
same defect one sentence later.

## Regression

`lib/research/proposal-contract-prompt.test.ts` discovers the schema's real caps **behaviourally**
(probing values rather than reading zod internals, which moved between v3 and v4) and asserts the
prompt states each one. Proven to bite: against the unfixed prompt it fails naming all six
undisclosed caps —

```
the schema enforces limits the prompt never states: 2000, 4000, 1000, 300, 80, 500
```

A future cap change that is not mirrored into the prompt now fails in CI instead of in a discarded
production run.

## Empirical verification

Three consecutive real research calls against RELIANCE after the fix, read from the ledger:

```
status=COMPLETED  verification=SOURCE_VERIFIED  tokens=2728  refusal=null
status=COMPLETED  verification=SOURCE_VERIFIED  tokens=3696  refusal=null
status=COMPLETED  verification=SOURCE_VERIFIED  tokens=4401  refusal=null
```

Zero `CONTRACT_VIOLATION`, and every proposal reached `SOURCE_VERIFIED` — the citations were
checked against the packet and held.

**Stated honestly: n=3 does not prove the rate is zero.** The failure was probabilistic in the
model's verbosity, so a larger sample could still produce a violation. What it does show is that
the pre-fix run failed on exactly this and three post-fix runs did not, with the token counts
varying (2.7k–4.4k) across them — so the successes are not one cached answer repeated.

Full unit suite after the change: **136 files, 1645 passed, 0 failed, 2 skipped** (verified by
`npm run test:verified`, which fails on a zero-test run).

## What is still unexplained, and stated as such

One earlier run reported `research#2 terminal: PROPOSAL READY` at **+1249.6s** while the server
logged a single 48.6s call. Under the corrected understanding a failed run surfaces `FAILED` in
~50s, so that observation is not yet accounted for. Candidates not yet separated: the analyze
page's `<AutoRefresh />` remounting `ResearchThisStock` and re-restoring from the ledger, or a
second attempt not visible in the log I retained.

It is recorded rather than quietly dropped. It no longer blocks, because the failure mode it
appeared to be — a hang — is disproven.

## Reclassification

| Claim | Status |
|---|---|
| `RESEARCH_UI_HANG` | **DISPROVEN** — UI updates in ~48s, locator responds in 100ms, 0 pending requests |
| `RESEARCH_LATENCY` | ~58s, 95.7% provider API, `turns=1` — **P1 UX**, not P0 |
| `LANE_CONTENTION` | **DISPROVEN** — 57.5s loaded vs 58.0s idle |
| `PROPOSAL_CONTRACT_VIOLATION` | **CONFIRMED, FIXED** — undisclosed length caps discarded whole runs |

## Consequence for the async-Job-OS question

The evidence does not support converting research to a durable background job *for latency
reasons*. A 58-second call with a truthful RESEARCHING state does not need a 202/job architecture,
and building one would have buried this defect rather than fixed it. That decision should be
revisited on UX grounds if the product wants progress detail — not on the strength of a number
that turned out to be a misattribution.
