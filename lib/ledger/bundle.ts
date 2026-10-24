/**
 * The cloud clock's state as one sealed file: the slim ledger database, the minute log and a small
 * meta record, gzipped and encrypted with AES-256-GCM under a key derived (scrypt) from LEDGER_KEY.
 *
 * The bundle is published as a GitHub release asset on a public repository, so anyone can download
 * it: only the ciphertext, its size and its time are public. GCM is authenticated, so a wrong key
 * or a changed byte fails to open instead of yielding a corrupt database.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const MAGIC = Buffer.from("MPL1");

export interface LedgerMeta {
  /** Milliseconds since the epoch at seal time; the newest bundle wins. */
  epoch: number;
  writtenAt: string;
  writer: "cloud";
  /** Audit rows up to this id came from the laptop at cutover; the laptop imports only later ones. */
  seedMaxAuditId: number;
  seededAt: string;
  /** The last time a live quote was usable. The watchdog alarms on this, not on the job being alive. */
  lastDataOkAt: string | null;
  /** True once the run that wrote it has finished; a promote waits for it. */
  final: boolean;
  runId: string | null;
}

export interface Bundle {
  meta: LedgerMeta;
  files: Record<string, Buffer>;
}

export function sealBundle(bundle: Bundle, passphrase: string): Buffer {
  if (passphrase.length < 32) throw new Error("LEDGER_KEY must be at least 32 characters");
  const names = Object.keys(bundle.files).sort();
  const header = Buffer.from(JSON.stringify({ meta: bundle.meta, sizes: names.map((n) => [n, bundle.files[n]!.length]) }), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const plain = gzipSync(Buffer.concat([length, header, ...names.map((n) => bundle.files[n]!)]));
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function openBundle(sealed: Buffer, passphrase: string): Bundle {
  if (sealed.length < 48 || !sealed.subarray(0, 4).equals(MAGIC)) throw new Error("not a ledger bundle");
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(passphrase, sealed.subarray(4, 20), 32), sealed.subarray(20, 32));
  decipher.setAuthTag(sealed.subarray(32, 48));
  // Throws on a wrong key or a changed byte.
  const plain = gunzipSync(Buffer.concat([decipher.update(sealed.subarray(48)), decipher.final()]));
  const headerLength = plain.readUInt32BE(0);
  const { meta, sizes } = JSON.parse(plain.subarray(4, 4 + headerLength).toString("utf8")) as { meta: LedgerMeta; sizes: [string, number][] };
  const files: Record<string, Buffer> = {};
  let offset = 4 + headerLength;
  for (const [name, size] of sizes) {
    files[name] = plain.subarray(offset, offset + size);
    offset += size;
  }
  return { meta, files };
}

/** LEDGER_KEY from the environment, else that one line of `.env.local`: the rest of the file is never loaded. */
export function ledgerKey(envFile = ".env.local"): string | null {
  if (process.env.LEDGER_KEY) return process.env.LEDGER_KEY;
  try {
    const line = fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith("LEDGER_KEY="));
    return line ? line.slice("LEDGER_KEY=".length).trim().replace(/^["']|["']$/g, "") || null : null;
  } catch {
    return null;
  }
}
