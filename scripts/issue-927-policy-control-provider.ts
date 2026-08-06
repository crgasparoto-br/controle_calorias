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
} from "../server/_core/aiProvider";
import { AiOperationalError } from "../server/_core/ai/policyExecutor";
import type { AiProviderFactoryMap } from "../server/_core/ai/providerResolver";
import type {
  Issue927ControlFamily,
  Issue927ExternalCapability,
  Operation,
  Profile,
  ProviderId,
} from "./issue-927-policy-control-contract";

export type PolicyCall = { provider: ProviderId; model: string; failed: boolean };
type PlannedOutcome = "network" | "success";

class ControlProvider implements AiProvider {
  constructor(
    private readonly providerId: ProviderId,
    private readonly queue: PlannedOutcome[],
    private readonly calls: PolicyCall[],
    private readonly concurrency: { current: number; max: number },
  ) {}

  private async consume<T>(model: string, value: T): Promise<T> {
    const outcome = this.queue.shift();
    if (!outcome) throw new Error(`Missing policy-control outcome for ${this.providerId}`);
    this.concurrency.current += 1;
    this.concurrency.max = Math.max(this.concurrency.max, this.concurrency.current);
    const failed = outcome === "network";
    try {
      if (failed) throw new AiOperationalError("Synthetic recoverable failure", undefined, "network");
      return value;
    } finally {
      this.calls.push({ provider: this.providerId, model, failed });
      this.concurrency.current -= 1;
    }
  }

  createTextResponse(
    request: AiProviderTextRequest,
    _options?: AiProviderRequestOptions,
  ): Promise<AiProviderTextResponse> {
    return this.consume(request.model, { id: `control-${this.providerId}`, outputText: "{}", raw: {} });
  }

  createEmbeddings(
    request: AiProviderEmbeddingRequest,
    _options?: AiProviderRequestOptions,
  ): Promise<AiProviderEmbeddingResponse> {
    return this.consume(request.model, { embeddings: [[1, 0]], raw: {} });
  }

  createAudioTranscription(
    request: AiProviderAudioTranscriptionRequest,
    _options?: AiProviderRequestOptions,
  ): Promise<AiProviderAudioTranscriptionResponse> {
    return this.consume(request.model, { task: "transcribe", text: "fixture", raw: {} });
  }

  createImageGeneration(
    request: AiProviderImageGenerationRequest,
    _options?: AiProviderRequestOptions,
  ): Promise<AiProviderImageGenerationResponse> {
    return this.consume(request.model, {
      b64Json: Buffer.from("control-image").toString("base64"),
      mimeType: "image/png",
      raw: {},
    });
  }
}

export function environmentForControl(
  capability: Issue927ExternalCapability,
  profile: Profile,
  family: Issue927ControlFamily,
): NodeJS.ProcessEnv {
  const prefix = `AI_${capability}`;
  return {
    NODE_ENV: family === "cross-provider-blocked" ? "production" : "test",
    OPENAI_API_KEY: "synthetic-openai-policy-key",
    GEMINI_API_KEY: "synthetic-gemini-policy-key",
    AI_OPENAI_COMPATIBLE_OPERATIONS: profile.compatibleOperations ?? "",
    AI_OPENAI_COMPATIBLE_IMAGE_MODELS: profile.compatibleImageModels ?? "",
    [`${prefix}_PROVIDER`]: profile.primaryProvider,
    [`${prefix}_MODEL`]: profile.primaryModel,
    [`${prefix}_MAX_ATTEMPTS`]: family === "retry" ? "2" : "1",
    [`${prefix}_FALLBACK_ENABLED`]:
      family === "same-provider-fallback" || family === "cross-provider-blocked" ? "true" : "false",
    [`${prefix}_FALLBACK_PROVIDER`]:
      family === "same-provider-fallback" ? profile.primaryProvider : profile.fallbackProvider,
    [`${prefix}_FALLBACK_MODEL`]:
      family === "same-provider-fallback" ? profile.primaryModel : profile.fallbackModel,
    [`${prefix}_CROSS_PROVIDER_FALLBACK_ENABLED`]:
      family === "cross-provider-blocked" ? "true" : "false",
  };
}

function plannedQueues(
  profile: Profile,
  family: Issue927ControlFamily,
): Record<ProviderId, PlannedOutcome[]> {
  const queues: Record<ProviderId, PlannedOutcome[]> = {
    openai: [],
    "openai-compatible": [],
    gemini: [],
  };
  if (family === "retry" || family === "same-provider-fallback") {
    queues[profile.primaryProvider] = ["network", "success"];
  } else {
    queues[profile.primaryProvider] = ["network"];
    queues[profile.fallbackProvider] = ["success"];
  }
  return queues;
}

export function createControlProviders(profile: Profile, family: Issue927ControlFamily) {
  const queues = plannedQueues(profile, family);
  const calls: PolicyCall[] = [];
  const concurrency = { current: 0, max: 0 };
  const providers: Record<ProviderId, ControlProvider> = {
    openai: new ControlProvider("openai", queues.openai, calls, concurrency),
    "openai-compatible": new ControlProvider(
      "openai-compatible",
      queues["openai-compatible"],
      calls,
      concurrency,
    ),
    gemini: new ControlProvider("gemini", queues.gemini, calls, concurrency),
  };
  const providerFactories: AiProviderFactoryMap = {
    openai: () => providers.openai,
    "openai-compatible": () => providers["openai-compatible"],
    gemini: () => providers.gemini,
  };
  return { calls, concurrency, providerFactories };
}

export async function invokeControlOperation(
  operation: Operation,
  context: {
    provider: AiProvider;
    model: string;
    signal: AbortSignal;
  },
): Promise<unknown> {
  const options = { signal: context.signal };
  if (operation === "text") {
    return context.provider.createTextResponse({ model: context.model, input: "synthetic policy control" }, options);
  }
  if (operation === "embedding") {
    return context.provider.createEmbeddings({ model: context.model, input: "synthetic policy control" }, options);
  }
  if (operation === "audio") {
    return context.provider.createAudioTranscription({
      model: context.model,
      file: new File(["fixture"], "control.ogg", { type: "audio/ogg" }),
    }, options);
  }
  return context.provider.createImageGeneration({ model: context.model, prompt: "synthetic policy control" }, options);
}
