# Final — parser worker lifetime

## Verdict: VERIFIED

The interpretation control went from ~20,000ms to ~530ms, measured on a real production server, and
the regression test fails against the unfixed code.

## Measured, before and after

Four consecutive `POST /api/research/hypotheses`, fresh production server, real spaCy:

| | before | after |
|---|---|---|
| call 1 | 20772ms | 59928ms (cold: Next route load + 35s Python) |
| call 2 | 17584ms | **532ms** |
| call 3 | 21935ms | **557ms** |
| call 4 | — | **528ms** |

Steady state improved **~40×**. The first call got *worse* in isolation because a brand-new server
now pays the whole Python cost in one place instead of spreading it across every request — which is
why `warmSyntaxParser()` moves it to runtime start, where the product already says it is working.

## Why the startup costs 35 seconds — attributed, not assumed

```
import spacy                    : 14476 ms
spacy.load('en_core_web_sm')    : 20693 ms
transformers imported           : True
torch imported                  : True
```

**`torch` and `transformers` are imported for a model that needs neither.** The worker's docstring
estimates `en_core_web_sm` at "~0.5s" — correct for a clean environment, wrong here by ~70×.

This is an ENVIRONMENT property. It is why per-call construction was catastrophic here rather than
merely wasteful, and it is not fixed by this work: removing `spacy-transformers`/`torch` from that
interpreter would take the boot to roughly a second, and mutating the owner's Python environment is
not this task's call. **Recommended, not done.**

## Readiness, cold and warm — observed

```
cold: "en_core_web_sm — not started yet; the first interpretation pays the model load, then it stays warm."
warm: "en_core_web_sm — worker warm (pid 31568, spaCy 3.8.15, model 3.8.0); interpretation is immediate."
```

The row never starts the parser: it reads `currentIdentity()`, not `health()`. Readiness is polled,
and a health-based row would have spawned an interpreter every few seconds.

## Regression test, proven by failing first

`lib/research/syntax/worker-lifetime.test.ts` — 7 tests. The load-bearing one calls
`authorFromHypotheses` twice with no resolver, exactly as production does, and counts spawns.
Restoring the default parameter:

```
AssertionError: expected [ FakeWorker{…}, …(1) ] to have a length of 1 but got 2
```

Two interpreters, two model loads. The fix was restored and it passes.

## Suites

- `tsc --noEmit` clean.
- Unit: **128 files, 1570 passed, 2 skipped, 0 failed** (was 127/1563 — the new file).
- E2E desktop: **65 passed, 2 skipped, 9 failed** — the same count as before, and that is the honest
  headline. But the failure *kind* changed:

| spec | before | after |
|---|---|---|
| `forward-evidence:71` | 55.0s | **1.5s** |
| `strategy-factory:22` | 37.1s | 13.6s |
| `dataset-ledger:143` | 45.1s (timeout) | 22.0s |
| `golden-journey:71` | 5.2m | 5.5m (unchanged) |

Timeouts became fast, stated refusals. The dominant remaining failure is a compiler verdict, not a
clock:

> `UNCLEAR — No entry rule could be read. 2 clause(s) named a feature but stated no usable
> threshold: AMBIGUOUS_ATTACHMENT, AMBIGUOUS_ATTACHMENT.`

That is the syntax-attachment wiring the work queue lists as the engine lane's in-flight task, and
it was present before this change. **This work did not clear any e2e failure, and claiming otherwise
would be false** — it removed a latency mask that was hiding what the real failure is.

## Unresolved

- `AMBIGUOUS_ATTACHMENT` on prose the specs expect to be EXPRESSIBLE — engine lane, next.
- `golden-journey:71` still exceeds 300s. Not diagnosed; its cause is not the parser.
- `research-this-stock:29` ~47s — a real Claude research call, unrelated.
- NSE search navigation (2 specs) — pre-existing.
- The 35s Python import cost, above.

## Rollback

Revert `lib/research/syntax/resolver.ts`, `lib/research/syntax/fixtures.ts`,
`lib/research/hypothesis-author.ts`, `app/api/research/hypotheses/route.ts`,
`lib/product/readiness.ts`, `lib/runtime/supervisor.ts`, and delete the new test. No schema change.
