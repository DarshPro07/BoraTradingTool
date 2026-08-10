# Gate 0 — Reality

- `GET /api/research/hypotheses` already lists every hypothesis with the strategy it became
  (`strategy: name | null`). STATICALLY_CONFIRMED — and REPRODUCED during e2e authoring: the
  route records refusals with **201** and `{verdict, reason, authored: null}` (a first draft of
  the inbox e2e assumed 200 and failed; the assertion was corrected to the real contract).
- No screen rendered the list; held hypotheses (NEEDS_FEATURE / UNCLEAR / NOT_A_TRADING_RULE)
  existed only in the database. STATICALLY_CONFIRMED.
- `HypothesisComposer` is mounted on `/strategies`; the inbox belongs beside it.
