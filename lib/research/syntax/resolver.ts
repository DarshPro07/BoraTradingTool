import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * The seam between grammar and trading meaning.
 *
 * A resolver returns SYNTAX ONLY — sentence boundaries, tokens, dependency labels, head links and
 * character offsets that index the exact string it was given. It does not know what ENTRY, EXIT,
 * RSI14 or BUY are, and it must never learn: a parser that emitted Strategy IR would be a second
 * authoring path with no span guard, no dimensional analysis and no satisfiability gate in front
 * of it, which is the failure the semantic compiler exists to prevent.
 *
 * The interface exists so the compiler never imports spaCy. Swapping the parser is a constructor
 * change; it is not a rewrite of attachment.
 */

export interface ParsedToken {
  index: number;
  text: string;
  lemma: string;
  pos: string;
  tag: string;
  dep: string;
  /** spaCy convention: a root token heads itself. Detect roots structurally, not by null. */
  headIndex: number;
  start: number;
  end: number;
}

export interface ParsedSentence {
  start: number;
  end: number;
  text: string;
}

export interface SyntaxParse {
  parser: string;
  model: string;
  modelVersion: string;
  sentences: ParsedSentence[];
  tokens: ParsedToken[];
}

export interface ParserIdentity {
  parser: string;
  parserVersion: string;
  model: string;
  modelVersion: string;
  python: string;
}

export interface SyntaxAttachmentResolver {
  /** Throws `SYNTAX_PARSER_UNAVAILABLE` rather than degrading. There is no positional fallback. */
  parse(text: string): Promise<SyntaxParse>;
  health(): Promise<ParserIdentity>;
  dispose(): Promise<void>;
}

export class SyntaxParserUnavailable extends Error {
  readonly code = "SYNTAX_PARSER_UNAVAILABLE";
  constructor(reason: string) {
    super(`SYNTAX_PARSER_UNAVAILABLE: ${reason}`);
    this.name = "SyntaxParserUnavailable";
  }
}

/**
 * Where Python lives, stated explicitly.
 *
 * REPRODUCED on this machine, 2026-08-11: `python` first on PATH resolves to an unrelated
 * project's virtualenv with no spaCy installed, while the interpreter that HAS spaCy sits third.
 * Ambient resolution would have selected the wrong one silently. This is the same class of defect
 * as the recorded "CLI works in Git Bash but is invisible to the server" failure, so the
 * interpreter is configuration, never discovery.
 */
export function parserConfig(env: NodeJS.ProcessEnv = process.env): {
  python: string;
  model: string;
} {
  const python = env.SYNTAX_PARSER_PYTHON?.trim();
  const model = env.SYNTAX_PARSER_MODEL?.trim();
  if (!python) {
    throw new SyntaxParserUnavailable(
      "SYNTAX_PARSER_PYTHON is not set. The interpreter is configuration, not discovery — " +
        "`python` on PATH is not guaranteed to be the one with spaCy installed.",
    );
  }
  return { python, model: model || "en_core_web_sm" };
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

/**
 * spaCy behind one long-lived process.
 *
 * The model load is the cost — seconds for `en_core_web_trf`, ~1s for `en_core_web_sm` — so it is
 * paid once at startup rather than per clause. Requests are correlated by id and answered in
 * order over a line-delimited JSON pipe.
 */
export class SpaCyDependencyResolver implements SyntaxAttachmentResolver {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<ParserIdentity> | null = null;
  private identity: ParserIdentity | null = null;
  private readonly pending = new Map<string, Pending>();
  private sequence = 0;

  constructor(
    private readonly python: string,
    private readonly model: string,
    private readonly scriptPath = "quant/syntax_parser.py",
    private readonly startupTimeoutMs = 120_000,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SpaCyDependencyResolver {
    const { python, model } = parserConfig(env);
    return new SpaCyDependencyResolver(python, model);
  }

  private start(): Promise<ParserIdentity> {
    if (this.starting) return this.starting;

    this.starting = new Promise<ParserIdentity>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.python, [this.scriptPath, this.model], {
          shell: false,
          windowsHide: true,
        }) as ChildProcessWithoutNullStreams;
      } catch (caught) {
        reject(new SyntaxParserUnavailable(`could not start ${this.python}: ${String(caught)}`));
        return;
      }
      this.child = child;

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(
          new SyntaxParserUnavailable(
            `${this.model} did not become ready within ${this.startupTimeoutMs}ms. ${stderr.slice(-400)}`,
          ),
        );
      }, this.startupTimeoutMs);

      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        if (!line.trim()) return;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return; // A non-JSON line is library noise on stdout, not a response.
        }

        // The first line is the readiness banner; everything after is a correlated response.
        if (this.identity === null && message.ready === true) {
          clearTimeout(timer);
          this.identity = {
            parser: String(message.parser),
            parserVersion: String(message.parserVersion),
            model: String(message.model),
            modelVersion: String(message.modelVersion),
            python: String(message.python),
          };
          resolve(this.identity);
          return;
        }
        if (this.identity === null && message.ok === false) {
          clearTimeout(timer);
          reject(new SyntaxParserUnavailable(String(message.error)));
          return;
        }

        const id = message.requestId === undefined ? null : String(message.requestId);
        if (id === null) return;
        const waiting = this.pending.get(id);
        if (!waiting) return;
        this.pending.delete(id);
        waiting.resolve(message);
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new SyntaxParserUnavailable(`could not start ${this.python}: ${error.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const failure = new SyntaxParserUnavailable(
          `parser exited with code ${code}. ${stderr.slice(-400)}`,
        );
        for (const [, waiting] of this.pending) waiting.reject(failure);
        this.pending.clear();
        this.child = null;
        this.identity = null;
        this.starting = null;
        reject(failure);
      });
    });

    return this.starting;
  }

  private async send(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.start();
    const child = this.child;
    if (!child) throw new SyntaxParserUnavailable("parser is not running");

    const id = String((this.sequence += 1));
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ ...request, requestId: id })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(new SyntaxParserUnavailable(`write failed: ${error.message}`));
      });
    });
  }

  async health(): Promise<ParserIdentity> {
    await this.start();
    if (!this.identity) throw new SyntaxParserUnavailable("parser reported no identity");
    return this.identity;
  }

  async parse(text: string): Promise<SyntaxParse> {
    const identity = await this.health();
    const response = await this.send({ text });
    if (response.ok !== true) {
      throw new SyntaxParserUnavailable(String(response.error ?? "parse failed"));
    }
    return {
      parser: identity.parser,
      model: identity.model,
      modelVersion: identity.modelVersion,
      sentences: response.sentences as ParsedSentence[],
      tokens: response.tokens as ParsedToken[],
    };
  }

  async dispose(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.starting = null;
    this.identity = null;
    try {
      child.stdin.write(`${JSON.stringify({ op: "shutdown" })}\n`);
    } catch {
      // Already gone; the kill below is the backstop.
    }
    child.kill();
  }
}
