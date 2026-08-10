# Product - NSE search connection

## User problem

A user knows a company name but not its exact exchange symbol. Search either says no stock exists or
opens an invalid free-text analysis URL.

## Desired outcome

Typing `bector food` shows the official NSE security and pressing `OPEN` resolves the sole result to
`IN:XNSE:BECTORFOOD`. Ambiguous queries stay in the selector for an explicit user choice.

## Success evidence

- Official search returns BECTORFOOD and its ISIN.
- The browser requests and renders the canonical analysis URL.
- No `InstrumentError` is logged for expected invalid URLs.
- An unavailable master is reported as unavailable, not as an empty market.

## Non-goals

No approximate edit-distance engine, provider-availability backfill, or identity-model change.
