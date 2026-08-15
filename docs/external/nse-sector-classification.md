# NSE sector classification — source, probe evidence, and what it is not

Probed from this machine 2026-08-16 for the trial-activation gate's sector-representation
criterion, which sat at UNMEASURABLE because this deployment held no industry map.

## What NSE publishes

NSE's own classification is four levels — **Macro-Economic Sector → Sector → Industry → Basic
Industry** — with 12 macro sectors, 22 sectors, 59 industries and 197 basic industries,
assigned primarily from audited consolidated annual financials and reviewed annually
(owner-supplied source, 2026-08-16). The taxonomy document is public; the complete company-level
classification product is an NSE Indices offering, so a freely downloadable full company→sector
master must NOT be assumed.

## What is actually reachable for free (probe, 2026-08-16)

NSE's **index constituent CSVs carry an `Industry` column beside the ISIN**:

| File | HTTP | Rows |
|---|---|---|
| `content/indices/ind_niftytotalmarket_list.csv` | 200 | 753 |
| `content/indices/ind_niftymicrocap250_list.csv` | 200 | 253 |
| `content/indices/ind_nifty500list.csv` | 200 | 501 |
| `content/indices/ind_niftysmallcap250list.csv` | 200 | 251 |

Header: `Company Name,Industry,Symbol,Series,ISIN Code`.

Measured against this deployment's security master:

- **752 distinct ISINs** carry an industry value across the union of those files;
- **exactly 22 distinct values** — matching NSE's documented *Sector* level, so that is the
  level being ingested. Industry and Basic Industry are NOT in these files and are stored NULL
  rather than guessed from the level above;
- **745 of 2,122 main-board equities classified (35.1%)** at probe time; a live ingest against a
  production copy matched **750 of 752** with **zero symbol mismatches** and 2 ISINs unknown to
  the master (correctly not written).

## Rules this ingestion follows

- **ISIN is the match key** — the strongest available. An ISIN the security master does not know
  is never written: a classification attached to an instrument the system cannot canonically
  identify is worse than no classification.
- The symbol is compared as a second signal and the verdict recorded
  (`ISIN_AND_SYMBOL_MATCHED` / `ISIN_MATCHED_SYMBOL_DIFFERS`); the stored symbol is the
  **master's**, never the index file's possibly-stale one.
- **Company NAME is never used for matching, and sector is never inferred from a name.**
- **Effective-dated, not an attribute**: NSE reviews annually and reclassifies after mergers and
  demergers, so a changed classification closes the previous row's window rather than
  overwriting it — what an earlier experiment was judged under stays recoverable.
- Coverage is partial and stays partial: an unclassified instrument contributes no sector to any
  count and is never assigned one.

## Caveat to re-check before relying on it further

Index membership changes at review dates, so an instrument dropping out of every listed index
stops being refreshed. That is acceptable for a representativeness criterion (index membership
is the investable universe, which is where family-ready instruments concentrate) but it is NOT
the same thing as NSE's full company classification product. If complete coverage is ever
required, that product is the source to license.
