import { getDb, schema } from "@/lib/db";
import { buildResearchSnapshot } from "@/lib/market/service";
import { parseInstrument } from "@/lib/market/instruments";
import { buildEvidencePackage, assertValidCitations, AiOutputError } from "./evidence";
import { persistEvidencePackage } from "./evidence-store";
import type { AiProvider } from "./provider";
import { AiServiceError } from "./provider";
import { ResearchAnalysisSchema, type AiAnalysisRequest } from "./schema";
import { AnthropicAiProvider } from "./providers/anthropic";
import { OpenAiProvider } from "./providers/openai";
import { FakeAiProvider } from "./providers/fake";

const activeProviders = new Set<string>();
const recentRequests = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1_000;
const MAX_REQUESTS_PER_WINDOW = 10;

export function getAiStatus() {
  return {
    providers: [
      {
        id: "anthropic" as const,
        configured: process.env.MARKETPULSE_TEST_MODE === "1" || !!process.env.ANTHROPIC_API_KEY?.trim(),
        model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5",
      },
      {
        id: "openai" as const,
        configured: process.env.MARKETPULSE_TEST_MODE === "1" || !!process.env.OPENAI_API_KEY?.trim(),
        model: process.env.OPENAI_MODEL?.trim() || "gpt-5.5",
      },
    ],
    advisoryOnly: true,
    orderCapability: false,
  };
}

function createProvider(id: "anthropic" | "openai"): AiProvider {
  if (process.env.MARKETPULSE_TEST_MODE === "1") return new FakeAiProvider(id);
  if (id === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) throw new AiServiceError("AI_PROVIDER_NOT_CONFIGURED", "Anthropic is not configured.", 503);
    return new AnthropicAiProvider(key, process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5");
  }
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new AiServiceError("AI_PROVIDER_NOT_CONFIGURED", "OpenAI is not configured.", 503);
  return new OpenAiProvider(key, process.env.OPENAI_MODEL?.trim() || "gpt-5.5");
}

function enforceRateLimit(provider: string): void {
  const now = Date.now();
  const recent = (recentRequests.get(provider) ?? []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    throw new AiServiceError("AI_RATE_LIMITED", "Local AI request limit reached. Try again later.", 429);
  }
  recent.push(now);
  recentRequests.set(provider, recent);
}

function errorCode(error: unknown): string {
  if (error instanceof AiServiceError || error instanceof AiOutputError) return error.code;
  if (error instanceof Error && (error.name === "AbortError" || /timeout/i.test(error.message))) return "AI_TIMEOUT";
  return "AI_PROVIDER_ERROR";
}

export async function analyzeInstrument(request: AiAnalysisRequest) {
  enforceRateLimit(request.provider);
  if (activeProviders.has(request.provider)) {
    throw new AiServiceError("AI_BUSY", `${request.provider} already has an analysis in progress.`, 409);
  }
  activeProviders.add(request.provider);
  const startedAt = new Date();
  let snapshotHash = "unavailable";
  let evidenceJson: string | null = null;
  let model = "unavailable";
  try {
    const instrument = parseInstrument(request.instrumentId);
    const snapshot = await buildResearchSnapshot(instrument);
    const evidence = buildEvidencePackage(snapshot);
    persistEvidencePackage(evidence);
    evidenceJson = JSON.stringify(evidence);
    snapshotHash = evidence.snapshotHash;
    const provider = createProvider(request.provider);
    model = provider.model;
    const result = await provider.analyze(evidence, request.question, AbortSignal.timeout(30_000));
    const analysis = ResearchAnalysisSchema.parse(result.analysis);
    assertValidCitations(analysis, evidence);
    const completedAt = new Date();
    const inserted = getDb().insert(schema.aiRuns).values({
      instrumentId: instrument.id,
      provider: request.provider,
      model,
      purpose: request.purpose,
      question: request.question || null,
      snapshotHash,
      evidenceJson,
      resultJson: JSON.stringify(analysis),
      status: "COMPLETED",
      errorCode: null,
      providerRequestId: result.requestId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      startedAt,
      completedAt,
    }).run();
    return {
      id: Number(inserted.lastInsertRowid),
      provider: request.provider,
      model,
      instrument,
      snapshotHash,
      evidence: evidence.items,
      analysis,
      generatedAt: completedAt.toISOString(),
    };
  } catch (error) {
    const code = errorCode(error);
    try {
      getDb().insert(schema.aiRuns).values({
        instrumentId: request.instrumentId,
        provider: request.provider,
        model,
        purpose: request.purpose,
        question: request.question || null,
        snapshotHash,
        evidenceJson,
        resultJson: null,
        status: "FAILED",
        errorCode: code,
        providerRequestId: null,
        inputTokens: null,
        outputTokens: null,
        startedAt,
        completedAt: new Date(),
      }).run();
    } catch {
      // The safe user-facing error is more important than secondary audit failure.
    }
    if (error instanceof AiServiceError) throw error;
    if (error instanceof AiOutputError) throw new AiServiceError(error.code, error.message, 502);
    if (code === "AI_TIMEOUT") throw new AiServiceError("AI_TIMEOUT", "The model provider timed out.", 504);
    throw new AiServiceError("AI_PROVIDER_ERROR", "The model provider could not complete the analysis.", 502);
  } finally {
    activeProviders.delete(request.provider);
  }
}
