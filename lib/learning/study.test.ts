import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { gradeStudyAnswer, nextStudyCard } from "./study";

useTemporaryDatabase();

function concept(id: string, name = id): void {
  getDb()
    .insert(schema.knowledgeConcepts)
    .values({
      id,
      plane: "market_microstructure",
      name,
      summary: `${name} summarised.`,
      formalDefinition: null,
      createdAt: new Date(),
    })
    .run();
}

function quiz(conceptId: string, options: string[] | null, answer: string): void {
  getDb()
    .insert(schema.knowledgeQuizzes)
    .values({
      id: `quiz_${conceptId}`,
      conceptId,
      question: `What is ${conceptId}?`,
      options: options ? JSON.stringify(options) : null,
      answer,
      explanation: "Because that is what it is.",
      createdAt: new Date(),
    })
    .run();
}

describe("the study card", () => {
  it("returns null when nothing is due, rather than a blank card", () => {
    // An empty card object renders as an empty question, which reads as a broken screen. "Nothing
    // due" and "something went wrong" must not look alike.
    expect(nextStudyCard()).toBeNull();
  });

  it("never marks which option is correct", () => {
    // The card is serialised straight to the browser. Carrying `answer` or `explanation` on it
    // would make the quiz a reading exercise for anyone who opens the network tab.
    concept("spread");
    quiz("spread", ["ask minus bid", "bid minus ask"], "ask minus bid");
    const card = nextStudyCard();
    expect(card?.options).toEqual(["ask minus bid", "bid minus ask"]);
    const keys = Object.keys(card ?? {});
    expect(keys).not.toContain("answer");
    expect(keys).not.toContain("explanation");
  });

  it("treats a question with no options as recall, not as a gradeable quiz", () => {
    // Free-text answers are not auto-graded: string matching would mark a correct paraphrase
    // wrong and drive down the same score the curriculum sorts on.
    concept("slippage");
    quiz("slippage", null, "the gap between expected and filled price");
    expect(nextStudyCard()?.mode).toBe("recall");
  });

  it("reports how many concepts are waiting behind this one", () => {
    concept("a");
    concept("b");
    concept("c");
    expect(nextStudyCard()?.remaining).toBe(2);
  });
});

describe("grading", () => {
  it("records a correct multiple-choice answer and lengthens the interval", () => {
    concept("spread");
    quiz("spread", ["ask minus bid", "bid minus ask"], "ask minus bid");
    const outcome = gradeStudyAnswer({ conceptId: "spread", answer: "ask minus bid" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.correct).toBe(true);
    expect(outcome.result.gradedBy).toBe("stored_answer");
    expect(outcome.result.mastery.attempts).toBe(1);
    expect(outcome.result.mastery.score).toBe(1);
  });

  it("collapses the interval to one day on a miss, so a misunderstanding resurfaces", () => {
    concept("spread");
    quiz("spread", ["ask minus bid", "bid minus ask"], "ask minus bid");
    const outcome = gradeStudyAnswer({ conceptId: "spread", answer: "bid minus ask" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.correct).toBe(false);
    expect(outcome.result.mastery.interval).toBe(1);
    expect(outcome.result.expected).toBe("ask minus bid");
  });

  it("ignores case and spacing but not meaning", () => {
    concept("spread");
    quiz("spread", ["Ask Minus Bid", "bid minus ask"], "Ask Minus Bid");
    const outcome = gradeStudyAnswer({ conceptId: "spread", answer: "  ask   minus bid " });
    expect(outcome.ok && outcome.result.correct).toBe(true);
  });

  it("records a self-report and labels it as one", () => {
    concept("slippage");
    const outcome = gradeStudyAnswer({ conceptId: "slippage", recalled: true });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // The distinction matters: mastery built from self-report is weaker evidence than mastery
    // graded against a stored answer, and the two must stay tellable apart.
    expect(outcome.result.gradedBy).toBe("self_report");
    expect(outcome.result.mastery.correct).toBe(1);
  });

  it("refuses an answer for a concept with no multiple-choice question", () => {
    concept("slippage");
    quiz("slippage", null, "the gap between expected and filled price");
    expect(gradeStudyAnswer({ conceptId: "slippage", answer: "anything" })).toEqual({
      ok: false,
      error: "NOT_GRADEABLE",
    });
  });

  it("refuses an unknown concept rather than creating orphan mastery", () => {
    // A mastery row for a concept that does not exist can never be surfaced again by
    // `nextCurriculum`, so it would be permanently counted and permanently invisible.
    expect(gradeStudyAnswer({ conceptId: "ghost", recalled: true })).toEqual({
      ok: false,
      error: "UNKNOWN_CONCEPT",
    });
    expect(getDb().select().from(schema.knowledgeMastery).all()).toHaveLength(0);
  });

  it("refuses a call that supplies neither an answer nor a self-report", () => {
    concept("spread");
    expect(gradeStudyAnswer({ conceptId: "spread" })).toEqual({ ok: false, error: "NO_GRADE_SUPPLIED" });
  });

  it("removes a studied concept from the head of the queue", () => {
    // The behaviour the whole feature exists for: before this producer, mastery was never written,
    // so the queue returned the same head forever and looked broken.
    concept("spread");
    concept("slippage");
    const before = nextStudyCard();
    expect(before).not.toBeNull();
    gradeStudyAnswer({ conceptId: before!.conceptId, recalled: true });
    expect(nextStudyCard()?.conceptId).not.toBe(before!.conceptId);
  });
});
