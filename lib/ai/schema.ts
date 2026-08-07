import { z } from "zod";

const ShortText = z.string().trim().min(1).max(600);
const EvidenceCitationSchema = z.object({
  evidenceId: z.string().trim().min(1).max(120),
  claim: ShortText,
}).strict();

export const ResearchAnalysisSchema = z.object({
  verdict: z.enum(["BUY", "HOLD", "SELL", "ABSTAIN"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().trim().min(1).max(2_000),
  bullCase: z.array(ShortText).max(8),
  bearCase: z.array(ShortText).max(8),
  risks: z.array(ShortText).max(10),
  invalidationConditions: z.array(ShortText).max(8),
  missingEvidence: z.array(ShortText).max(10),
  citations: z.array(EvidenceCitationSchema).max(20),
  disclaimer: z.string().trim().min(1).max(500),
}).strict().superRefine((analysis, context) => {
  if (analysis.verdict !== "BUY" && analysis.verdict !== "SELL") return;
  if (analysis.citations.length === 0) {
    context.addIssue({ code: "custom", path: ["citations"], message: "Directional output requires evidence citations." });
  }
  if (analysis.invalidationConditions.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["invalidationConditions"],
      message: "Directional output requires at least one invalidation condition.",
    });
  }
});

export type ResearchAnalysis = z.infer<typeof ResearchAnalysisSchema>;

export const AiAnalysisRequestSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  instrumentId: z.string().trim().min(1).max(64),
  purpose: z.enum(["DEEP_DIVE", "THESIS_CHECK", "RISK_REVIEW"]).default("DEEP_DIVE"),
  question: z.string().trim().max(2_000).default(""),
}).strict();

export type AiAnalysisRequest = z.infer<typeof AiAnalysisRequestSchema>;
