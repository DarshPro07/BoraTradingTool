# Status — syntax attachment integration

Updated 2026-08-11 (overnight session). Read this first on resume.

## Verdict so far: PARTIALLY_VERIFIED

The parser is integrated, benchmarked and proven on the real corpus. It is **not yet wired into
`compileResearchProse`** — that is the next executable task.

## Done, with evidence

| # | Work | Evidence |
|---|---|---|
| 1 | Gate 0 reality | `01-reality.md` — 3 findings that changed the plan |
| 2 | Parser benchmark, real corpus | `en_core_web_sm` **86%** vs `en_core_web_trf` **79%**, sm 8.6× faster |
| 3 | Provider-neutral interface | `lib/research/syntax/resolver.ts` — `SyntaxAttachmentResolver` |
| 4 | Persistent worker, explicit interpreter | `quant/syntax_parser.py`, one model load, line-delimited JSON |
| 6 | Parser returns syntax only | no Strategy IR, no trading vocabulary in Python |
| 7 | Attachment resolution | `lib/research/syntax/attachment.ts` — **10/10 correct, 0 wrong** on real corpus |
| 8 | No heuristic fallback | `AMBIGUOUS_ATTACHMENT`; `SYNTAX_PARSER_UNAVAILABLE` throws |
| 15 | Suite | 126 files, **1544 passed**, 0 failed, 2 skipped; `tsc --noEmit` clean |

Baseline before this work: 125 files / 1538 passed. R6 in `01-reality.md` is now resolved.

## The model decision, and why it contradicts the handoff

The handoff assumed `en_core_web_trf` should win on accuracy. **On the MarketPulse corpus it loses.**

| Model | Attachment | Parse time | Load |
|---|---|---|---|
| `en_core_web_sm` | **12/14 (86%)** | 0.100s | 7.9s |
| `en_core_web_trf` | 11/14 (79%) | 0.864s | 6.0s |

`trf` mis-coordinated `and below SMA50` and mis-resolved a copula that `sm` got right. Generic
benchmarks do not transfer to domain prose. **Pinned: `en_core_web_sm` 3.8.0, spaCy 3.8.15.**

Re-run: `python quant/syntax_benchmark.py en_core_web_sm en_core_web_trf`

## Configuration (required — not discoverable)

```
SYNTAX_PARSER_PYTHON=C:/Users/marke/AppData/Local/Programs/Python/Python312/python.exe
SYNTAX_PARSER_MODEL=en_core_web_sm
```

`python` first on PATH is `/d/hermes/hermes-agent/venv/Scripts/python` and has **no spaCy**. This
reproduced on the first probe of the session. Ambient resolution is a defect, not a convenience.

## Next executable task

**Wire `resolveAttachment` into `compileResearchProse`**, replacing these five positional rules in
`lib/research/semantic-compiler.ts`:

| Rule | Line |
|---|---|
| subject = nearest feature to the LEFT | `:622-627` |
| operator = FIRST comparator | `firstComparator` `:461` |
| right operand = first feature after comparator | `featureAfter` `:506` |
| numeric operand = first number after comparator | `operandNumber` `:482` |
| tie-break = whichever is nearer | `:668-671` |

Constraints for that work:

1. Feed the **ORIGINAL** prose to the parser. `compileResearchProse:576` currently passes
   `maskParentheticals(prose)` to everything; the masked view must stay for clause segmentation
   only, merged back by character offset. Do not ask a syntactic parser about altered syntax.
2. `operandNumber`'s parameter-span guard, `findDimensionErrors`, `findContradictions` and
   `verifySourceSpans` all still run **after** attachment. Parser output is untrusted until they pass.
3. Unresolved attachment ⇒ refuse. No positional fallback anywhere.
4. Persist `syntaxResolver`, `parserName`, `parserModel`, `parserModelVersion`, `compilerVersion`
   with authored strategy provenance (item 14 — **not started**).

## Not started

Items 11 (corpus acceptance in-suite), 12 (metamorphic over parser), 13 (cross-layer parity),
14 (provenance persistence), 16–21 (Golden Journey, Playwright, DevTools, Brain, release).

V7 sections 66–71 (UI↔runtime integration, supervisor, learning factory, self-development,
resource governance, release evidence) are **not started**.

## Blockers recorded

- **`agent_runs` and `stock_analysis_reports` are both empty.** There is no persisted research
  envelope, so V7 §30-E and item 16's "already persisted REAL SOURCE_VERIFIED envelope" cannot be
  satisfied from current state. A live provider run must persist one first. See `01-reality.md` R3.
- **Hydration mismatch on `/ai`** reported by owner: stale `.next` client bundle, **not** a source
  defect (`01-reality.md` R7). Fix: stop dev server, delete `.next/`, restart. Must be cleared
  before the DevTools gate.
