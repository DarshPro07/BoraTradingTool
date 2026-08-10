"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * The boundary every route segment falls back to.
 *
 * One file rather than twenty-six. A boundary placed at the root catches any segment below it that
 * does not define its own, and no screen here has an error state specific enough to justify a
 * second copy of this. Adding one per route would be twenty-six files that drift apart.
 *
 * ## Why it shows the digest and not the message
 *
 * Next.js strips server error messages in production and replaces them with a `digest` that
 * matches a line in the server log. Rendering `error.message` would show "An error occurred in the
 * Server Components render" — text that looks like an explanation and contains nothing. The digest
 * is the only thing on this screen that can actually be traced, so it is the thing shown.
 *
 * This system is built on the rule that a missing measurement is never presented as a value. A
 * crash screen that invents a friendly cause would be the same failure wearing a nicer font.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-4">
      <div className="border border-loss bg-panel-alt p-4 max-w-2xl" data-testid="route-error">
        <h1 className="text-sm tracking-wider text-loss flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4" />
          THIS SCREEN FAILED TO RENDER
        </h1>

        <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
          The rest of the terminal is unaffected — the failure is contained to this route. Nothing
          was written and no decision was recorded. Whatever this screen would have shown, treat it
          as <strong>unknown</strong> rather than as empty.
        </p>

        {error.digest ? (
          <p className="text-[10px] mb-3">
            <span className="text-muted-foreground">Server log digest</span>{" "}
            <code className="border border-panel px-1 py-0.5">{error.digest}</code>
          </p>
        ) : (
          <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap border border-panel p-2 mb-3">
            {error.message}
          </pre>
        )}

        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 border border-panel px-2 py-1 text-[11px] hover:bg-panel"
        >
          <RotateCcw className="w-3 h-3" />
          Render again
        </button>
      </div>
    </div>
  );
}
