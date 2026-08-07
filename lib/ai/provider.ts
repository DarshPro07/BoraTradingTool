import type { EvidencePackage } from "./evidence";
import type { ResearchAnalysis } from "./schema";

export interface AiProviderResult {
  analysis: ResearchAnalysis;
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AiProvider {
  readonly id: "anthropic" | "openai" | "fake";
  readonly model: string;
  analyze(input: EvidencePackage, question: string, signal?: AbortSignal): Promise<AiProviderResult>;
}

export const AI_SYSTEM_INSTRUCTION = `You are MarketPulse's evidence reviewer.
Use only the supplied evidence and cite evidence IDs exactly.
If evidence is stale, conflicted, missing, or insufficient, choose ABSTAIN.
Return the requested structured fields only.
This is research analysis, not financial advice, and you have no authority to create or execute an order.`;

export function evidencePrompt(input: EvidencePackage, question: string): string {
  return JSON.stringify({
    task: question || "Evaluate the evidence, downside risk, and invalidation conditions.",
    instrument: input.instrument,
    snapshotHash: input.snapshotHash,
    evidence: input.items,
  });
}

export type AiErrorCode =
  | "AI_PROVIDER_NOT_CONFIGURED"
  | "AI_RATE_LIMITED"
  | "AI_BUSY"
  | "AI_TIMEOUT"
  | "INVALID_MODEL_OUTPUT"
  | "AI_PROVIDER_ERROR";

export class AiServiceError extends Error {
  constructor(readonly code: AiErrorCode, message: string, readonly status: number) {
    super(message);
    this.name = "AiServiceError";
  }
}
