# Gates 1–3 — Product, architecture, program design

## Product

**User problem.** Clicking "interpret my idea" appears to do nothing for twenty seconds, every time,
including clicks that change nothing. That is indistinguishable from a dead button, and it is the
complaint that started this whole task.

**Desired outcome.** The control answers immediately. The startup cost happens once, where the
product already says it is working, and the runtime can state whether the parser is reachable
*before* a strategy job discovers it isn't.

**Failure conditions — still wrong if:** the interpreter is discovered from `PATH` (this machine's
first `python` has no spaCy); a status poll spawns an interpreter; a borrower can shut down the
shared worker; a dead worker becomes a permanent outage.

**Non-goals.** Changing the compiler's verdicts. Making `en_core_web_sm` load faster — that is an
environment matter, reported not fixed.

## Architecture

```
sharedSyntaxResolver()  ──module-scoped, keyed on (python, model)──▶  one SpaCyDependencyResolver
        ▲                                                                      │
        │ borrowed, never disposed                                    one child process, warm
        │
  authorFromHypotheses ──── throws SyntaxParserUnavailable ────▶ cycle.ts catches (records reason)
                                                              └─▶ route.ts catches (503, stated)

sharedSyntaxWorkerState()  ── never starts anything ──▶  readiness "Syntax parser" row
```

**Ownership rule, stated because violating it caused the defect:** whoever creates a resolver
disposes it. The shared one belongs to the process. `authorFromHypotheses` borrows and must not
dispose — its `finally { dispose() }` was correct for a resolver it created and fatal for one it
borrows.

**Concurrency.** The check-then-assign in `sharedSyntaxResolver` is synchronous, so no other turn
can interleave; two simultaneous requests get the same instance and the second's `parse` queues on
the first's `start()` promise. A worker that dies clears `starting` in its `close` handler, so the
next call respawns rather than failing forever.

**Why not `health()` for readiness.** `health()` calls `start()`. Readiness is polled, so a
health-based row would spawn an interpreter every few seconds. Hence `currentIdentity()`, which
reports what exists and never creates it.

**Not exposed:** the interpreter path. Same rule that keeps the database path out of
`/api/system/identity` — proving a dependency is configured must not publish where it lives.

## Program design

| File | Change |
|---|---|
| `lib/research/syntax/resolver.ts` | `pid` on `ParserIdentity`; `sharedSyntaxResolver`; `disposeSharedSyntaxResolver`; `currentIdentity()`; `sharedSyntaxWorkerState()` |
| `lib/research/hypothesis-author.ts` | parameter optional not defaulted; borrow the shared worker; drop the `try/finally` that existed only to dispose |
| `app/api/research/hypotheses/route.ts` | catch `SyntaxParserUnavailable` → 503 naming the reason, reporting the hypothesis that *was* recorded |
| `lib/product/readiness.ts` | "Syntax parser" row: MISSING with the fix when unconfigured, READY with warm/cold and pid |
| `lib/runtime/supervisor.ts` | warm the parser when the autonomous runtime starts; never under VITEST |
| `lib/research/syntax/fixtures.ts` | `pid: null` — a fixture must not look like a running worker |
| `lib/research/syntax/worker-lifetime.test.ts` | new, 7 tests |

### Test design, and the failure mode each detects

| Test | Detects |
|---|---|
| **two authoring requests, one spawn** | the actual regression — restore the default parameter and it fails with 2 spawns |
| same pid to every caller | a "shared" resolver that is not actually shared |
| borrower does not kill the worker | the `finally { dispose() }` returning |
| model change replaces the worker | serving a model nobody asked for |
| still refuses to guess the interpreter | a PATH fallback creeping in |
| documents what per-call construction did | keeps the old behaviour legible rather than folklore |

The interpreter is never really launched: `node:child_process` is mocked and a fake worker answers
the readiness banner and each correlated request. Spawns are **counted**, so the assertions are
about lifetime rather than about timing, which would be flaky.

## Least-confident decisions

1. **Warming on runtime start, not module load.** A server whose runtime is never started still
   pays 35s on the first interpretation. Module-load warming would spawn Python for every server
   boot including ones that never author. Readiness states which case you are in.
2. **Keeping the throw in `authorFromHypotheses`.** `cycle.ts` depends on it. Converting it to a
   returned report would silently change the cycle's skip list into a success with zero authored.

## Rollback

Revert the six files. No schema change, nothing persisted, no migration.
