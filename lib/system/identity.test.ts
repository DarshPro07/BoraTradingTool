import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/lib/db";
import { systemIdentity } from "./identity";

const directories: string[] = [];
let previousPath: string | undefined;

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-identity-"));
  directories.push(directory);
  return directory;
}

/** The handle is cached at module scope, so the path only takes effect after it is dropped. */
function useDatabaseAt(file: string): void {
  closeDatabase();
  process.env.MARKETPULSE_DB_PATH = file;
}

function deleteDatabase(file: string): void {
  // WAL leaves two siblings behind. Removing only the main file lets SQLite recover the original
  // content on reopen, which would make the recreation test pass for the wrong reason.
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
}

beforeEach(() => {
  previousPath = process.env.MARKETPULSE_DB_PATH;
});

afterEach(() => {
  closeDatabase();
  vi.useRealTimers();
  if (previousPath === undefined) delete process.env.MARKETPULSE_DB_PATH;
  else process.env.MARKETPULSE_DB_PATH = previousPath;
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("systemIdentity", () => {
  it("fingerprints one database identically on every call, including across a reconnect", () => {
    const file = path.join(temporaryDirectory(), "test.db");
    useDatabaseAt(file);

    const first = systemIdentity().databaseFingerprint;
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(systemIdentity().databaseFingerprint).toBe(first);

    // A restarted server must attest as the same database, or the gate is useless for its one job.
    closeDatabase();
    expect(systemIdentity().databaseFingerprint).toBe(first);
  });

  it("gives two databases at different paths different fingerprints", () => {
    const first = path.join(temporaryDirectory(), "test.db");
    useDatabaseAt(first);
    const firstFingerprint = systemIdentity().databaseFingerprint;

    const second = path.join(temporaryDirectory(), "test.db");
    useDatabaseAt(second);

    // Same filename, different directory: this is the production-vs-isolated mixup the gate exists
    // to catch, and it is invisible to any check that only looks at the basename.
    expect(systemIdentity().databaseFingerprint).not.toBe(firstFingerprint);
  });

  it("does not mistake a recreated database for the original at the same path", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-11T04:00:00Z"));

    const file = path.join(temporaryDirectory(), "test.db");
    useDatabaseAt(file);
    const original = systemIdentity().databaseFingerprint;

    closeDatabase();
    deleteDatabase(file);
    vi.setSystemTime(new Date("2026-08-11T04:00:05Z"));
    useDatabaseAt(file);

    // Path alone would report these as the same database, so a suite that seeded the first one
    // would attest green against the second, empty one.
    expect(systemIdentity().databaseFingerprint).not.toBe(original);
  });

  it("never discloses where the database lives", () => {
    const directory = temporaryDirectory();
    const file = path.join(directory, "test.db");
    useDatabaseAt(file);

    const serialized = JSON.stringify(systemIdentity());
    expect(serialized).not.toContain("test.db");
    expect(serialized).not.toContain(path.basename(directory));
  });

  it("reports an unreachable database as unknown rather than crashing", () => {
    // A directory cannot be opened as a database. The endpoint's job is to describe reality, and
    // throwing here would reach the attestation gate as "server unreachable" — a different
    // diagnosis pointing at a different fix.
    useDatabaseAt(temporaryDirectory());

    const identity = systemIdentity();
    expect(identity.databaseFingerprint).toBeNull();
    expect(identity.schemaVersion).toBeNull();
    expect(identity.schemaCount).toBe(0);
    // The parts that do not depend on the database must still be answered.
    expect(identity.processId).toBe(process.pid);
    expect(identity.serverStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("reports the schema actually applied, not the schema on disk", () => {
    useDatabaseAt(path.join(temporaryDirectory(), "test.db"));
    const migrations = fs
      .readdirSync(path.join(process.cwd(), "drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    const identity = systemIdentity();
    expect(identity.schemaVersion).toBe(migrations.at(-1));
    // A file present in `drizzle/` but absent from the runner's MIGRATIONS list would apply to no
    // database while looking applied to a reader of the directory.
    expect(identity.schemaCount).toBe(migrations.length);
  });
});
