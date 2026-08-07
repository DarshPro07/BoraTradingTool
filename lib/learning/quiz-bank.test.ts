import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb, schema } from "@/lib/db";
import { useTemporaryDatabase } from "@/lib/db/testing";
import { QUIZ_BANK, seedQuizBank } from "./quiz-bank";
import { gradeStudyAnswer, nextStudyCard } from "./study";

/**
 * The quiz bank is authored content, so the tests that matter are about the *writer* — whether it
 * is idempotent, whether it produces gradeable cards, and whether an owner's hand edit survives
 * the next cycle. The correctness of any individual answer is a fact about `QUIZ_BANK`, not
 * something a test can establish.
 */

useTemporaryDatabase();

describe("seeding", () => {
  it("writes a concept and a graded question for every entry", () => {
    const report = seedQuizBank();
    expect(report.quizzesWritten).toBe(QUIZ_BANK.length);
    expect(getDb().select().from(schema.knowledgeQuizzes).all()).toHaveLength(QUIZ_BANK.length);
    expect(getDb().select().from(schema.knowledgeConcepts).all().length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent, so running it every cycle costs nothing", () => {
    seedQuizBank();
    const second = seedQuizBank();
    expect(second.quizzesWritten).toBe(0);
    expect(second.alreadyPresent).toBe(QUIZ_BANK.length);
    expect(getDb().select().from(schema.knowledgeQuizzes).all()).toHaveLength(QUIZ_BANK.length);
  });

  it("never overwrites a question that has been edited by hand", () => {
    seedQuizBank();
    const first = getDb().select().from(schema.knowledgeQuizzes).all()[0];
    getDb()
      .update(schema.knowledgeQuizzes)
      .set({ question: "Edited by the owner." })
      .where(eq(schema.knowledgeQuizzes.id, first.id))
      .run();

    seedQuizBank();
    const after = getDb().select().from(schema.knowledgeQuizzes).all().find((row) => row.id === first.id);
    // Reverting an owner's edit fifteen minutes after they made it is how a system teaches
    // someone that editing it is pointless.
    expect(after?.question).toBe("Edited by the owner.");
  });
});

describe("the bank produces gradeable cards", () => {
  it("turns the study queue from recall-only into a real quiz", () => {
    // Before the bank existed, `nextStudyCard` always returned `recall`: the owner self-reported
    // against material they had just read, which measures recognition, not recall.
    expect(nextStudyCard()).toBeNull();
    seedQuizBank();

    const card = nextStudyCard();
    expect(card).not.toBeNull();
    expect(card!.mode).toBe("quiz");
    expect(card!.options?.length).toBe(4);
  });

  it("never ships the answer to the browser with the question", () => {
    seedQuizBank();
    const card = nextStudyCard();
    const keys = Object.keys(card ?? {});
    expect(keys).not.toContain("answer");
    expect(keys).not.toContain("explanation");
  });

  it("grades a correct answer against the stored one", () => {
    seedQuizBank();
    const card = nextStudyCard()!;
    const stored = getDb()
      .select()
      .from(schema.knowledgeQuizzes)
      .all()
      .find((row) => row.conceptId === card.conceptId)!;

    const outcome = gradeStudyAnswer({ conceptId: card.conceptId, answer: stored.answer });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.correct).toBe(true);
    // Graded, not self-reported — the whole point of the bank.
    expect(outcome.result.gradedBy).toBe("stored_answer");
  });

  it("marks a wrong option wrong and collapses the review interval", () => {
    seedQuizBank();
    const card = nextStudyCard()!;
    const stored = getDb()
      .select()
      .from(schema.knowledgeQuizzes)
      .all()
      .find((row) => row.conceptId === card.conceptId)!;
    const wrong = (JSON.parse(stored.options!) as string[]).find((option) => option !== stored.answer)!;

    const outcome = gradeStudyAnswer({ conceptId: card.conceptId, answer: wrong });
    expect(outcome.ok && outcome.result.correct).toBe(false);
    if (!outcome.ok) return;
    expect(outcome.result.mastery.interval).toBe(1);
  });
});

describe("bank content invariants", () => {
  it("carries a citation on every entry, so a disputed answer can be settled", () => {
    for (const seed of QUIZ_BANK) {
      expect(seed.citation.length).toBeGreaterThan(10);
    }
  });

  it("has four distinct options per question", () => {
    for (const seed of QUIZ_BANK) {
      expect(new Set(seed.options).size).toBe(4);
    }
  });

  it("stores the answer as one of the offered options", () => {
    // A stored answer absent from the options is ungradeable — every attempt would be wrong, and
    // mastery would fall for a concept the owner understands.
    seedQuizBank();
    for (const row of getDb().select().from(schema.knowledgeQuizzes).all()) {
      expect(JSON.parse(row.options!) as string[]).toContain(row.answer);
    }
  });

  it("does not leave the answer on the first option of every card", () => {
    // Position zero every time is a pattern a person learns instead of the material.
    seedQuizBank();
    const rows = getDb().select().from(schema.knowledgeQuizzes).all();
    const firstIsAnswer = rows.filter((row) => (JSON.parse(row.options!) as string[])[0] === row.answer);
    expect(firstIsAnswer.length).toBeLessThan(rows.length);
  });
});
