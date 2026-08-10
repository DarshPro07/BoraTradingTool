# Reality - NSE search connection

- REPRODUCED: submitting `bector food` navigated to `/analyze/BECTOR%20FOOD`; the page passed that
  free text to `parseInstrument`, which correctly rejected it as an unknown bare symbol.
- REPRODUCED: the owner database had no successful NSE master, and unscoped search returned HTTP
  200 with zero results instead of exposing that missing dependency.
- OBSERVED: the official main-board CSV contains `BECTORFOOD`, Mrs. Bectors Food Specialities
  Limited, ISIN `INE495P01020`.
- STATICALLY_CONFIRMED: repository search required one contiguous substring, so `bector food` did
  not match the compact symbol or the pluralized company name.
- REPRODUCED: the first owner sync failed atomically because the already-applied alias table had an
  older global uniqueness constraint and the current official source contains three duplicate
  company names across distinct ISINs. No listing rows were partially published.
- OBSERVED: unrelated concurrent forward-paper changes currently fail repository-wide typecheck.
