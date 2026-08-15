# Correction 2026-08-16 — intraday history IS backfillable

An earlier revision of this leg (and the /brain panel it shipped) claimed 5-minute history
"grows only by live accumulation" and "cannot be backfilled under the free-data constraint".
**That was wrong** (owner correction, 2026-08-16, with sources):

- **Upstox Historical Candle Data V3** serves historical minute candles (intervals 1–300
  minutes) from January 2022. The separate Intraday V3 endpoint is current-trading-day only —
  which says nothing about historical availability.
- **OpenChart** (`marketcalls/openchart`) serves historical NSE/NFO data at
  1m/5m/10m/15m/30m/1h/1d/1w/1M.

Corrected model:

```
INTRADAY_READY = required sessions/bars present in the CANONICAL store, source-blind
sources: historical intraday backfill (approved connectors) + live accumulation
```

Every stated site was fixed in this correction: `lib/market/universe-coverage.ts` doc comment,
the /brain panel line ("historical backfill + live accumulation"), the e2e assertion,
`01-reality.md`, `00-status.md`. The follow-on work (OpenChart/Upstox backfill behind the
existing DataConnector contract, with quarantine and provenance) is the Data OS v2 leg —
`docs/external/nse-data-connectors.md` records the approved source roster and tiering.

Standing lesson: a "cannot" claim about an external capability must carry a source or an
attempted probe, exactly like any other claim in this repository. This one carried neither.
