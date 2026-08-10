"use client";

/**
 * The boundary for a failure in the root layout itself.
 *
 * `app/error.tsx` renders *inside* the root layout, so it cannot catch a crash in the layout that
 * would contain it. This one replaces the whole document, which is why it declares its own `html`
 * and `body`.
 *
 * Styled inline rather than with Tailwind classes on purpose: the stylesheet is imported by the
 * root layout, and this component only ever renders when that layout failed. Class names would
 * resolve to nothing and produce unstyled white text on white — a second failure on the screen
 * whose only job is to be legible during the first.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a", color: "#e5e5e5", fontFamily: "ui-monospace, monospace" }}>
        <div style={{ padding: "2rem", maxWidth: "42rem" }}>
          <h1 style={{ fontSize: "0.875rem", letterSpacing: "0.1em", color: "#ef4444", marginBottom: "0.75rem" }}>
            MARKETPULSE FAILED TO START
          </h1>
          <p style={{ fontSize: "0.75rem", lineHeight: 1.6, color: "#a3a3a3" }}>
            The application shell itself failed, so no screen could render. This is a startup or
            layout fault, not a data problem — nothing was written and no decision was recorded.
          </p>
          {error.digest ? (
            <p style={{ fontSize: "0.7rem", color: "#a3a3a3", marginTop: "0.75rem" }}>
              Server log digest <code style={{ border: "1px solid #333", padding: "0.1rem 0.3rem" }}>{error.digest}</code>
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              background: "transparent",
              border: "1px solid #333",
              color: "#e5e5e5",
              padding: "0.35rem 0.7rem",
              fontSize: "0.75rem",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
