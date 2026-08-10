# Gate 2/3 - Architecture and design

```
HypothesisComposer (client, /strategies)
      | POST {title, statement, rationale?, market?}
app/api/research/hypotheses/route.ts   (requireMutationAccess; NOT a protected dir)
      |- recordHypothesis (protected repo, called not edited)
      |- authorFromHypotheses("owner:studio")  <- existing engine: triage + family + spec + audit
      -> { hypothesisId, verdict, reason, authored?: {specId, name, familyId}, alreadyExisted }
GET -> list hypotheses with linked spec names (for the panel)
```

Decisions:
- The route reuses `authorFromHypotheses` wholesale - no second triage path to drift. It sweeps
  every unauthored hypothesis (idempotent), and the response reports THIS hypothesis's outcome.
- Verdict for an idea that was authored on an earlier pass: `alreadyExisted` with the spec named.
- Error model: 400 for missing/oversized fields; refusals are 200 with verdict - a refusal is a
  successful triage, not an error.
- Tests: triage/author already unit-tested; the new surface is e2e-tested in the golden journey
  file (the professor path), fresh DB, both viewports.
- Rollback: delete route + component + mount line.
