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
  /**
   * The worker's OS process id, or null when the parse came from recorded fixtures.
   *
   * It is here so "is the worker warm?" is answerable rather than assumed: two requests that report
   * the same pid demonstrably shared a worker, and a changing pid says the model is being reloaded.
   * That distinction was invisible while a fresh worker was built per request, which is exactly how
   * a 20-second control went unnoticed.
   */
  pid: number | null;
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
            pid: child.pid ?? null,
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

  /**
   * What the worker IS right now, without making it exist.
   *
   * `health()` starts the parser as a side effect, which is right for a caller about to parse and
   * catastrophic for a status poll: readiness is read on a timer, so a health-based row would spawn
   * an interpreter and load a model every few seconds. Null means "not started", which is a normal
   * state on a fresh server and not a fault.
   */
  currentIdentity(): ParserIdentity | null {
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

let shared: { key: string; resolver: SpaCyDependencyResolver } | null = null;

/**
 * The one parser worker this process uses.
 *
 * ## Why this function has to exist
 *
 * `SpaCyDependencyResolver` was already written to hold a long-lived child — `start()` memoises per
 * instance, and the comment above it says the model load "is paid once at startup rather than per
 * clause". That was true of the class and false of the application, because the only production
 * caller obtained its resolver from a DEFAULT PARAMETER:
 *
 *     resolver: SyntaxAttachmentResolver = SpaCyDependencyResolver.fromEnv()
 *
 * A default parameter expression is evaluated on every call that omits the argument, so every
 * request built a new instance, spawned a new interpreter and reloaded `en_core_web_sm`. MEASURED
 * on 2026-08-11: 17–22 seconds per `POST /api/research/hypotheses`, with no warm-up across three
 * consecutive calls — including calls that authored nothing at all.
 *
 * The class was correct. The lifetime was one call. Nothing about "persistent worker" was
 * reachable from where it was constructed.
 *
 * ## Ownership
 *
 * Whoever creates a resolver disposes it. This one belongs to the process and is disposed only by
 * `disposeSharedSyntaxResolver`. Callers must NOT dispose it — `authorFromHypotheses` used to, in a
 * `finally`, which is correct for a resolver it created and fatal for one it merely borrowed.
 *
 * ## Concurrency
 *
 * The check-then-assign below cannot interleave: it is synchronous, and JavaScript will not run
 * another turn in the middle of it. Two simultaneous requests therefore get the same instance, and
 * the second one's `parse` simply queues on the first one's `start()` promise.
 *
 * A worker that dies is not a permanent outage: the class's `close` handler clears `starting`, so
 * the next call through this same instance respawns.
 *
 * `SYNTAX_PARSER_PYTHON` stays mandatory. `parserConfig` throws when it is unset, and nothing here
 * falls back to an ambient `python` — on this machine the first `python` on PATH is a virtualenv
 * with no spaCy, so discovery would silently select the wrong interpreter.
 */
export function sharedSyntaxResolver(env: NodeJS.ProcessEnv = process.env): SpaCyDependencyResolver {
  const { python, model } = parserConfig(env);
  const key = `${python} ${model}`;
  if (shared && shared.key === key) return shared.resolver;
  // Configuration changed. Serving the old worker would answer with a model nobody asked for.
  void shared?.resolver.dispose();
  shared = { key, resolver: new SpaCyDependencyResolver(python, model) };
  return shared.resolver;
}

/** For shutdown and for tests that must not leave an interpreter running. */
export async function disposeSharedSyntaxResolver(): Promise<void> {
  const current = shared;
  shared = null;
  await current?.resolver.dispose();
}

export interface SharedWorkerState {
  /** Whether `SYNTAX_PARSER_PYTHON` is set. Never a guess at an interpreter. */
  configured: boolean;
  /** Why it is unusable, when it is. */
  reason: string | null;
  model: string | null;
  /** A worker is running and has answered its readiness banner. */
  warm: boolean;
  pid: number | null;
  parserVersion: string | null;
  modelVersion: string | null;
}

/**
 * The parser's state for a status surface. Cheap, synchronous, and it NEVER starts anything.
 *
 * The interpreter path is deliberately not returned. It is a local filesystem path, and the same
 * rule that keeps the database path out of `/api/system/identity` applies here: proving a
 * dependency is configured must not require publishing where it lives.
 */
export function sharedSyntaxWorkerState(env: NodeJS.ProcessEnv = process.env): SharedWorkerState {
  let model: string | null = null;
  try {
    model = parserConfig(env).model;
  } catch (caught) {
    return {
      configured: false,
      reason: caught instanceof Error ? caught.message.replace(/^SYNTAX_PARSER_UNAVAILABLE: /, "") : String(caught),
      model: null,
      warm: false,
      pid: null,
      parserVersion: null,
      modelVersion: null,
    };
  }

  const identity = shared?.resolver.currentIdentity() ?? null;
  return {
    configured: true,
    reason: null,
    model,
    warm: identity !== null,
    pid: identity?.pid ?? null,
    parserVersion: identity?.parserVersion ?? null,
    modelVersion: identity?.modelVersion ?? null,
  };
}
