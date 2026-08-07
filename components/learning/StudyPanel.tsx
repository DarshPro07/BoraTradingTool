"use client";

import { useCallback, useEffect, useState } from "react";
import { mutationFetch } from "@/lib/client/mutation-fetch";

/**
 * The study session, and the only thing in the product that writes `knowledge_mastery`.
 *
 * Before this existed the study queue was a list that could never shorten: `nextCurriculum` sorted
 * concepts by mastery, and mastery was permanently zero because nothing ever answered anything. So
 * the panel showed the same ten concepts marked `never studied` on the first load and the
 * thousandth, which looks exactly like a feature that does not work — because it was one.
 *
 * A recall card hides the material until you commit to remembering or not. Revealing first and
 * asking afterwards measures recognition, not recall, and recognition is the thing that feels like
 * knowing while you are forgetting.
 */

interface Card {
  conceptId: string;
  name: string;
  plane: string;
  reason: string;
  mode: "quiz" | "recall";
  question: string | null;
  options: string[] | null;
  summary: string;
  formalDefinition: string | null;
  score: number;
  attempts: number;
  remaining: number;
}

interface Graded {
  correct: boolean;
  expected: string | null;
  explanation: string | null;
  gradedBy: "stored_answer" | "self_report";
  mastery: { attempts: number; score: number; interval: number; nextReviewAt: string };
}

function days(interval: number): string {
  return interval === 1 ? "tomorrow" : `in ${interval} days`;
}

export function StudyPanel() {
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/study", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.message ?? `The study queue returned ${response.status}.`);
        return;
      }
      setCard(body.card as Card | null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The study queue is unreachable.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function grade(payload: { answer: string } | { recalled: boolean }) {
    if (!card || busy) return;
    setBusy(true);
    try {
      const response = await mutationFetch("/api/study", {
        method: "POST",
        body: JSON.stringify({ conceptId: card.conceptId, ...payload }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.message ?? `Grading returned ${response.status}.`);
        return;
      }
      setGraded(body as Graded);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The answer could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  function advance() {
    setGraded(null);
    setRevealed(false);
    void load();
  }

  if (error) {
    return <p className="text-xs text-loss">Study session unavailable — {error}</p>;
  }
  if (card === undefined) {
    return <p className="text-xs text-muted-foreground">loading the next card…</p>;
  }
  if (card === null) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing is due. Every concept has been studied and none has come back around for review yet.
      </p>
    );
  }

  return (
    <div className="border border-panel bg-panel-alt p-3 text-xs space-y-3" data-testid="study-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wider text-amber">{card.plane.replace(/_/g, " ")}</span>
        <span>
          {card.attempts === 0
            ? "never studied"
            : `${card.attempts} attempt(s) · ${Math.round(card.score * 100)}%`}
          {card.remaining > 0 ? ` · ${card.remaining} more queued` : null}
        </span>
      </div>

      <p className="text-sm">{card.question ?? `What is ${card.name}?`}</p>

      {graded === null ? (
        card.mode === "quiz" ? (
          <div className="grid gap-1.5">
            {card.options?.map((option) => (
              <button
                key={option}
                type="button"
                disabled={busy}
                onClick={() => void grade({ answer: option })}
                className="border border-panel px-2 py-1.5 text-left hover:border-amber disabled:opacity-50"
              >
                {option}
              </button>
            ))}
          </div>
        ) : revealed ? (
          <div className="space-y-3">
            <div className="border-l-2 border-amber pl-2 space-y-1 text-muted-foreground">
              <p>{card.summary}</p>
              {card.formalDefinition ? <p className="font-mono text-[11px]">{card.formalDefinition}</p> : null}
            </div>
            {/* Self-report, and labelled as one. The system must not later treat this as though it
                had graded the answer itself. */}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void grade({ recalled: true })}
                className="border border-panel px-3 py-1.5 text-gain hover:border-gain disabled:opacity-50"
              >
                I knew it
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void grade({ recalled: false })}
                className="border border-panel px-3 py-1.5 text-loss hover:border-loss disabled:opacity-50"
              >
                I missed it
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="border border-panel px-3 py-1.5 hover:border-amber"
          >
            Reveal
          </button>
        )
      ) : (
        <div className="space-y-2">
          <p className={graded.correct ? "text-gain" : "text-loss"}>
            {graded.correct ? "Correct." : "Missed."}{" "}
            <span className="text-muted-foreground">
              {graded.gradedBy === "self_report" ? "Recorded from your own report." : "Graded against the stored answer."}
            </span>
          </p>
          {graded.expected && !graded.correct ? (
            <p className="text-muted-foreground">Answer: {graded.expected}</p>
          ) : null}
          {graded.explanation ? <p className="text-muted-foreground">{graded.explanation}</p> : null}
          <p className="text-[10px] text-muted-foreground">
            Mastery {Math.round(graded.mastery.score * 100)}% over {graded.mastery.attempts} attempt(s). Due again{" "}
            {days(graded.mastery.interval)}.
          </p>
          <button type="button" onClick={advance} className="border border-panel px-3 py-1.5 hover:border-amber">
            Next card
          </button>
        </div>
      )}
    </div>
  );
}
