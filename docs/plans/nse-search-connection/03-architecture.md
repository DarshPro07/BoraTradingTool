# Architecture - NSE search connection

The existing flow remains official source -> atomic security-master sync -> repository search ->
route handler -> combobox -> canonical analysis route.

Changes fit existing boundaries:

- Repository matching normalizes compact values and multi-token company queries.
- Duplicate company names remain searchable but are not treated as unique identity aliases.
- The route returns 503 when it cannot truthfully answer an unscoped query because the NSE master
  is unavailable and no static-market result exists.
- Top navigation resolves exact identity matches or a single result before navigation. Multiple
  results require selection.
- `InstrumentError` is an expected invalid-input result and does not enter unexpected-error logs.
- A route loading boundary supplies immediate analysis-loading feedback.

The sync remains transactional and last-good preserving. No migration or persisted identity is
rewritten to accommodate the older alias uniqueness constraint.
