import type {
  AiProvider,
  AiProviderAudioTranscriptionResponse,
  AiProviderEmbeddingResponse,
  AiProviderImageGenerationResponse,
  AiProviderTextResponse,
  AiProviderUsage,
} from "../aiProvider";
import { classifyAiError, AiNonRetryableError, AiOperationalError } from "./policyExecutor";

export type AiNormalizedUsage = Omit<AiProviderUsage, "raw"> & {
  cachedInputTokens?: number;
  reasoningTokens?: number;
  audioSeconds?: number;
  inputAudioTokens?: number;
  outputAudioTokens?: number;
  inputImageTokens?: number;
  outputImageTokens?: number;
  generatedImages?: number;
};

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function normalizeProviderUsage(
  usage: AiProviderUsage | undefined,
  extras: { audioSeconds?: number; generatedImages?: number } = {},
): AiNormalizedUsage | undefined {
  const raw = record(usage?.raw);
  const inputDetails = record(raw.input_tokens_details);
  const outputDetails = record(raw.output_tokens_details);
  const normalized: AiNormalizedUsage = {
    ...(finite(usage?.inputTokens) !== undefined ? { inputTokens: finite(usage?.inputTokens) } : {}),
    ...(finite(usage?.outputTokens) !== undefined ? { outputTokens: finite(usage?.outputTokens) } : {}),
    ...(finite(usage?.totalTokens) !== undefined ? { totalTokens: finite(usage?.totalTokens) } : {}),
    ...(finite(raw.cachedContentTokenCount ?? inputDetails.cached_tokens) !== undefined
      ? { cachedInputTokens: finite(raw.cachedContentTokenCount ?? inputDetails.cached_tokens) }
      : {}),
    ...(finite(raw.thoughtsTokenCount ?? outputDetails.reasoning_tokens) !== undefined
      ? { reasoningTokens: finite(raw.thoughtsTokenCount ?? outputDetails.reasoning_tokens) }
      : {}),
    ...(finite(inputDetails.audio_tokens) !== undefined ? { inputAudioTokens: finite(inputDetails.audio_tokens) } : {}),
    ...(finite(outputDetails.audio_tokens) !== undefined ? { outputAudioTokens: finite(outputDetails.audio_tokens) } : {}),
    ...(finite(inputDetails.image_tokens) !== undefined ? { inputImageTokens: finite(inputDetails.image_tokens) } : {}),
    ...(finite(outputDetails.image_tokens) !== undefined ? { outputImageTokens: finite(outputDetails.image_tokens) } : {}),
    ...(finite(extras.audioSeconds) !== undefined ? { audioSeconds: finite(extras.audioSeconds) } : {}),
    ...(finite(extras.generatedImages) !== undefined ? { generatedImages: finite(extras.generatedImages) } : {}),
  };
  return Object.keys(normalized).length ? normalized : undefined;
}

function sanitizedFailure(error: unknown): AiOperationalError | AiNonRetryableError {
  const classified = classifyAiError(error);
  const message = `AI provider call failed (${classified.code})`;
  return classified instanceof AiOperationalError
    ? new AiOperationalError(message, undefined, classified.code)
    : new AiNonRetryableError(message, undefined, classified.code);
}

function omitProviderMetadata<T extends Record<string, unknown>>(
  value: T,
): Omit<T, "raw" | "usage"> {
  const { raw: _raw, usage: _usage, ...rest } = value;
  return rest;
}

/**
 * Last internal boundary before capability/domain code. It normalizes billable
 * usage, removes SDK-native response objects and converts SDK exceptions into
 * the shared taxonomy without preserving raw causes or provider messages.
 */
export function createNormalizedProviderBoundary(provider: AiProvider): AiProvider {
  return {
    async createTextResponse(request, options) {
      try {
        const response = await provider.createTextResponse(request, options);
        const usage = normalizeProviderUsage(response.usage);
        return {
          ...omitProviderMetadata(response as unknown as Record<string, unknown>),
          ...(usage ? { usage } : {}),
        } as unknown as AiProviderTextResponse;
      } catch (error) {
        throw sanitizedFailure(error);
      }
    },
    async createEmbeddings(request, options) {
      try {
        const response = await provider.createEmbeddings(request, options);
        const usage = normalizeProviderUsage(response.usage);
        return {
          ...omitProviderMetadata(response as unknown as Record<string, unknown>),
          ...(usage ? { usage } : {}),
        } as unknown as AiProviderEmbeddingResponse;
      } catch (error) {
        throw sanitizedFailure(error);
      }
    },
    async createAudioTranscription(request, options) {
      try {
        const response = await provider.createAudioTranscription(request, options);
        const usage = normalizeProviderUsage(
          (response as unknown as { usage?: AiProviderUsage }).usage,
          { audioSeconds: response.duration },
        );
        return {
          ...omitProviderMetadata(response as unknown as Record<string, unknown>),
          ...(usage ? { usage } : {}),
        } as unknown as AiProviderAudioTranscriptionResponse;
      } catch (error) {
        throw sanitizedFailure(error);
      }
    },
    async createImageGeneration(request, options) {
      try {
        const response = await provider.createImageGeneration(request, options);
        const usage = normalizeProviderUsage(
          (response as unknown as { usage?: AiProviderUsage }).usage,
          { generatedImages: 1 },
        );
        return {
          ...omitProviderMetadata(response as unknown as Record<string, unknown>),
          ...(usage ? { usage } : {}),
        } as unknown as AiProviderImageGenerationResponse;
      } catch (error) {
        throw sanitizedFailure(error);
      }
    },
  };
}
