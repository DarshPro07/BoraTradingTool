import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { EvidencePackage } from "../evidence";
import { ResearchAnalysisSchema } from "../schema";
import { AI_SYSTEM_INSTRUCTION, evidencePrompt, type AiProvider, type AiProviderResult } from "../provider";

export class OpenAiProvider implements AiProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1, logLevel: "error" });
  }

  async analyze(input: EvidencePackage, question: string, signal?: AbortSignal): Promise<AiProviderResult> {
    const response = await this.client.responses.parse(
      {
        model: this.model,
        instructions: AI_SYSTEM_INSTRUCTION,
        input: evidencePrompt(input, question),
        max_output_tokens: 1_800,
        text: { format: zodTextFormat(ResearchAnalysisSchema, "marketpulse_research_analysis") },
      },
      { signal, timeout: 30_000, maxRetries: 1 },
    );
    return {
      analysis: ResearchAnalysisSchema.parse(response.output_parsed),
      requestId: response._request_id ?? null,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    };
  }
}
