# Program design - NSE search connection

## Files

- `lib/market/security-master.ts`: normalized matching and safe alias handling.
- `app/api/market/instruments/route.ts`: truthful unavailable response.
- `components/layout/TopNav.tsx`: async canonical submit resolution.
- `app/analyze/[ticker]/page.tsx`: expected input-error handling.
- `app/analyze/[ticker]/loading.tsx`: route feedback during server rendering.
- Existing Vitest and Playwright files: red-capable regression coverage.

## Contracts

- Exact identity wins over result count.
- Exactly one non-exact result may resolve automatically.
- Zero or multiple results never become an analysis URL.
- Every analysis navigation contains a canonical instrument ID.
- A company name shared by multiple ISINs is search data, not an identity alias.

## Rollback

Revert these search and submit changes. The official owner sync is append-only evidence and should
not be deleted; previous listing behavior remains compatible.
