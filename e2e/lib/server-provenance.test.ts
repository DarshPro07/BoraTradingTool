import { describe, expect, it } from "vitest";
import { refuseUnprovenTarget } from "./server-provenance";

/**
 * The defect this guards, measured 2026-08-16.
 *
 * 14 of 22 strategy specs in the PRODUCTION database were Playwright artifacts — `e2e_ladder_fixture`,
 * `e2e_orb_…`, `ledger_gap_screen_…_desktop_chromium`, `probe_authored_null_…` — created by actors
 * `e2e`, `e2e-fixture` and `http-20124`. They inflated the strategy funnel's denominator and spent
 * the rehearsal rotation's ten-slot budget on fixtures instead of research candidates.
 *
 * The hole is structural, not careless. When `MARKETPULSE_E2E_BASE_URL` is set, `playwright.config.ts`
 * omits the entire `webServer` block — including `MARKETPULSE_DB_PATH: testDatabase`, which is what
 * makes every self-started run safe. An external URL is therefore unconstrained, and pointing it at
 * the owner's dev server on :3000 writes fixtures straight into the research population.
 *
 * `identity.setup.ts` already proves build, schema, database fingerprint and start time. It read
 * `testMode` and only PRINTED it — the one property that says "safe to write to" was the one not
 * asserted.
 */

describe("refusing a server the suite cannot prove is safe to write to", () => {
  it("permits a server Playwright started itself", () => {
    // The config always passes MARKETPULSE_DB_PATH when it spawns the server, so the target is a
    // test database by construction — whatever its test-mode flag says.
    expect(refuseUnprovenTarget({ external: false, testMode: false })).toBeNull();
    expect(refuseUnprovenTarget({ external: true, testMode: true })).toBeNull();
  });

  it("permits an external server in test mode — the sanctioned runbook shape", () => {
    // The acceptance runbook starts its own server on :3100 with MARKETPULSE_TEST_MODE=1 and a
    // virgin database, then points the suite at it. That must keep working.
    expect(refuseUnprovenTarget({ external: true, testMode: true })).toBeNull();
  });

  it("permits an external server whose exact database the runner pinned", () => {
    // An explicit fingerprint is a stronger proof than the mode flag: it names the database.
    expect(
      refuseUnprovenTarget({ external: true, testMode: false, pinnedDatabase: "sha256:abc" }),
    ).toBeNull();
  });

  it("REFUSES an external server that is neither in test mode nor pinned", () => {
    // The production dev server on :3000: real mode, no pin, live research data.
    const refusal = refuseUnprovenTarget({ external: true, testMode: false });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("MARKETPULSE_E2E_EXPECT_DB_FINGERPRINT");
  });

  it("names what it refuses so the message is actionable, not just a failure", () => {
    const refusal = refuseUnprovenTarget({ external: true, testMode: false }) ?? "";
    expect(refusal).toMatch(/test mode/i);
  });
});
