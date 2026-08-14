import { expect, test as setup } from "@playwright/test";

/**
 * Prove which server this suite is about to interrogate, before it interrogates it.
 *
 * Task 1 lost an afternoon to a stale `next start` that kept the port and served the previous
 * bundle: a fix that had genuinely been applied looked broken, and the only thing that settled it
 * was checking the PID by hand. Every conclusion a browser suite reaches is worth exactly as much
 * as its confidence about which build produced it, so this runs first and everything else depends
 * on it.
 *
 * It is a setup PROJECT rather than `globalSetup` deliberately — a setup project runs after the web
 * server is up and has the `request` fixture, and its failure blocks the projects that depend on it
 * instead of being reported as an unrelated connection error.
 *
 * Expectations are assert-if-provided. With no expectation there is nothing to compare against, and
 * inventing one would be a fabricated assertion. What is never optional is that the endpoint answers
 * and that the database is real — those are preconditions, not preferences.
 */
type SystemIdentity = {
  buildId: string | null;
  runtimeMode: string;
  testMode: boolean;
  appVersion: string;
  processId: number;
  serverStartedAt: string;
  schemaVersion: string | null;
  schemaCount: number;
  databaseFingerprint: string | null;
};

const expected = {
  commit: process.env.MARKETPULSE_E2E_EXPECT_COMMIT?.trim(),
  database: process.env.MARKETPULSE_E2E_EXPECT_DB_FINGERPRINT?.trim(),
  schema: process.env.MARKETPULSE_E2E_EXPECT_SCHEMA?.trim(),
  /**
   * ISO instant the server was (re)started at. Set it to the moment the runner launched the server
   * and a survivor from a previous run cannot pass as the new one.
   *
   * This exists because the failure happened twice, the second time while building this gate: a
   * `next start` was "restarted" with new environment variables, the old process still held the
   * port, the new one died of EADDRINUSE, and a nine-minute suite ran happily against the old
   * configuration. Build, schema and database were all identical — only the ENVIRONMENT differed,
   * so no fingerprint could have caught it. Start time is what separates them.
   */
  startedAfter: process.env.MARKETPULSE_E2E_EXPECT_STARTED_AFTER?.trim(),
};

setup("the server under test is the build under test", async ({ request }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? "(no baseURL configured)";
  const response = await request.get("/api/system/identity");

  if (response.status() === 404) {
    throw new Error(
      `${baseURL} has no /api/system/identity.\n\n` +
        `This is not a missing route — it is an OLDER BUILD than the one under test, or another ` +
        `application holding the port. Nothing this suite reports about it would describe the code ` +
        `you are changing. Stop the process on that port and start the build you mean to test.`,
    );
  }
  expect(response.ok(), `${baseURL}/api/system/identity returned ${response.status()}`).toBe(true);

  const identity = (await response.json()) as SystemIdentity;

  // Recorded on every run, expectation or not: the log of a passing run should say what passed.
  console.log(
    `[identity] ${baseURL}\n` +
      `           build   ${identity.buildId ?? "UNPINNED (no commit inlined at build time)"}\n` +
      `           mode    ${identity.runtimeMode}${identity.testMode ? " (test mode)" : ""}\n` +
      `           pid     ${identity.processId}, up since ${identity.serverStartedAt}\n` +
      `           schema  ${identity.schemaVersion ?? "NONE"} (${identity.schemaCount} applied)\n` +
      `           db      ${identity.databaseFingerprint ?? "UNREACHABLE"}`,
  );

  // Unconditional. A null fingerprint means the server cannot reach or has not migrated its
  // database, and every downstream failure would describe a symptom of that rather than the cause.
  expect(
    identity.databaseFingerprint,
    "The server cannot reach or has not migrated its database. Fix that before reading any test result below.",
  ).not.toBeNull();

  if (expected.commit) {
    expect(
      identity.buildId,
      `Wrong build.\n  expected ${expected.commit}\n  serving  ${identity.buildId ?? "nothing pinned"}`,
    ).toBe(expected.commit);
  }
  if (expected.database) {
    expect(
      identity.databaseFingerprint,
      `Wrong database.\n  expected ${expected.database}\n  serving  ${identity.databaseFingerprint}\n` +
        `A suite that seeds one database and asserts against another passes and proves nothing.`,
    ).toBe(expected.database);
  }
  if (expected.startedAfter) {
    const floor = Date.parse(expected.startedAfter);
    expect(Number.isNaN(floor), `MARKETPULSE_E2E_EXPECT_STARTED_AFTER is not a date: ${expected.startedAfter}`).toBe(false);
    expect(
      Date.parse(identity.serverStartedAt) >= floor,
      `Stale server.\n  pid ${identity.processId} started ${identity.serverStartedAt}\n` +
        `  but this run expected a server started at or after ${expected.startedAfter}.\n` +
        `A process from an earlier run is still holding this port; the one you just launched ` +
        `almost certainly died of EADDRINUSE. Kill pid ${identity.processId} and start again.`,
    ).toBe(true);
  }
  if (expected.schema) {
    expect(
      identity.schemaVersion,
      `Wrong schema.\n  expected ${expected.schema}\n  serving  ${identity.schemaVersion ?? "none"}`,
    ).toBe(expected.schema);
  }
});
