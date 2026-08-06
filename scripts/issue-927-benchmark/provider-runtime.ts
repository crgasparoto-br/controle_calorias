import sharp from "sharp";

import type {
  AiProvider,
  AiProviderAudioTranscriptionRequest,
  AiProviderAudioTranscriptionResponse,
  AiProviderEmbeddingRequest,
  AiProviderEmbeddingResponse,
  AiProviderImageGenerationRequest,
  AiProviderImageGenerationResponse,
  AiProviderRequestOptions,
  AiProviderTextRequest,
  AiProviderTextResponse,
  AiProviderUsage,
} from "../../server/_core/aiProvider";
import {
  AiNonRetryableError,
  AiOperationalError,
  type AiNonRetryableErrorCode,
  type AiOperationalErrorCode,
} from "../../server/_core/ai/policyExecutor";
import type { AiProviderFactoryMap } from "../../server/_core/ai/providerResolver";
import type { MealProcessingResult } from "../../server/nutritionEngine";
import type { WhatsappIntentContext } from "../../server/modules/whatsapp/intentContext";
import type {
  ProviderCall, ProviderId, ProviderOperation, ProviderStep, Scenario, UsageFixture, CheckResult,
} from "./contracts";

function usage(fixture?: UsageFixture): AiProviderUsage | undefined {
  if (!fixture) return undefined;
  return {
    inputTokens: fixture.inputTokens,
    outputTokens: fixture.outputTokens,
    totalTokens: fixture.totalTokens ?? ((fixture.inputTokens ?? 0) + (fixture.outputTokens ?? 0)),
    raw: {},
  };
}

function operationalError(step: ProviderStep): Error {
  const code = step.error?.code ?? "network";
  if (step.error?.retryable === false || [
    "invalid_configuration",
    "authentication",
    "incompatible_operation",
    "model_not_found",
    "safety_block",
  ].includes(code)) {
    return new AiNonRetryableError("Synthetic non-retryable provider failure", undefined, code as AiNonRetryableErrorCode);
  }
  return new AiOperationalError("Synthetic recoverable provider failure", undefined, code as AiOperationalErrorCode);
}

class ScenarioProvider implements AiProvider {
  constructor(
    private readonly providerId: ProviderId,
    private readonly queues: Record<ProviderOperation, ProviderStep[]>,
    private readonly calls: ProviderCall[],
    private readonly concurrency: { current: number; max: number },
  ) {}

  private async consume<T>(
    operation: ProviderOperation,
    model: string,
    map: (step: ProviderStep) => T,
    options?: AiProviderRequestOptions,
  ): Promise<T> {
    if (options?.signal?.aborted) throw new AiOperationalError("Synthetic request aborted", undefined, "timeout");
    const step = this.queues[operation].shift();
    if (!step) throw new Error(`No synthetic ${operation} response remains for provider ${this.providerId}`);
    const startedAt = Date.now();
    this.concurrency.current += 1;
    this.concurrency.max = Math.max(this.concurrency.max, this.concurrency.current);
    let failed = false;
    try {
      if (step.delayMs) await new Promise(resolve => setTimeout(resolve, step.delayMs));
      if (step.error) {
        failed = true;
        throw operationalError(step);
      }
      return map(step);
    } finally {
      this.concurrency.current -= 1;
      this.calls.push({
        provider: this.providerId,
        operation,
        model,
        startedAt,
        endedAt: Date.now(),
        failed,
      });
    }
  }

  createTextResponse(request: AiProviderTextRequest, options?: AiProviderRequestOptions): Promise<AiProviderTextResponse> {
    return this.consume("text", request.model, step => ({
      id: `synthetic-${this.providerId}-${this.calls.length + 1}`,
      outputText: step.result?.json !== undefined
        ? JSON.stringify(step.result.json)
        : (step.result?.text ?? ""),
      usage: usage(step.result?.usage),
      webSearch: step.result?.webSearch,
      raw: {},
    }), options);
  }

  createEmbeddings(request: AiProviderEmbeddingRequest, options?: AiProviderRequestOptions): Promise<AiProviderEmbeddingResponse> {
    return this.consume("embedding", request.model, step => {
      const values = Array.isArray(request.input) ? request.input : [request.input];
      const embeddings = step.result?.mode === "catalog-banana"
        ? values.map(value => String(value).toLowerCase().includes("banana") ? [1, 0, 0] : [0, 1, 0])
        : (step.result?.vectors ?? []);
      return { embeddings, usage: usage(step.result?.usage), raw: {} };
    }, options);
  }

