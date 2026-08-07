"use client";

import { useState } from "react";
import { mutationFetch } from "@/lib/client/mutation-fetch";

/**
 * The only way to put work into the research queue from the application.
 *
 * `POST /api/research/jobs` has existed since the queue was built and had zero callers anywhere in
 * the app, so `research_jobs` was permanently empty and every cycle honestly reported "Processed 0
 * job(s)". The worker was not broken and the loop was not stalled — the intake simply had no door.
 *
 * ## Why this asks for content rather than a URL to go fetch
 *
 * `ingestSource` refuses to invent claims from raw text, and there is no model inside this
 * application to read a page. A URL-only form would enqueue a job the worker cannot complete: it
 * would fail three times, land in failure memory, and look like a bug in the queue rather than a
 * capability the system was never given. Paste the material and it is archived with provenance;
 * the claims and hypotheses come later, from Claude, through the MCP write tools.
 */

const KINDS = [
  { value: "ingest_paper", label: "paper" },
  { value: "ingest_video", label: "video / transcript" },
  { value: "ingest_repository", label: "repository" },
  { value: "ingest_web", label: "web page" },
] as const;

export function ResearchIntake() {
  const [kind, setKind] = useState<string>("ingest_web");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const ready = title.trim().length > 0 && content.trim().length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      const response = await mutationFetch("/api/research/jobs", {
        method: "POST",
        body: JSON.stringify({
          kind,
          // Deduped on the source itself, so pasting the same paper twice queues one job rather
          // than two identical ones that both archive it.
          dedupeKey: `${kind}:${url.trim() || title.trim()}`.slice(0, 200),
          payload: {
            kind: kind.replace("ingest_", ""),
            title: title.trim(),
            content: content.trim(),
            ...(url.trim() ? { url: url.trim() } : {}),
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setNote({ tone: "bad", text: body?.message ?? `The queue returned ${response.status}.` });
        return;
      }
      setNote(
        body.deduped
          ? { tone: "ok", text: `Already queued as job #${body.id}; nothing was duplicated.` }
          : { tone: "ok", text: `Queued as job #${body.id}. The next learning cycle will archive it.` },
      );
      setTitle("");
      setUrl("");
      setContent("");
    } catch (caught) {
      setNote({ tone: "bad", text: caught instanceof Error ? caught.message : "The queue is unreachable." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 text-xs" data-testid="research-intake">
      <div className="flex flex-wrap gap-2">
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className="border border-panel bg-panel-alt px-2 py-1"
        >
          {KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
          className="flex-1 min-w-[12rem] border border-panel bg-panel-alt px-2 py-1"
        />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Source URL (optional)"
          className="flex-1 min-w-[12rem] border border-panel bg-panel-alt px-2 py-1"
        />
      </div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Paste the abstract, transcript or README. Archived verbatim with a content hash — claims are extracted later by Claude, never guessed here."
        rows={4}
        className="w-full border border-panel bg-panel-alt px-2 py-1 font-mono text-[11px]"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!ready || busy}
          className="border border-panel px-3 py-1.5 hover:border-amber disabled:opacity-40"
        >
          {busy ? "queueing…" : "Queue for ingestion"}
        </button>
        {note ? <span className={note.tone === "ok" ? "text-gain" : "text-loss"}>{note.text}</span> : null}
      </div>
    </form>
  );
}
