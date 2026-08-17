# What research MarketPulse can actually run today

Measured 2026-08-17. No code changed; this is an audit and two findings worth preserving.

## Four of the five highest-conviction research lanes have no data

```
announcement / earnings tables      NONE
bulk / block deal tables            NONE
pledge / insider / shareholding     NONE
index membership tables             NONE
fundamentals tables                 NONE

held:  price_candles 1,043,961 · corporate_actions 145 · sector_classifications 750
       nse_listing_versions 3,423 · bar_ingestions 5,141
```

Only **liquidity-conditioned momentum** is runnable on data already in the store: liquidity is
derivable from price × volume and needs no licence. Earnings drift, governance/pledge events,
bulk-deal follow-through and index-flow events are all blocked, and NSE's terms prohibit the
automated collection that would otherwise substitute (ADR 0009/0010).

## It is NOT one procurement decision — correcting an earlier claim

An earlier report said the binding constraint was "one procurement decision". That was wrong, and
the correction changes what gets bought:

| lane | unlocked by NSE EOD Corporate Announcement (₹5L/yr domestic)? |
|---|---|
| Earnings / announcements | **yes** — announcements plus company and segment financial results |
| Fundamentals | **yes** — sales, profit, EPS, exceptional items, segment data |
| Shareholding | **yes** — promoter / public / locked-in holdings |
| Pledge / insider events | **unconfirmed** — not explicitly named in the EOD spec; must not be assumed |
| Bulk / block deals | **no evidence of inclusion** — a separate NSE market report |
| Historical index membership | **no** — a separate NSE Indices subscription |

So the ₹5L feed plausibly unlocks two lanes outright and part of a third. The index lane is a
distinct conversation with NSE Indices; bulk/block is a distinct rights question.

**Confirm in writing before purchase:** historical backfill depth · whether insider/pledge
disclosures ride in the announcement stream · whether attachment *bytes* are delivered or only the
filename field · the exact delivery SLA (the product page says after 20:00 IST, the Jan-2025
technical spec says ~22:40–23:45) · permitted internal automated quantitative-research use.

## History depth caps the one runnable lane

```
daily history   2024-02-20 → 2026-08-14   (2.5 years, 2,122 instruments)
  >=250 bars    1,891
  >=340 bars    1,849
  >=500 bars       27
  >=750 bars        0

deep (>=340) AND sector-labelled:  696
```

Stated carefully, because the stronger phrasing is wrong: 12-month formation rules **can** be
computed, and rolling portfolios with HAC will produce observations. What 2.5 years cannot supply
is **regime diversity** — there is far too little independent history to make a credible
long-horizon momentum claim. The defensible research envelope on this store is roughly **3–6 month
formation with 1–3 month holds**.

Sector-conditioned variants are capped at 696 instruments by the same external classification
dependency already parked as `EXTERNAL_PROVIDER`.

## The QC-001 horizon finding — preserve permanently

`fam_qc001_xsec_momentum` declares `rebalance: every 5-10 trading days`, and its canonical seed uses
**60-day formation, 2-day skip, 7-day hold**.

The formation period is inside what the Indian evidence supports (~3 months). **The holding period
is not** — the literature's momentum persistence is at 1–6 months, an order of magnitude longer
than a 7-day rotation.

So the seed's −503 bps per rebalance may be measuring a horizon at which no effect is claimed,
rather than the absence of momentum in Indian equities. That is a **contract-level** mismatch, not
a parameter one: the horizon was inherited as an incidental range rather than derived from
evidence.

**QC-001 is not modified.** It completes as registered, and its result stands as evidence about the
short horizon it declared — not as a verdict on Indian momentum generally.

For any future campaign: **formation and holding horizon are evidence-backed contract fields, not
incidental parameters.** They should be justified in the declaration alongside the economic
mechanism, before a hash is pinned.

## The revised bottleneck

> MarketPulse is no longer mainly engineering-blocked. It is constrained by **research-data rights
> and historical depth**. The ₹5L EOD Corporate feed is probably the highest-leverage single
> purchase, but it is not proven to unlock the entire event programme.