  createAudioTranscription(
    request: AiProviderAudioTranscriptionRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderAudioTranscriptionResponse> {
    return this.consume("audio", request.model, step => ({
      task: "transcribe",
      text: step.result?.text ?? "",
      language: step.result?.language,
      duration: step.result?.duration,
      raw: {},
    }), options);
  }

  createImageGeneration(
    request: AiProviderImageGenerationRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderImageGenerationResponse> {
    return this.consume("image", request.model, step => ({
      b64Json: step.result?.syntheticImage
        ? Buffer.from("synthetic-derived-image").toString("base64")
        : Buffer.from("synthetic-image").toString("base64"),
      mimeType: "image/png",
      raw: {},
    }), options);
  }
}

export function createProviderRuntime(scenario: Scenario) {
  const calls: ProviderCall[] = [];
  const concurrency = { current: 0, max: 0 };
  const queues = (provider: ProviderId): Record<ProviderOperation, ProviderStep[]> => ({
    text: (scenario.providerPlan?.[provider] ?? []).filter(step => step.operation === "text").map(step => structuredClone(step)),
    embedding: (scenario.providerPlan?.[provider] ?? []).filter(step => step.operation === "embedding").map(step => structuredClone(step)),
    audio: (scenario.providerPlan?.[provider] ?? []).filter(step => step.operation === "audio").map(step => structuredClone(step)),
    image: (scenario.providerPlan?.[provider] ?? []).filter(step => step.operation === "image").map(step => structuredClone(step)),
  });
  const providers: Record<ProviderId, ScenarioProvider> = {
    openai: new ScenarioProvider("openai", queues("openai"), calls, concurrency),
    "openai-compatible": new ScenarioProvider("openai-compatible", queues("openai-compatible"), calls, concurrency),
    gemini: new ScenarioProvider("gemini", queues("gemini"), calls, concurrency),
  };
  const factories: AiProviderFactoryMap = {
    openai: () => providers.openai,
    "openai-compatible": () => providers["openai-compatible"],
    gemini: () => providers.gemini,
  };
  return { calls, concurrency, factories };
}

export function baseEnvironment(scenario: Scenario): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    ALLOW_MEMORY_PERSISTENCE: "true",
    PROFESSIONAL_ACCESS_RECEIPT_STORAGE: "memory",
    OPENAI_API_KEY: "synthetic-openai-credential",
    GEMINI_API_KEY: "synthetic-gemini-credential",
    AI_MEAL_TEXT_PROVIDER: "openai",
    AI_MEAL_TEXT_MODEL: "gpt-4.1-mini",
    AI_MEAL_TEXT_MAX_ATTEMPTS: "1",
    AI_MEAL_TEXT_FALLBACK_ENABLED: "false",
    AI_MEAL_VISION_PROVIDER: "openai",
    AI_MEAL_VISION_MODEL: "gpt-4.1-mini",
    AI_MEAL_VISION_MAX_ATTEMPTS: "1",
    AI_MEAL_VISION_FALLBACK_ENABLED: "false",
    AI_WHATSAPP_INTENT_PROVIDER: "openai",
    AI_WHATSAPP_INTENT_MODEL: "gpt-4.1-mini",
    AI_WHATSAPP_INTENT_MAX_ATTEMPTS: "1",
    AI_WHATSAPP_INTENT_FALLBACK_ENABLED: "false",
    OPENAI_WHATSAPP_INTENT_ENABLED: "true",
    AI_QUESTION_PROVIDER: "openai",
    AI_QUESTION_MODEL: "gpt-4.1-mini",
    AI_QUESTION_MAX_ATTEMPTS: "1",
    AI_QUESTION_FALLBACK_ENABLED: "false",
    AI_QUESTION_WEB_SEARCH_MODE: "auto",
    AI_NUTRITION_SEARCH_PROVIDER: "openai",
    AI_NUTRITION_SEARCH_MODEL: "gpt-4.1-mini",
    AI_NUTRITION_SEARCH_MAX_ATTEMPTS: "1",
    AI_NUTRITION_SEARCH_FALLBACK_ENABLED: "false",
    AI_EMBEDDING_PROVIDER: "openai",
    AI_EMBEDDING_MODEL: "text-embedding-3-small",
    AI_EMBEDDING_MAX_ATTEMPTS: "1",
    AI_EMBEDDING_FALLBACK_ENABLED: "false",
    AI_TRANSCRIPTION_PROVIDER: "openai",
    AI_TRANSCRIPTION_MODEL: "whisper-1",
    AI_TRANSCRIPTION_MAX_ATTEMPTS: "1",
    AI_TRANSCRIPTION_FALLBACK_ENABLED: "false",
    AI_IMAGE_ANNOTATION_PROVIDER: "openai",
    AI_IMAGE_ANNOTATION_MODEL: "gpt-image-1",
    AI_IMAGE_ANNOTATION_MAX_ATTEMPTS: "1",
    AI_IMAGE_ANNOTATION_FALLBACK_ENABLED: "false",
    ...scenario.env,
  };
  return env;
}

export function intentContext(scenario: Scenario): WhatsappIntentContext {
  return {
    version: "whatsapp-intent-context/v2",
    nowIso: "2026-08-06T12:00:00.000Z",
    timezone: "America/Sao_Paulo",
    mealAliases: {},
    currentDomainSnapshot: {
      latestMeal: null,
      mealsToday: [],
      recentFoodNames: [],
    },
    contextualMemories: [],
    pendingClarification: (scenario.input.pendingClarification as WhatsappIntentContext["pendingClarification"] | undefined) ?? null,
    recentTurns: [],
    conversationSummary: null,
    conversationActive: true,
    truncated: false,
    contextRead: {
      mode: "legacy",
      flow: "text",
      source: "legacy",
      persistentEligible: false,
      equivalent: null,
      legacyCount: 0,
      persistentCount: 0,
    },
  };
}

export async function syntheticPhotoDataUrl(): Promise<string> {
  const buffer = await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 238, g: 238, b: 238 },
    },
  }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export function processedMeal(): MealProcessingResult {
  return {
    detectedMealLabel: "Almoço",
    sourceText: "fixture sintética",
    confidence: 0.95,
    needsConfirmation: false,
    reasoning: "Fixture sintética.",
    items: [{
      foodName: "Arroz",
      canonicalName: "Arroz branco",
      brand: null,
      quantity: 100,
      unit: "g",
      portionText: "100 g",
      servings: 1,
      estimatedGrams: 100,
      calories: 130,
      protein: 2.7,
      carbs: 28,
      fat: 0.3,
      confidence: 0.95,
      source: "catalog",
      classification: {
        processingLevel: "natural_or_minimally_processed",
        isFruit: false,
        isVegetable: false,
        fiberGrams: 0.4,
      },
    }],
    totals: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  };
}
