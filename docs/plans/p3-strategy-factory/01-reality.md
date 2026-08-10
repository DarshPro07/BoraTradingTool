# Gate 0 — Reality (all files read in full this session)

Every capability in the owner's ten-step flow EXISTS; none of them are connected as one journey:

| Owner's step | Exists as | Gap |
|---|---|---|
| Idea in prose | HypothesisComposer → POST /api/research/hypotheses | standalone panel |
| YOU SAID / INTERPRETED / RULES | the route's `provenance` + composer's display | already exact |
| Required data | triage NEEDS_FEATURE verdict names the missing quantity | shown as refusal only |
| Strategy created | authorFromHypotheses → family-bearing draft spec | shown as one line |
| Backtest + trades/fees/chart | POST /api/strategy/trades + TradeInspector (free, ledger-first) | separate panel, no link from authoring |
| Validate | RunGauntletButton (two-click, cost stated) | only in the registry table |
| Forward / paper | /paper ForwardEvidencePanel (activate → enroll → LIVE/REPLAY) | different page, no pointer |
| Autonomous discovery | learning cycle (triage+breed+rehearse+bury), run-log /api/cycles, HypothesisInbox | data exists; NO surface says "MarketPulse is discovering on its own" |

Constraints (STATICALLY_CONFIRMED against the e2e suite):
- golden-journey.spec professor path requires `hypothesis-composer/-title/-statement/-submit/-result/-authored`
  visible on /strategies; main journey requires `strategy-author`, `strategy-dsl`, `author-submit`,
  `author-result`, `author-warnings`; inspector suite requires `trade-inspector`, `inspect-spec`,
  `inspect-run`; hypothesis-inbox.spec requires the inbox testids. None may move off the page.
- RunGauntletButton renders per registry row — the flow's instance must be scoped by a container
  testid to stay unambiguous.
- Fresh-database honesty: backtest step must render the NO_DATA/refusal shape as a stated
  outcome, not an error state (same pattern the inspector suite pins).
