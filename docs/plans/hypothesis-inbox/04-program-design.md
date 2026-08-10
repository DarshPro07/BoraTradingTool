# Gate 3 — Program design

Merged into `03-architecture.md` — a one-component feature over an existing endpoint has no
separate contract surface to specify. Files, error model and rollback are listed there.

Test design: `e2e/hypothesis-inbox.spec.ts` — POST a hypothesis whose quantities the engine
cannot derive (market cap, news sentiment) → expect 201 with `verdict: NEEDS_FEATURE`,
`authored: null` → the inbox shows it flagged HELD → it survives the refresh control.
Known failure mode this guards: held rows recorded but rendered nowhere (the pre-feature state).
