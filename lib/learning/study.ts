import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { nextCurriculum, recordQuizResult, type MasteryUpdate } from "./curriculum";

/**
 * The study session — the producer `recordQuizResult` never had.
 *
 * `nextCurriculum` computed what to study next and `recordQuizResult` knew how to update mastery,
 * but nothing in production connected them. So `knowledge_mastery` stayed empty, every concept
 * reported `never_studied` forever, and the study queue on `/learning` rendered an identical list
 * on every load no matter how long the system ran. Spaced repetition with no producer is not a
 * slow learner; it is a scheduler nobody ever answers.
 *
 * ## Two card kinds, deliberately distinguished
 *
 * A `quiz` card has a stored question *with options*, so the answer is graded here on the server
 * against `knowledge_quizzes.answer`. A `recall` card has no gradeable question: the material is
 * shown, the owner grades themselves, and mastery moves on that self-report.
 *
 * They are named apart rather than blended because they are not equally strong evidence. Free-text
 * answers are deliberately *not* auto-graded — string matching would mark "the ratio of excess
 * return to volatility" wrong against "excess return over standard deviation" and drive mastery
 * down for an answer that was right. A wrong grade is worse than an honest self-report, because it
 * feeds the same `score` column the curriculum sorts on.
 */

export type StudyCardMode = "quiz" | "recall";

export interface StudyCard {
  conceptId: string;
  name: string;
  plane: string;
  reason: string;
  mode: StudyCardMode;
  /** Present on both kinds; on a recall card it is a prompt, not a graded question. */
  question: string | null;
  /** Non-null only for `quiz`. The stored answer is never among the fields sent to the client. */
  options: string[] | null;
  summary: string;
  formalDefinition: string | null;
  quizId: string | null;
  score: number;
  attempts: number;
  /** How many concepts are waiting behind this one. */
  remaining: number;
}

function parseOptions(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const options = parsed.map(String).filter((option) => option.trim().length > 0);
    // A single option is not a choice, and zero is not a question.
    return options.length >= 2 ? options : null;
  } catch {
    return null;
  }
}

export function nextStudyCard(now = new Date()): StudyCard | null {
  const queue = nextCurriculum(undefined, 25, now);
  const head = queue[0];
  if (!head) return null;

  const db = getDb();
  const concept = db
    .select()
    .from(schema.knowledgeConcepts)
    .where(eq(schema.knowledgeConcepts.id, head.conceptId))
    .get();
  if (!concept) return null;

  const quiz = db
    .select()
    .from(schema.knowledgeQuizzes)
    .where(eq(schema.knowledgeQuizzes.conceptId, head.conceptId))
    .get();

  const options = parseOptions(quiz?.options ?? null);

  return {
    conceptId: head.conceptId,
    name: concept.name,
    plane: concept.plane,
    reason: head.reason,
    mode: options ? "quiz" : "recall",
    question: quiz?.question ?? null,
    options,
    summary: concept.summary,
    formalDefinition: concept.formalDefinition,
    quizId: quiz?.id ?? null,
    score: head.score,
    attempts: head.attempts,
    remaining: Math.max(0, queue.length - 1),
  };
}

export interface GradeInput {
  conceptId: string;
  /** Set for a `quiz` card: the option the owner chose. */
  answer?: string;
  /** Set for a `recall` card: whether they knew it. */
  recalled?: boolean;
}

export interface GradeResult {
  correct: boolean;
  /** What the stored answer was. Returned only after grading, never with the question. */
  expected: string | null;
  explanation: string | null;
  gradedBy: "stored_answer" | "self_report";
  mastery: MasteryUpdate;
}

export type GradeFailure = { ok: false; error: "UNKNOWN_CONCEPT" | "NO_GRADE_SUPPLIED" | "NOT_GRADEABLE" };
export type GradeSuccess = { ok: true; result: GradeResult };

export function gradeStudyAnswer(input: GradeInput, now = new Date()): GradeSuccess | GradeFailure {
  const db = getDb();
  const concept = db
    .select()
    .from(schema.knowledgeConcepts)
    .where(eq(schema.knowledgeConcepts.id, input.conceptId))
    .get();
  // Recording mastery for a concept that does not exist would leave an orphan row that
  // `nextCurriculum` can never surface again — invisible, and permanently counted.
  if (!concept) return { ok: false, error: "UNKNOWN_CONCEPT" };

  const quiz = db
    .select()
    .from(schema.knowledgeQuizzes)
    .where(eq(schema.knowledgeQuizzes.conceptId, input.conceptId))
    .get();
  const options = parseOptions(quiz?.options ?? null);

  if (typeof input.answer === "string") {
    if (!quiz || !options) return { ok: false, error: "NOT_GRADEABLE" };
    // Compared case- and whitespace-insensitively against the stored answer, and only ever
    // against one of the offered options. Anything looser is guessing at intent.
    const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
    const correct = normalise(input.answer) === normalise(quiz.answer);
    return {
      ok: true,
      result: {
        correct,
        expected: quiz.answer,
        explanation: quiz.explanation,
        gradedBy: "stored_answer",
        mastery: recordQuizResult(input.conceptId, correct, now),
      },
    };
  }

  if (typeof input.recalled === "boolean") {
    return {
      ok: true,
      result: {
        correct: input.recalled,
        expected: quiz?.answer ?? null,
        explanation: quiz?.explanation ?? null,
        gradedBy: "self_report",
        mastery: recordQuizResult(input.conceptId, input.recalled, now),
      },
    };
  }

  return { ok: false, error: "NO_GRADE_SUPPLIED" };
}
