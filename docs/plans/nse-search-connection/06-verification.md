# Verification - NSE search connection

## Proven before the fix

- Vitest: fuzzy Bector lookup returned `[]`.
- Vitest: unavailable unscoped search returned false HTTP 200.
- Playwright: submit reached `/analyze/BANK%20SURVEILLANCE` rather than a canonical ID.
- Official owner sync: failed atomically on duplicate-name alias uniqueness; current rows stayed 0.

## Proven after the fix

- Focused Vitest: 18/18 passed.
- Official owner sync: 2,972 verified listings, 2,410 main and 562 SME.
- Live API: `bector food` returned one `IN:XNSE:BECTORFOOD` result with ISIN
  `INE495P01020` and `securityMaster.state=CURRENT`.
- Live Playwright: typed `bector food`, pressed `OPEN`, rendered
  `/analyze/IN%3AXNSE%3ABECTORFOOD`, saw ₹226.00, and recorded zero console errors.
- Full Vitest: 110 files passed; 1,373 tests passed and 2 skipped.
- TypeScript: `npx tsc --noEmit --pretty false` passed with no diagnostics.
- Targeted Playwright: four tests passed across desktop Chromium and Pixel 7. Both the exact
  `bector food` canonical journey and direct invalid free-text not-found behavior recorded zero
  runtime console errors.
- `git diff --check` reported no whitespace errors; only existing line-ending warnings appeared.

## Failures encountered

- Initial official sync failed atomically because an already-applied migration had stricter alias
  uniqueness than the current source file. Duplicate company names are now excluded from identity
  aliases and both securities remain searchable.
- An early repository-wide typecheck saw unrelated concurrent forward-paper errors. Those files
  changed outside this work; the final fresh typecheck passed without modifying them.
- A cold managed Playwright run initially exceeded the default navigation wait while the dynamic
  analysis route compiled and fetched data. A loading boundary was added; the exact acceptance flow
  subsequently passed on both configured devices against the running application.
