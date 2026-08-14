# NSE market dashboard — root cause and repair

**Date:** 2026-08-13. **Scope:** the owner's report that `/dashboard?market=NSE` shows fake data.

## The report, and what it actually was

Reported: many stocks near ₹1,000 with identical percentage and absolute changes; duplicated
sector values; data presented as current that is not.

Every symptom traces to one function, `fixtureQuote` in `lib/market/service.ts`:

```ts
const price = TEST_PRICES[instrument.id] ?? (instrument.currency === "USD" ? 100 : 1_000);
return {
  price,
  change:    price * 0.005,   // identical ₹5.00 on every ₹1,000 stock
  changePct: 0.5,             // identical for EVERY stock
  volume:    1_500_000,       // identical
  provenance: testProvenance(...),   // ← quality: "LIVE"
};
```

`TEST_PRICES` holds three entries. **Every other NSE security therefore renders at ₹1,000.**

The sector tiles were not separately faked. `sectorBreadth()` averages those same quotes, so
identical inputs produce identical tiles — as do the gainers/losers lists, which sort 20 quotes
that all carry `changePct: 0.5`.

## Why fixtures were being served at all — the answer

**The product never defaulted to demo data.** Started with no override at all, so that whatever
`.env.local` provides is what applies, the dashboard serves real Yahoo quotes:

```
19 quotes — source: YAHOO 19 · quality: STALE 19
₹2,375.00  ₹1,317.00  ₹725.00  ₹278.16  ₹1,406.80
```

The URL in the report was **`http://127.0.0.1:3100/dashboard?market=NSE`**. Port 3100 is the
Playwright e2e port (`MARKETPULSE_E2E_PORT ?? 3100`), and `playwright.config.ts:80` starts that
server with `MARKETPULSE_TEST_MODE: "1"` on purpose, so browser tests get deterministic quotes.
`npm run dev` runs on **:3000** and serves real data.

So it was a test server, and nothing on the page said so. The fix is therefore not "stop using
demo data" — the product already doesn't — it is that a fixture server must be impossible to
mistake for a real one.

## The decisive experiment

The data path is not broken. With `MARKETPULSE_TEST_MODE=0` the same page renders real, varied
prices:

```
₹2,445.70  ₹729.00  ₹1,323.90  ₹279.13  ₹1,406.80  ₹5,063.70  ₹4,070.70 …
```

So the owner's server is running with `MARKETPULSE_TEST_MODE=1`. **That is not the defect.** Test
mode is a legitimate setting.

## The actual defect

The product gave no visible indication it was serving invented numbers, and actively asserted the
opposite:

1. `testProvenance` stamped fixture data `quality: "LIVE"`. A fabricated price described itself
   exactly as a real one does.
2. The dashboard rendered no provenance at all. Its one source line was a fixed sentence —
   *"Yahoo-derived research data may be delayed. Source quality is shown on detailed evidence
   screens."* — which stayed equally reassuring whether Yahoo, a fixture, or nothing served the
   page. A constant cannot describe a varying thing, and deferring provenance to "detailed
   evidence screens" is what let fixtures pass as market data on the screen people actually read.

## Repair

- `DataQuality` gains **`FIXTURE`**, and `testProvenance` uses it. Invented numbers can no longer
  claim to be live, in either the market types or the provider types.
- The dashboard shows a **DEMO DATA — NOT MARKET TRUTH** banner naming how many of its quotes are
  fabricated and how to turn it off, placed above the numbers.
- The fixed source sentence is replaced by a computed summary of what actually served the page:
  provider counts, quality counts, and the newest ingest time.

Deliberately **not** done: the fixtures were not deleted, the cap was not raised, and no numbers
were invented to replace them. Test mode remains useful; it now announces itself.

## Verification — both modes, on real servers

| Mode | Source summary rendered | Banner |
|---|---|---|
| `TEST_MODE=1` | `20 quotes — source: TEST_FIXTURE 20 · quality: FIXTURE 20` | shown |
| `TEST_MODE=0` | `19 quotes — source: YAHOO 19 · quality: STALE 19` | absent |

A dashboard-only banner was not enough: `/analyze`, `/scanner` and every other market surface read
the same fixtures. The data mode is now in the **root layout's chrome**, so it appears on every
page — amber `DEMO DATA` on a fixture server, green `PAPER` on a real one. It is threaded from the
server layout as a prop rather than read in the client component, because a non-`NEXT_PUBLIC_`
variable reads as `undefined` in the browser bundle and the badge would have silently reported
REAL on a fixture server — the exact failure it exists to prevent.

`e2e/market-dashboard.spec.ts` — **9 passed in each mode**, including a cross-check that the badge
(which reads the flag) agrees with the source summary (which reads real provenance); if they ever
disagree, one is lying and the reader cannot tell which. It asserts provenance and disclosure,
never a price: a test pinning ₹2,445.70 would fail every morning for the wrong reason.

The real-data run also surfaced something the old fixed sentence concealed: quality is **STALE**,
not "may be delayed". At 21:25 IST with NSE closed since 15:30 that is correct, and now visible.

The suite also asserts the inverse — with real data there must be **no** demo banner. A permanent
warning teaches people to ignore it, which is how the next fixture leak goes unnoticed.

Static guard (§33): `e2e/market-dashboard.spec.ts` checks that every `return fixtureQuote/Candles`
call site sits behind a `MARKETPULSE_TEST_MODE` gate on the same line, and that `testProvenance`
does not stamp a market quality. Narrowly scoped to `lib/market/service.ts` — it does not ban
numeric constants generally.

## Regression fallout, handled as obsolete invariants

Adding `FIXTURE` failed 8 tests across 4 files. One was a genuine code gap, three were assertions
encoding the defect:

- `lib/ai/evidence.ts` — the zod `quality` enum omitted FIXTURE, so an evidence package built in
  test mode failed validation outright rather than being labelled. **Code fix.**
- `lib/providers/market-contract.test.ts` — asserted `{ TEST_FIXTURE, "LIVE" }`. It asserted the
  bug. Now asserts `{ TEST_FIXTURE, "FIXTURE" }`, keeping the pairing so the two cannot drift.
- `lib/paper/repository.test.ts` — a paper fill recorded `quoteQuality: "LIVE"` beside
  `simulatedFixture: true`. The order's own provenance contradicted itself and only one half was
  ever checked.
- `mcp/server.integration.test.ts` — passed once the evidence enum accepted FIXTURE.

Full suite after: **136 files, 1645 passed, 0 failed, 2 skipped.** Route matrix: **30 passed.**

## Not addressed — stated, not silently skipped

- **The "indices" row shows stocks, not indices.** `leaders = quotes.slice(0, 4)` renders the first
  four *securities* through `IndexCard`. There is no NIFTY 50 / BANKNIFTY / India VIX source in
  this install, so showing real indices needs a data source, not a relabel. Fabricating them would
  be the defect this whole document is about.
- **Sector performance is derived from ≤20 quotes**, not from NSE sector indices. Honest for what
  it is, but it is not sector-index data and should not be read as such.
- **Breadth, live streaming (Upstox V3), chart resolutions/indicators/drawing tools, the Analyst
  rebuild** — all untouched by this pass.

**Verdict for this slice: PARTIALLY_VERIFIED.** Fabricated data can no longer masquerade as market
truth, and both modes are proven on real servers. The larger dashboard product work — real
indices, real breadth, real sector indices, streaming — is not started.
