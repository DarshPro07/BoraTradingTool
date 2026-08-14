# Gate 0 — Reality

## The defect

`lib/research/hypothesis-author.ts:155`:

```ts
resolver: SyntaxAttachmentResolver = SpaCyDependencyResolver.fromEnv(),
```

A default parameter expression is evaluated on **every call that omits the argument**, not once at
definition. Label: STATICALLY_CONFIRMED, and REPRODUCED by measurement below.

## What made it invisible

| Fact | Label |
|---|---|
| `SpaCyDependencyResolver` is genuinely a long-lived worker — `start()` memoises on `this.starting`, `send()` reuses the child | STATICALLY_CONFIRMED (`resolver.ts:122-225`) |
| Its own comment says the model load "is paid once at startup rather than per clause" | STATICALLY_CONFIRMED (`resolver.ts:99-101`) |
| The author's comment says "ONE worker for the whole batch… paid once here" | STATICALLY_CONFIRMED (`hypothesis-author.ts:187`) |
| Both were true **of one call**. Neither was true of the application | REPRODUCED |
| Every unit test passes a `fixtureResolver()`, so no test ever evaluated the default | STATICALLY_CONFIRMED (`hypothesis-author.test.ts:43`, `scope-parity.test.ts:66`) |

The class was correct. The comments were correct. The lifetime was one call. **The defect lived
exactly in the gap the test seam created** — the parameter existed so tests could avoid Python, and
the escape hatch became production's only path.

## The second defect, same line

`authorFromHypotheses` opened its `try` **after** the parameter list. A default parameter is
evaluated before the body, so `parserConfig`'s throw could never be caught there. An unset
`SYNTAX_PARSER_PYTHON` therefore left the route as an uncaught 500 — the owner clicked "interpret"
and got nothing with no reason. Label: REPRODUCED (server log:
`⨯ SyntaxParserUnavailable … code: 'SYNTAX_PARSER_UNAVAILABLE'`).

Note `lib/learning/cycle.ts:568-575` already catches it and records
`Authoring from hypotheses did not run: …` — so the cycle degraded honestly and only the HTTP path
did not. That asymmetry is why the fix belongs at the route, not in the domain function.

## The third thing, corrected mid-investigation

I initially suspected a leaked Python process per request. **Wrong** — `hypothesis-author.ts:430`
had `finally { await resolver.dispose(); }`, so each worker was killed at the end of its call. Not
a leak: a full build-up and tear-down, every request. This also means sharing the worker required
removing that disposal, or the second request would pay the load again anyway.

## Measured cost (REPRODUCED)

Three consecutive `POST /api/research/hypotheses` against a running production server:

```
call 1: 20772ms  http=201
call 2: 17584ms  http=200   <- authored nothing: "Nothing was re-authored"
call 3: 21935ms  http=200   <- authored nothing
```

No warm-up. Calls that do no work cost the same as calls that do.

## Why 20 seconds — attributed, not assumed

```
import spacy                    : 14476 ms
spacy.load('en_core_web_sm')    : 20693 ms
transformers imported           : True
torch imported                  : True
```

**`torch` and `transformers` are imported for a model that needs neither.** Installed spaCy entry
points pull them in. The worker's own docstring estimates `en_core_web_sm` at "~0.5s", which is
right for a clean environment and wrong for this one by roughly 70×.

This is an ENVIRONMENT property, not a code defect, and it is the reason the per-call construction
was catastrophic here rather than merely wasteful.

## Downstream

The e2e failures attributed to "the semantic compiler" are substantially this: `dataset-ledger:143`
exceeded the 45s Playwright timeout with the POST still in flight, `forward-evidence:71` took 55s,
`golden-journey:71` took 5.2 minutes.
