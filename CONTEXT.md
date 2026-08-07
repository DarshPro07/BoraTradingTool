# MarketPulse OS Domain Glossary

This glossary describes the active product. Earlier real-money Confirm and Autopilot concepts are retired and are not capabilities of the system.

## System Planes

**Product Surface**
The Next.js application that renders market, research, paper, learning, governance, and audit views. It persists local state in SQLite.

**Control Plane**
Claude Code operating through the project MCP server. It reads bounded evidence and may record local research artifacts. It has no broker or financial-mutation tool.

**Learning Plane**
The governed source-to-outcome chain: source, claim, concept, hypothesis, strategy specification, trial, validation, forward outcome, failure memory, and lesson.

**Quant Core**
The separate Python system in `E:/Trading_BOT`. MarketPulse reads its versioned contract over loopback HTTP or approved filesystem artifacts. An unavailable core is shown explicitly.

## Market Evidence

**Canonical Instrument**
A stable identifier in the form `MARKET:EXCHANGE:SYMBOL`, such as `US:XNAS:AAPL` or `IN:XNSE:RELIANCE`. Provider symbols are mappings, not identities.

**Normalized Quote**
A quote paired with instrument identity, currency, source, retrieval time, market time, and quality. A price without provenance is not a normalized quote.

**Evidence Quality**
An explicit source state such as live, delayed, stale, conflicted, authentication-required, or unavailable. Missing data is never treated as zero.

**Fixture Mode**
Deterministic research data enabled only by `MARKETPULSE_TEST_MODE=1`. Fixtures require an explicit disposable database and paper orders persist their fixture provenance; fixture results never mix silently into the owner database.

**Research Snapshot**
A bounded, hashable packet of normalized evidence used by an analyst or model. The snapshot hash makes a recorded opinion attributable to the exact evidence it received.

**Epistemic Status**
A claim label such as known, historically observed, inferred, not forward validated, conflicting, or unknown.

## Research and Learning

**Analysis Record**
A cited bull, bear, and neutral debate with stance, conviction, risks, invalidation conditions, and missing evidence. Directional analysis requires more than inference alone.

**Strategy Specification**
A bounded, versioned research hypothesis expressed in the local Strategy DSL. It is not an order instruction.

**Trial Ledger**
The append-only record of every validation attempt, including failures and inconclusive results. Trial count is part of the multiple-testing denominator.

**Locked Holdout**
The limited unbiased validation sample. Re-querying it outside its budget is prohibited because repeated access converts it into training data.

**Paper Challenger**
A strategy that passed the configured historical gauntlet and may collect forward paper evidence. It is not approved for live execution.

**Forward Outcome**
An observation created after a decision point. Forward-resolved outcomes are distinguished from historical or in-sample results.

**Failure Memory**
A durable record of failed ideas, causes, and lessons. It prevents deletion or accidental repetition of negative evidence.

**Learning Mode**
The governed state machine `off -> observing -> learning -> evolving`. Higher modes permit more local research work but never permit financial mutation, risk-kernel edits, trial deletion, or unreviewed deployment.

## Paper and Execution Boundary

**Paper Research Mode**
The only in-application order lifecycle. It uses separate USD and INR ledgers, deterministic fill rules, eligible quotes, session checks, and estimated fees.

**Manual Advisory Ticket**
A research suggestion the owner may use when placing an order manually outside MarketPulse. It carries no authorization or execution capability.

**Confirmed Live**
A reserved, unavailable capability state. It remains false until a separate owner decision, broker architecture, compliance review, and security review are completed.

**Execution Adapter Missing**
The fail-closed response returned by retired live-order endpoints. `EXECUTION_ADAPTER_MISSING` means the application cannot authorize or place an order.

**MCP Capability Class**
Every MCP tool is classified as `READ`, `WRITE_LOCAL`, `EXTERNAL_WRITE`, `FINANCIAL_MUTATION`, or `UNKNOWN`. Research agents are limited to `READ` and `WRITE_LOCAL`; external, financial, and unknown capabilities are denied. The exact served tool set is checked against an owner-protected manifest.

## Distribution

**Local First**
The application binds to loopback, uses a local SQLite database, and has no multi-tenant account system. Mutation routes still enforce loopback, origin, CSRF, or local bearer-token checks.
