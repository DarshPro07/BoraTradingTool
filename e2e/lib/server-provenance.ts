/**
 * May this suite write to the server it was pointed at?
 *
 * Every self-started run is safe by construction: `playwright.config.ts` passes
 * `MARKETPULSE_DB_PATH: testDatabase` in the `webServer` env, so the target is a test database
 * whatever else is true. But that whole block is omitted when `MARKETPULSE_E2E_BASE_URL` is set —
 * an external URL inherits none of it, and the suite seeds fixtures into whatever answers.
 *
 * It did. 14 of 22 strategy specs in the production database were Playwright artifacts, inflating
 * the research funnel's denominator and spending the rehearsal rotation on fixtures.
 *
 * So an external target must PROVE it is safe, by one of the two things that actually prove it:
 * the server says it is in test mode, or the runner pinned the exact database fingerprint it
 * expects. Neither is a preference; a suite that cannot say which database it is about to write
 * to should not write to one.
 */
export interface ServerProvenance {
  /** True when `MARKETPULSE_E2E_BASE_URL` pointed the suite at a server it did not start. */
  external: boolean;
  /** The server's own answer, from `/api/system/identity`. */
  testMode: boolean;
  /** `MARKETPULSE_E2E_EXPECT_DB_FINGERPRINT`, when the runner supplied one. */
  pinnedDatabase?: string;
}

/** The refusal to raise, or null when the target is proven safe to write to. */
export function refuseUnprovenTarget(provenance: ServerProvenance): string | null {
  if (!provenance.external) return null;
  if (provenance.testMode) return null;
  if (provenance.pinnedDatabase) return null;

  return (
    "Refusing to run against an unproven external server.\n\n" +
    "MARKETPULSE_E2E_BASE_URL points this suite at a server it did not start, so it inherited " +
    "none of the config's webServer environment — including MARKETPULSE_DB_PATH, which is what " +
    "makes every self-started run write to a test database. This server reports it is NOT in " +
    "test mode, and no database fingerprint was pinned, so nothing here can tell it apart from " +
    "the production instance.\n\n" +
    "That is not hypothetical: 14 of 22 strategy specs in the production database are Playwright " +
    "fixtures from a run made exactly this way.\n\n" +
    "Fix by one of:\n" +
    "  - start the server under test with MARKETPULSE_TEST_MODE=1 and its own MARKETPULSE_DB_PATH\n" +
    "  - or pin the database with MARKETPULSE_E2E_EXPECT_DB_FINGERPRINT if you mean this one"
  );
}
