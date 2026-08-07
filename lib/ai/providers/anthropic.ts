import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { z } from "zod";
import type { EvidencePackage } from "../evidence";
import { ResearchAnalysisSchema } from "../schema";
import { AI_SYSTEM_INSTRUCTION, evidencePrompt, type AiProvider, type AiProviderResult } from "../provider";

export class AnthropicAiProvider implements AiProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  }

  async analyze(input: EvidencePackage, question: string, signal?: AbortSignal): Promise<AiProviderResult> {
    const outputSchema = z.toJSONSchema(ResearchAnalysisSchema) as unknown as Parameters<
      typeof jsonSchemaOutputFormat
    >[0];
    const message = await this.client.messages.parse(
      {
        model: this.model,
        max_tokens: 1_800,
        system: AI_SYSTEM_INSTRUCTION,
        messages: [{ role: "user", content: evidencePrompt(input, question) }],
        output_config: {
          format: jsonSchemaOutputFormat(outputSchema),
        },
      },
      { signal, timeout: 30_000, maxRetries: 1 },
    );
    return {
      analysis: ResearchAnalysisSchema.parse(message.parsed_output),
      requestId: message._request_id ?? null,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  }
}
