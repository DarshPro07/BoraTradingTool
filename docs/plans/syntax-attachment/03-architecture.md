# Gate 2 — Architecture: how the parser reaches the compiler

Decided 2026-08-11 from static analysis of the call graph. Recorded before implementation so the
next session does not rediscover it.

## The constraint that decides it

`hypothesisTriage` is specified as **pure — no database, no network**
(`docs/plans/hypothesis-to-strategy/03-architecture.md:15`), and `compileResearchProse` is
synchronous. The parser is an out-of-process async call. Something has to give.

Call graph (production; tests aside):

```
hypothesis-author.ts:177  authorFromHypotheses   (async)
        -> hypothesis-triage.ts:397  hypothesisTriage    (PURE, sync)
                -> semantic-compiler.ts:573  compileResearchProse (sync)
```

One production caller of `compileResearchProse`. 32 synchronous call sites across
`semantic-compiler.test.ts` (18), `metamorphic.test.ts` (9), `scope-parity.test.ts` (5).

## Alternatives

### A — make the chain async

`compileResearchProse` → `async`, therefore `hypothesisTriage` → `async`, therefore every test
awaits.

Rejected. It **destroys the purity invariant** of `hypothesisTriage`, which is not an incidental
property: it is why triage is cheap to test exhaustively and why it cannot silently acquire a
network dependency inside a governance-adjacent path. Trading an architectural invariant for a
calling convention is a bad trade.

### B — inject the parse as data (CHOSEN)

```ts
compileResearchProse(prose: string, parse: SyntaxParse): CompiledStrategy
```

The async I/O happens once at the edge (`authorFromHypotheses`, or the API route), which is already
async. The compiler and triage stay synchronous and pure; the parse arrives as an ordinary value.

Consequences, all of them good:

- Purity of `hypothesisTriage` is preserved — it receives data, not a client.
- The compiler becomes **deterministic and hermetic in tests**: a recorded parse fixture is a
  value, so no test needs Python. This is already proven to work in
  `lib/research/syntax/attachment.test.ts`.
- The parser is trivially swappable — the compiler never sees a resolver, only its output.

### C — parse lazily inside the compiler with a sync cache

Rejected. A hidden process spawn inside a function documented as pure is precisely the class of
defect this repository keeps finding: code individually correct while the model of reality behind
it is wrong.

## Required, and NOT optional

**`parse` has no default.** Omitting it must not fall back to positional attachment. A call without
a parse returns a refusal verdict, not a guess. The five positional rules
(`semantic-compiler.ts:461, 482, 506, 622-627, 668-671`) are **deleted**, not bypassed — code that
still exists is code that can still be reached.

## The masked/original split

`compileResearchProse:576` currently computes `readable = maskParentheticals(prose)` and hands it to
segmentation, classification AND feature-mention finding.

Under this design the two representations diverge by purpose:

```
ORIGINAL prose  -> dependency parser        (syntax must not be asked about altered syntax)
MASKED view     -> clause segmentation      (decorative asides, clause boundaries)
                -> merged by character offset
```

`maskParentheticals` already preserves length exactly (`:538-540`), so offsets from the masked view
index the original unchanged. That property is what makes the merge sound, and it already has test
coverage.

Note `maskParentheticals` already keeps a parenthetical that states a comparison
(`:558-564`) — `(gap >= 3%, relative volume >= 1)` survives as content. No change needed there.

## Migration cost, stated honestly

32 test call sites must supply a parse. That is mechanical but it is not small, and it must not be
done by giving `parse` a default value — that would reintroduce the fallback through the back door.
The parse fixtures should be **recorded from the real `en_core_web_sm` worker**, as in
`attachment.test.ts`, so the suite keeps testing the parser MarketPulse actually pins.

## Rollback

The parser modules are additive and currently unreferenced by the compiler. Reverting is
`git revert f852a31`; nothing in the shipped compile path depends on them yet.
