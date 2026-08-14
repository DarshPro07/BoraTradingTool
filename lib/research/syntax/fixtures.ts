import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ParserIdentity, SyntaxAttachmentResolver, SyntaxParse } from "./resolver";
import { clauseSlicesOf } from "../semantic-compiler";

/**
 * Recorded parses, so the suite exercises the parser MarketPulse actually pins without paying a
 * model load per test.
 *
 * A fixture is NOT a stand-in for the parser — it is the parser's real output, captured. The
 * alternative (hand-written token trees) would let the suite drift into asserting a grammar spaCy
 * does not produce, which is how a green suite stops meaning anything.
 *
 * On a miss a fixture is RECORDED from the pinned model when `SYNTAX_PARSER_PYTHON` is set, and
 * otherwise the call THROWS. It never returns an empty or synthesised parse: a missing fixture
 * that silently produced "no tokens" would make the compiler refuse everything and look safe
 * while testing nothing.
 */

const FIXTURE_DIR = resolve(process.cwd(), "lib/research/syntax/__fixtures__");
const SCRIPT_PATH = resolve(process.cwd(), "quant/syntax_parser.py");

interface StoredFixture {
  prose: string;
  parse: SyntaxParse;
}

const cache = new Map<string, SyntaxParse>();

/**
 * ONE FILE PER PARSE, named by a hash of the text.
 *
 * A single JSON map looked tidier and was wrong: vitest runs test files in parallel workers, so
 * two workers recording different fixtures would each rewrite the whole map and the later write
 * would silently drop the earlier one's entry. Separate files make concurrent recording safe and
 * give each captured parse its own reviewable diff.
 */
function fixturePath(text: string): string {
  return join(FIXTURE_DIR, `${createHash("sha256").update(text).digest("hex").slice(0, 32)}.json`);
}

function readFixture(text: string): SyntaxParse | null {
  const cached = cache.get(text);
  if (cached) return cached;

  const path = fixturePath(text);
  if (!existsSync(path)) return null;

  const stored = JSON.parse(readFileSync(path, "utf8")) as StoredFixture;
  cache.set(text, stored.parse);
  return stored.parse;
}

/**
 * Parse many texts in ONE worker invocation, through the same script production uses.
 *
 * The model load is the whole cost — ~7s for `en_core_web_sm` against ~0.01s to parse a clause —
 * so recording clause-by-clause spawned a fresh interpreter per clause and made the suite
 * effectively unrunnable. Every text goes down one stdin pipe instead.
 */
function generateMany(texts: readonly string[], python: string, model: string): Map<string, SyntaxParse> {
  const stdout = execFileSync(python, [SCRIPT_PATH, model], {
    input: texts.map((text, index) => `${JSON.stringify({ requestId: String(index), text })}\n`).join(""),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

  let banner: Record<string, unknown> | null = null;
  const responses = new Map<string, Record<string, unknown>>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    const message = JSON.parse(line) as Record<string, unknown>;
    if (message.ready === true) banner = message;
    if (message.requestId !== undefined) responses.set(String(message.requestId), message);
  }
  if (!banner) throw new Error("The syntax parser never became ready; no fixture was recorded.");

  const parsed = new Map<string, SyntaxParse>();
  texts.forEach((text, index) => {
    const response = responses.get(String(index));
    if (!response || response.ok !== true) {
      throw new Error(`Parse failed for "${text.slice(0, 60)}…": ${String(response?.error)}`);
    }
    parsed.set(text, {
      parser: String(banner.parser),
      model: String(banner.model),
      modelVersion: String(banner.modelVersion),
      sentences: response.sentences as SyntaxParse["sentences"],
      tokens: response.tokens as SyntaxParse["tokens"],
    });
  });
  return parsed;
}

function record(texts: readonly string[]): void {
  const python = process.env.SYNTAX_PARSER_PYTHON?.trim();
  const model = process.env.SYNTAX_PARSER_MODEL?.trim() || "en_core_web_sm";
  if (!python) {
    throw new Error(
      "No recorded parse for this text, and SYNTAX_PARSER_PYTHON is unset so one cannot be " +
        `recorded. Set it and re-run to capture the fixture.\n\nText: ${texts[0]}`,
    );
  }

  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const [text, parse] of generateMany(texts, python, model)) {
    // WRITE THEN RENAME. Vitest workers record concurrently, and a plain write let another worker
    // read a half-written file and die on truncated JSON — a failure that moved between tests on
    // every run and looked exactly like a flaky compiler. Rename is atomic on one filesystem.
    const path = fixturePath(text);
    const staging = `${path}.${process.pid}.tmp`;
    writeFileSync(staging, `${JSON.stringify({ prose: text, parse } satisfies StoredFixture, null, 2)}\n`, "utf8");
    renameSync(staging, path);
    cache.set(text, parse);
  }
}

export function parseFixture(text: string): SyntaxParse {
  const existing = readFixture(text);
  if (existing) return existing;

  record([text]);
  const stored = readFixture(text);
  if (!stored) throw new Error(`Fixture was recorded but could not be read back: ${text.slice(0, 60)}…`);
  return stored;
}

/**
 * Every parse `compileResearchProse` will ask for, keyed by the clause text it looks up.
 *
 * The compiler parses PER CLAUSE, and `clauseSlicesOf` is the compiler's own segmentation, so the
 * keys match by construction rather than by the two staying in step by hand.
 */
export function parseFixtures(prose: string): Record<string, SyntaxParse> {
  const slices = [...new Set(clauseSlicesOf(prose))];

  const missing = slices.filter((slice) => readFixture(slice) === null);
  if (missing.length > 0) record(missing);

  const map: Record<string, SyntaxParse> = {};
  for (const slice of slices) {
    const parse = readFixture(slice);
    if (parse) map[slice] = parse;
  }
  return map;
}

/**
 * A resolver that answers from recorded parses instead of a live worker.
 *
 * Same model, same output, no process. Tests that exercise the authoring edge use this so the
 * suite neither spawns an interpreter per test file nor depends on scheduling luck.
 */
export function fixtureResolver(): SyntaxAttachmentResolver {
  return {
    parse: async (text: string) => parseFixture(text),
    health: async (): Promise<ParserIdentity> => ({
      parser: "spacy",
      parserVersion: "recorded",
      model: process.env.SYNTAX_PARSER_MODEL?.trim() || "en_core_web_sm",
      modelVersion: "recorded",
      python: "recorded",
      // No process exists, and saying so is the point — a fabricated pid would make a fixture look
      // like a running worker on the readiness surface.
      pid: null,
    }),
    dispose: async () => {},
  };
}
