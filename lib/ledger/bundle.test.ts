import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ledgerKey, openBundle, sealBundle, type LedgerMeta } from "./bundle";

const KEY = "k".repeat(43);
const meta: LedgerMeta = { epoch: 1, writtenAt: "x", writer: "cloud", seedMaxAuditId: 7, seededAt: "x", lastDataOkAt: null, final: false, runId: null };

describe("the sealed bundle (docs/plans/cloud-clock)", () => {
  const bundle = { meta, files: { "marketpulse.db": Buffer.from("SQLite format 3\0 pages"), "intraday.log": Buffer.from("[a] b ran\n"), "cycle.log": Buffer.alloc(0) } };

  it("opens to exactly what was sealed", () => {
    const opened = openBundle(sealBundle(bundle, KEY), KEY);
    expect(opened.meta).toEqual(meta);
    expect(Object.fromEntries(Object.entries(opened.files).map(([k, v]) => [k, v.toString("utf8")]))).toEqual(
      Object.fromEntries(Object.entries(bundle.files).map(([k, v]) => [k, v.toString("utf8")])),
    );
  });

  it("is ciphertext: the public release never shows the database", () => {
    expect(sealBundle(bundle, KEY).includes(Buffer.from("SQLite format 3"))).toBe(false);
  });

  it("refuses a wrong key, a changed byte and a short key", () => {
    const sealed = sealBundle(bundle, KEY);
    expect(() => openBundle(sealed, "j".repeat(43))).toThrow();
    const changed = Buffer.from(sealed);
    changed[changed.length - 1]! ^= 1;
    expect(() => openBundle(changed, KEY)).toThrow();
    expect(() => sealBundle(bundle, "short")).toThrow(/at least 32/);
  });

  it("reads LEDGER_KEY from that one line of .env.local and loads nothing else", () => {
    const previous = process.env.LEDGER_KEY;
    delete process.env.LEDGER_KEY;
    const env = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-env-")), ".env.local");
    fs.writeFileSync(env, `ANTHROPIC_API_KEY=must-stay-unloaded\nLEDGER_KEY="${KEY}"\n`);
    try {
      expect(ledgerKey(env)).toBe(KEY);
      expect(process.env.ANTHROPIC_API_KEY).not.toBe("must-stay-unloaded");
    } finally {
      if (previous !== undefined) process.env.LEDGER_KEY = previous;
    }
  });

  it("trims the environment value: a pasted GitHub secret can end in a newline", () => {
    const previous = process.env.LEDGER_KEY;
    process.env.LEDGER_KEY = `${KEY}\n`;
    try {
      expect(ledgerKey("no-such-file")).toBe(KEY);
    } finally {
      if (previous === undefined) delete process.env.LEDGER_KEY;
      else process.env.LEDGER_KEY = previous;
    }
  });
});
