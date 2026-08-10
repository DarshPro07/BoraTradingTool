# ADR 0007 - ISIN security identity with operational listing aliases

Status: Accepted

Date: 2026-08-09

## Context

MarketPulse currently identifies NSE instruments by mutable trading symbol, for example
`IN:XNSE:RELIANCE`. Those ids are persisted in candles, paper rows, experiment manifests, URLs, and
provider requests. NSE's official security files provide ISIN, which survives ordinary symbol/name
changes and is the appropriate durable security identity.

Changing every existing id to ISIN in one migration would require rewriting evidence and operational
history. It would either be irreversible or leave mixed identities whose meaning depends on date.

## Decision

ISIN is the canonical durable security id in the NSE security master. Exchange, series, symbol,
name, and status are effective-dated listing observations subordinate to that security.

Existing `MARKET:EXCHANGE:SYMBOL` ids remain operational aliases at the application boundary. APIs
and repository records expose both identities. New persistence that means "the security across
time" stores ISIN; existing candle/order/provider paths may continue using listing aliases until a
separately verified migration is justified.

Aliases are data, not fallback logic. An alias resolves only when it exists in the verified master.

## Consequences

- Symbol changes preserve one security identity and create listing history plus an alias.
- Existing evidence and stored bars remain readable without a destructive migration.
- Callers must choose intentionally between durable `securityId` and operational `instrumentId`.
- Point-in-time queries can return the symbol that was effective then.
- A security with multiple series has one ISIN security and distinct effective listing records.
- The old hardcoded XNSE catalog is not an alias source and cannot be used when the master is empty.

## Rejected alternatives

- Keep symbol as canonical identity: cannot represent symbol changes honestly.
- Rewrite all persisted ids now: too broad, irreversible, and unnecessary to fix selection and
  survivor bias.
- Use provider tokens as identity: tokens are vendor-specific mappings and cannot outrank the
  exchange-issued identity.
