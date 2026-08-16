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

---

## Probe 2026-08-16 11:47 — can the QUOTE surface close the coverage gap? No, not from here.

The classification the gate needs for the remaining ~1,377 unclassified main-board names is
genuinely published: NSE's equity quote pages expose all four levels (Basic Industry → Industry →
Sector → Macro) for ordinary non-index names. So the question was whether this deployment can
fetch it. **Measured, not assumed:**

| Probe | Result |
|---|---|
| `/api/quote-equity` × 60 diverse symbols (50 non-index + 10 index) | **60/60 HTTP 403** |
| `www.nseindia.com` root, after cookie handshake | 403 |
| `get-quote/equity/NRAIL` HTML page | 404 (and no classification text — the page is client-rendered) |
| API retried with page `Referer` + `X-Requested-With` | 403 "Access Denied" |
| p50 latency | 118ms — an immediate refusal, not a timeout or a throttle |

`www.nseindia.com` blocks server-side requests at the edge. `nsearchives.nseindia.com` is a
DIFFERENT host with different protection and kept serving the constituent CSVs throughout — which
is why the existing ingestion is unaffected.

**Conclusion: the quote-based enricher cannot be built as an autonomous lane from this
deployment.** The data exists and is browser-visible; the server-side fetch is refused. Reaching it
would need a browser context or NSE Indices' licensed product — an owner decision, not something
to work around. Recorded as a capability claim with its evidence in
`lib/market/source-capability.ts` (`nse-equity-quote`, disabled with the probe attached).

### The index route is structurally capped

Eight index constituent files were unioned across both hosts (total market, 500, midsmallcap 400,
largemidcap 250, midcap 150, smallcap 250, smallcap 100, microcap 250):

```
union = 752 ISINs → 745 / 2,122 main board = 35.1%
```

Every additional file is a SUBSET of NIFTY Total Market. Index membership is the top ~750 by
construction, so this route cannot exceed ~35% however many files are added. The remaining 1,377
names sit below the microcap-250 cut.

### What was changed as a result

Only one thing, and it is not a new source: `www.niftyindices.com` was added as a **mirror origin**
for the same total-market file. After watching one NSE host 403 every server-side request while
another stayed healthy, a second origin for identical content is cheap insurance against
per-origin blocking. It changes no number — verified by re-running the ingestion: 750 unchanged,
zero churn.
