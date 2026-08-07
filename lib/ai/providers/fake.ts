import type { AiProvider, AiProviderResult } from "../provider";
import type { EvidencePackage } from "../evidence";

export class FakeAiProvider implements AiProvider {
  readonly model: string;

  constructor(readonly id: "anthropic" | "openai" | "fake" = "fake") {
    this.model = `marketpulse-${id}-fixture`;
  }

  async analyze(input: EvidencePackage): Promise<AiProviderResult> {
    const quality = input.items.find((item) => item.id === "quote")?.quality;
    const abstain = quality === "STALE" || quality === "CONFLICTED" || quality === "UNAVAILABLE";
    return {
      analysis: {
        verdict: abstain ? "ABSTAIN" : "HOLD",
        confidence: abstain ? 0.2 : 0.68,
        summary: abstain
          ? "The available quote is not eligible for a current research conclusion."
          : `${input.instrument.symbol} has mixed evidence and requires confirmation from current fundamentals and price action.`,
        bullCase: ["Price and calculated technical evidence remain constructive."],
        bearCase: ["The evidence does not establish a sufficiently asymmetric entry."],
        risks: ["Market and provider data can be delayed or incomplete."],
        invalidationConditions: ["The technical trend breaks below its identified support."],
        missingEvidence: abstain ? ["A current eligible quote is required."] : [],
        citations: [
          { evidenceId: "quote", claim: "The normalized quote anchors the current-price assessment." },
          { evidenceId: "technical:summary", claim: "Calculated indicators provide the technical context." },
        ],
        disclaimer: "Research simulation only; not financial advice and not an executable order.",
      },
      requestId: `fixture-${input.snapshotHash.slice(0, 12)}`,
      inputTokens: 500,
      outputTokens: 180,
    };
  }
}
