# Program Design — Golden Journey Chain

## Problem
The research → strategy → backtest chain is broken at multiple points:
1. No API route to trigger research for an instrument
2. No API route to convert hypothesis → strategy (and spaCy is unavailable)
3. No API route to run backtest
4. `run_gauntlet` not in AUTONOMOUS_PERMITTED
5. No single flow connecting them

## Solution

### Phase 1: Deterministic Syntax Parser (spaCy fallback)
Create `DeterministicSyntaxParser` that implements `SyntaxAttachmentResolver`:
- Simple tokenizer (split on whitespace/punctuation)
- Rule-based POS tagging (known words → known POS)
- Simple dependency mapping (head = first verb or root)
- Returns `SyntaxParse` compatible with the semantic compiler

This allows the semantic compiler to work without spaCy for the limited DSL vocabulary.

### Phase 2: API Routes
1. `POST /api/research/instrument` — Research an NSE instrument
2. `POST /api/strategy/from-hypothesis` — Convert hypothesis to strategy DSL
3. `POST /api/backtest/run` — Run backtest for a strategy
4. `POST /api/gauntlet/run` — Run gauntlet validation

### Phase 3: Autonomous Flow in Learning Cycle
Add a new lane to the learning cycle:
- Find instruments with data readiness
- Research top candidates
- Author strategies from hypotheses
- Run rehearsals
- Run gauntlets (if policy allows)

### Phase 4: Policy Update
Add `run_gauntlet` to AUTONOMOUS_PERMITTED with guards:
- Daily budget limit
- Only for rehearsed candidates
- Only if cost-honest
- Only if tradable at capital

### Phase 5: Data Ingestion
- Create NSE data ingestion job
- Fetch from available sources (jugaad-data, yahoo)
- Store in canonical store
- Build dataset snapshots

## Key Design Decisions

1. **Deterministic parser**: Limited to DSL vocabulary. Won't handle arbitrary prose, but handles the patterns that matter (e.g., "close above SMA 20", "RSI below 30").

2. **Policy-gated gauntlet**: Autonomous trials allowed but bounded. Constitutional invariants remain protected.

3. **Data-first**: Use existing data (HDFCBANK, RELIANCE, TCS) for initial chain. Ingest more later.

4. **No spaCy dependency**: The deterministic parser is sufficient for the closed DSL vocabulary.
