# Pending migration — awaiting one owner action

`0023_bar_ingestions.sql` is written, reviewed and ready, but it is staged HERE rather than in
`drizzle/` on purpose.

## Why it is not in `drizzle/`

`lib/db/migrate.ts` holds the `MIGRATIONS` list and is owner-protected ("Migration integrity and
compatibility logic are owner-reviewed", `lib/governance/paths.ts`). A migration file placed in
`drizzle/` without its line in that list would be applied to no database while looking applied
to anyone reading the directory — and the repository already has two tests that refuse exactly
that state:

- `lib/db/migrate.test.ts`: the applied versions must equal the directory listing.
- `lib/system/identity.test.ts`: "A file present in `drizzle/` but absent from the runner's
  MIGRATIONS list would apply to no database while looking applied to a reader of the directory."

Those invariants are correct, so the file waits outside the directory instead of breaking them.

## To promote it (two steps, both owner-side)

```bash
git mv docs/plans/nse-data-coverage/pending-migration/0023_bar_ingestions.sql drizzle/
```

then add one line to the end of the `MIGRATIONS` array in `lib/db/migrate.ts`:

```ts
  "0023_bar_ingestions.sql",
```

`npx vitest run lib/db lib/system` should then be green, and the ledger begins recording on the
next ingest with no further change.

## What happens until then — nothing breaks

`recordBarIngestion` (`lib/market/bar-ingestion-ledger.ts`) treats the missing table as "not
recorded" and returns `false`; ingestion is unaffected. `ingestionHealth()` returns `null` and
the /brain panel says the ledger is unregistered rather than claiming zero fetches. The audit
itself still runs on every fetch and travels in the ingest outcome, so the information exists —
it simply is not yet durable across restarts. Interim state: safe, stated, not silent.
