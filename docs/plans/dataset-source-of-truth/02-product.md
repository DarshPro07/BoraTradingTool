# Gate 1 — Product

## User problem
Different parts of the system can answer the same research question with different datasets.
Evidence the owner inspected yesterday can silently change today because the provider window
moved. That destroys the meaning of every number the system shows.

## User
The owner, and every autonomous loop that treats a stored result as evidence.

## Current behavior
Inspection re-ran the strategy against whatever the provider had; completed results were never
stored; missing fee coverage crashed the report.

## Desired outcome
Same strategy + same dataset snapshot + same engine = same result, forever. Reopening a
completed experiment reads its stored trade ledger. Missing data refuses and names ingestion as
the remedy. Provenance is visible where the evidence is shown.

## Success evidence
73 stored-bar trades reopen as the same 73 with the provider gone; fingerprint changes when one
bar changes; browser needs no candle request to display completed evidence.

## Failure conditions
Any silent provider substitution into a statistical result; any path that deletes or rewrites a
recorded experiment; an empty store answered with a default.

## Non-goals
Migrating rehearsal/gauntlet/cycle onto recorded snapshots (slice 13b, registered in MASTER);
corporate-action versioning beyond the normalization tag; multi-snapshot diffing UI.
