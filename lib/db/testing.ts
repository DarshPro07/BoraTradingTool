import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { closeDatabase } from ".";

/**
 * Gives the calling test file its own database, and nothing else's.
 *
 * ## Why this is a helper rather than a paragraph in each file
 *
 * It was a paragraph in each file, and five files did not have it. `run-log.test.ts` wrote fixture
 * cycles named "older" and "newer" into the owner's `marketpulse.db`, where they appeared in the
 * live terminal beside real runs and could not be removed — `audit_events` is append-only by
 * database trigger. `rehearsal.test.ts`, `graveyard.test.ts`, `loss-memory.test.ts` and
 * `next-step.test.ts` all read it, so their assertions silently depended on whatever the owner
 * happened to have in production that day.
 *
 * Boilerplate that must be remembered is boilerplate that will be forgotten. `databasePath()` now
 * throws when a test process opens the default file, so forgetting this fails loudly at the first
 * query rather than quietly at some later read of the terminal.
 *
 * @param seed Runs after the fresh database is opened, for fixtures the subject reads back.
 *             It executes inside `beforeEach`, so each test gets its own copy.
 */
export function useTemporaryDatabase(seed?: () => void): void {
  const directories: string[] = [];
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.MARKETPULSE_DB_PATH;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-test-"));
    directories.push(directory);
    process.env.MARKETPULSE_DB_PATH = path.join(directory, "test.db");
    // The connection is cached at module scope. Without dropping it the next `getDb()` returns the
    // previous test's handle — including, the first time round, the owner's.
    closeDatabase();
    seed?.();
  });

  afterEach(() => {
    closeDatabase();
    // Restored rather than deleted: `delete process.env.X` and `X=undefined` are different states,
    // and a test that ran after one which set the path would otherwise inherit it.
    if (previous === undefined) delete process.env.MARKETPULSE_DB_PATH;
    else process.env.MARKETPULSE_DB_PATH = previous;

    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}
