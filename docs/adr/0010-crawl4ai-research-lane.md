# ADR 0010 — Crawl4AI belongs to a research lane that may never produce market numbers

**Status**: Accepted as a DESIGN RECORD, 2026-08-16. **Not built.** Recorded so that when it is
built, the boundary is already decided rather than argued about with a working crawler in hand.

## Context

Crawl4AI can run persistent Chromium, execute JavaScript, wait for dynamic content, reuse sessions
and extract structured page content. That capability is genuinely valuable to MarketPulse — and it
is also exactly the capability that would let it defeat a market-data provider's block, which
ADR 0009 forbids.

The value and the hazard live in the same tool, so the boundary must be about OUTPUTS, not about
intentions at the call site.

## Decision

A future `WebResearchConnector` (Crawl4AI-backed) is confined to the RESEARCH lane.

**It may produce**: `ResearchDocument`, `Claim`, `Evidence`, `SourceArtifact` — text, tables and
citations flowing into the knowledge/claim graph, where every claim already carries an epistemic
status and provenance.

**It may never produce**: `CanonicalBar`, `LiveQuote`, `PaperFillPrice`, or any holdout/validation
input. Scraped numbers must not be capable of reaching a backtest, a gauntlet trial, a sealed
holdout or a paper fill. The canonical store's writers stay closed to it.

**It must ask before it fetches**: robots/terms/source-policy check first
(`usagePermitted(sourceId, "RESEARCH")` plus a per-domain crawl-allowed check); refuse otherwise.
A domain whose terms prohibit automated collection is not crawled, per ADR 0009.

Intended targets are domains whose terms permit it: public research papers, project and API
documentation, economic and research publications, company investor-relations pages where
retrieval is permitted, and public announcements.

## Shape

```
STRUCTURED MARKET DATA                 WEB RESEARCH
        │                                   │
   MarketDataConnector              Crawl4AI / HTTP / PDF
        │                                   │
    Quarantine                       ResearchArtifact
        │                                   │
  Canonical Store                  Claim / Evidence Graph
```

## Consequences

- The research agent gains a real evidence crawler when this is built, without any path from a
  crawled page into a price series.
- Nothing about the current 403 changes: this lane is not a route to NSE's quote surface, whose
  terms prohibit the collection regardless of the tool used.
- Building it remains a deliberate future decision under the standing infrastructure freeze; this
  ADR only fixes what it may and may not do.
