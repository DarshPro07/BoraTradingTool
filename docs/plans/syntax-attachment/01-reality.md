# Gate 0 — Reality

Feature: replace positional attachment heuristics in the Semantic Strategy Compiler with
dependency-parse attachment, behind a provider-neutral resolver, refusing rather than falling back.

Evidence labels: REPRODUCED · STATICALLY_CONFIRMED · OBSERVED · INFERRED · SUSPECTED · UNKNOWN

---

## R1 — spaCy is installed, but NOT under the interpreter on PATH — REPRODUCED

`docs/autonomous-build/FINDINGS.md:32` claims the parser is "installed and verified on this machine"
and names `C:/Users/marke/AppData/Local/Programs/Python/Python312/python.exe`.

Both halves verified by execution:

| Interpreter | Result |
|---|---|
| `python` (first on PATH) | `ModuleNotFoundError: No module named 'spacy'` |
| `.../Python312/python.exe` | `spacy 3.8.15`, models `['en_core_web_sm']` |

`which -a python` resolves first to `/d/hermes/hermes-agent/venv/Scripts/python` — an unrelated
project's virtualenv.

This is the SAME class of defect as the recorded "CLI works in Git Bash but isn't visible to the
server" failure. It is not a hypothetical to guard against later; it reproduced on the first probe
of this session. **An explicit, configured interpreter path is a correctness requirement, not
hardening.** Ambient `python` resolution would have silently selected an interpreter with no spaCy.

## R2 — `en_core_web_trf` is NOT installed — REPRODUCED

`get_installed_models()` returns `['en_core_web_sm']` only. The benchmark in the execution order
(item 2) requires installing it first; it is not merely a model-name switch. Install is in flight.

## R3 — There is NO persisted real research corpus in the database — REPRODUCED

This is the most important finding in this gate, and it invalidates three items of the execution
order as written.

`marketpulse.db` (11 MB, 65 tables) contains:

| Table | Rows |
|---|---|
| `agent_runs` | **0** |
| `stock_analysis_reports` | **0** |
| `research_jobs` | 83 — payloads carry no research prose |
| `knowledge_sources` | 93 — ingested papers/videos/docs, not instrument research |
| `knowledge_claims` | 18 |
| `research_hypotheses` | 3 |
| `research_campaigns` | 2 |

Every `research_jobs` payload was scanned for `SBIN|TCS|RELIANCE|NIFTYBEES`: **0 matches**.

Consequences for the execution order:

- **Item 2** ("benchmark against the persisted REAL research corpus SBIN/TCS/RELIANCE/NIFTYBEES") —
  the named store does not exist.
- **Item 11** ("run all persisted real research envelopes") — there are none.
- **Item 16** ("Golden Journey using an already persisted REAL SOURCE_VERIFIED envelope") —
  no such envelope is persisted. This item is blocked on a live provider run, not merely gated
  behind the parser.

The real probe prose **does** exist, but only as literals captured in test files and findings docs
(`lib/research/semantic-compiler.test.ts:157`, `:250`, `lib/research/metamorphic.test.ts`,
`docs/autonomous-build/FINDINGS.md`). That prose is genuinely the output of real
`claude-sonnet-5` probes on TCS · RELIANCE · NIFTYBEES · SBIN — it is real research text, just not
*persisted as envelopes*.

**Decision (safest reversible evidence-supported default):** benchmark against the real probe prose
recovered from those literals, promoted into one explicit corpus module with provenance recorded per
case. Do NOT fabricate envelopes to satisfy the wording of the order, and do NOT claim item 11/16
are satisfied by it. The corpus is labelled for what it is.

## R4 — The positional heuristics to be replaced — STATICALLY_CONFIRMED

`lib/research/semantic-compiler.ts` (1000 lines). Attachment is five positional rules:

| Rule | Site | Behaviour |
|---|---|---|
| subject = nearest feature to the LEFT | `:622-627` | falls back to inheriting last subject in scope |
| operator = FIRST comparator in clause | `firstComparator` `:461` | `indexOf`, earliest wins |
| right operand = first feature after comparator | `featureAfter` `:506` | pure offset scan |
| numeric operand = first number after comparator | `operandNumber` `:482` | regex from offset |
| operand tie-break = whichever is NEARER | `:668-671` | `featureAt_ < numberAt` |

Each carries a comment recording the live probe that forced it, and each was a *fix* for the
previous one's failure. That is the signature of a heuristic family converging on nothing.

## R5 — The safety guards are independent of attachment, and must stay — STATICALLY_CONFIRMED

These run AFTER attachment and are what make a misattachment safe rather than silent:

- `findParameterSpans` / span-overlap guard — `SMA20 > 20` unrepresentable by construction (`:478`)
- `findDimensionErrors` + `dimensionOf` — `:796-869`, catches `rsi14 >= 2473.7`, `compare[rsi14,sma20]`
- `findContradictions` — interval algebra, per-scope (`:871`)
- `verifySourceSpans` — `:992`, provenance exactness
- `maskParentheticals` — `:542`, equal-length, offset-preserving

`maskParentheticals` already implements the "a parenthetical stating a comparison is content, not
decoration" rule (`:558-564`) — `(gap >= 3%, relative volume >= 1)` survives. The handoff's warning
about this is already satisfied in code.

**However** — `compileResearchProse:576` feeds the MASKED text to segmentation, classification and
feature-mention finding. Under the new design the masked view must NOT be what the dependency parser
reads (handoff item 5). This is a real, currently-live coupling that the integration must split.

## R6 — Suite baseline — UNKNOWN (not yet run this session)

The handoff asserts 1534 passed / 0 failed / tsc clean. Not independently reproduced yet. Recorded
as a claim to verify, not as an established baseline.

## R7 — Hydration mismatch in `/ai` (reported live by owner mid-session) — REPRODUCED (by owner) / root cause STATICALLY_CONFIRMED

Server renders `/brain` "Brain" at utility-nav slot 0; client renders `/learning` "Autonomy" there.

`UTILITY_LINKS` (`lib/nav.ts:80-88`) is a frozen static array literal with **zero** conditional
logic, no env reads, no `typeof window`, no dates or randomness. A single bundle cannot render two
different arrays from it. The client bundle therefore predates the `/brain` entry.

`lib/nav.ts` last changed in `fdb4658`; working tree clean; `.next/` (gitignored, `:17`) holds both
a `build/` and a `dev/` tree with mtime 02:22.

**This is a stale build artifact, not a source defect.** No code change is warranted. Fix: stop the
dev server, delete `.next/`, restart. Recorded here because item 19 (DevTools) explicitly gates on
zero hydration errors, so it must be cleared before that gate — and because attributing it to a code
defect would have produced a wrong "fix" to correct code.

---

## Gate 0 verdict

Reality is understood well enough to design. Two findings change the plan as handed over:

1. **R1** promotes explicit interpreter configuration from hardening to a correctness requirement.
2. **R3** removes the factual basis for items 2/11/16 as written. The corpus is reconstructed from
   real probe prose and labelled honestly; the Golden Journey (item 16) is blocked on a live
   provider run and cannot be satisfied by existing persistence.
