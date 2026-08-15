# Pending migration 0024 — awaiting one owner action

`0024_sector_classifications.sql` is written and ready, staged here rather than in `drizzle/`
for the same reason `0023` was: `lib/db/migrate.ts` holds the `MIGRATIONS` list and is
owner-protected, and a migration sitting in `drizzle/` WITHOUT its line there would apply to no
database while looking applied to anyone reading the directory — a state two existing tests
correctly refuse.

## To promote (two steps, both owner-side)

```bash
git mv docs/plans/nse-qc-001/pending-migration/0024_sector_classifications.sql drizzle/
```

then append one line to `MIGRATIONS` in `lib/db/migrate.ts`:

```ts
  "0024_sector_classifications.sql",
```

Then run the ingestion once:

```bash
npx tsx scripts/ingest-nse-sectors.mts
```

## Until then — nothing breaks

`sectorClassificationReady()` returns false, the ingestion script refuses with a stated reason,
and the trial-activation gate keeps reporting sector representation as `UNMEASURABLE` — which
is the truthful reading, and which keeps the gate shut rather than letting it pass on absence.
