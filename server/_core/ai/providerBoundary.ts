import type {
  AiProvider,
  AiProviderAudioTranscriptionResponse,
  AiProviderEmbeddingResponse,
  AiProviderImageGenerationResponse,
  AiProviderTextResponse,
  AiProviderUsage,
  AiWebSearchResult,
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

export type AiProviderCallObservation = {
  usage?: AiNormalizedUsage;
  tools: Array<{
    tool: "web_search";
    executed: boolean;
    billableUnits?: number;
  }>;
};

export type NormalizedProviderBoundaryOptions = {
  onCallCompleted?: (observation: AiProviderCallObservation) => void;
  onCallLimitExceeded?: () => void;
  maxCalls?: number;
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

function observedTools(webSearch: AiWebSearchResult | undefined): AiProviderCallObservation["tools"] {
  if (!webSearch) return [];
  return [{
    tool: "web_search",
    executed: webSearch.executed,
    ...(typeof webSearch.searchCount === "number" && webSearch.searchCount >= 0
      ? { billableUnits: webSearch.searchCount }
      : {}),
  }];
}

function notifyObservation(
  options: NormalizedProviderBoundaryOptions,
  observation: AiProviderCallObservation,
): void {
  try {
    options.onCallCompleted?.(observation);
  } catch {
    // Metadata collection is best effort and must not alter provider behavior.
  }
}

/**
 * Last internal boundary before capability/domain code. It normalizes billable
 * usage, removes SDK-native response objects and converts SDK exceptions into
 * the shared taxonomy without preserving raw causes or provider messages.
 */
export function createNormalizedProviderBoundary(
  provider: AiProvider,
  boundaryOptions: NormalizedProviderBoundaryOptions = {},
): AiProvider {
  let startedCalls = 0;
  const beginCall = (): void => {
    startedCalls += 1;
    if (boundaryOptions.maxCalls !== undefined && startedCalls > boundaryOptions.maxCalls) {
      try {
        boundaryOptions.onCallLimitExceeded?.();
      } catch {
        // Enforcement does not depend on the diagnostic callback.
      }
      throw new AiNonRetryableError(
        "AI capability attempt performed more than one provider call.",
        undefined,
        "incompatible_operation",
      );
    }
  };

  return {
    async createTextResponse(request, requestOptions) {
      beginCall();
      try {
        const response = await provider.createTextResponse(request, requestOptions);
        const usage = normalizeProviderUsage(response.usage);
        const normalized = {
          ...omitProviderMetadata(response as unknown as Record<string, unknown>),
          ...(usage ? { usage } : {}),
        } as unknown as AiProviderTextResponse;
        notifyObservation(boundaryOptions, {
          ...(usage ? { usage } : {}),
          tools: observedTools(response.webSearch),
        });
        return normalized;
      } catch (error) {
        throw sanitizedFailure(error);
      }
    },
    async createEmbeddings(request, requestOptions) {
      beginCall();
      try {
        const response = await provider.createEmbeddings(request, requestOptions);
        const usage = normalizeProviderUsage(response.usage);
        const normalized = {
          ...omitProviderMetadata(response as unknown as Record<string, unknown>),
          ...(usage ? { usage } : {}),
        } as unknown as AiProviderEmbeddingResponse;
        notifyObservation(boundaryOptions, { ...(usage ? { usage } : {}), tools: [] });
        return normalized;
      } catch (error) {
        throw sanitizedFailure(error);
      }
    },
    async createAudioTranscription(request, requestOptions) {
      beginCall();
      try {
        const response = await provider.createAudioTranscription(request, requestOptions);
        const usage = normalizeProviderUsage(
          (response as unknown as { usage?: AiProviderUsage }).usage,
          { audioSeconds: response.duration },
        );
        const normalized = {
          ...omitProviderMetadata(response as unknown as Record<string, unknown>),
          ...(usage ? { usage } : {}),
        } as unknown as AiProviderAudioTranscriptionResponse;
        notifyObservation(boundaryOptions, { ...(usage ? { usage } : {}), tools: [] });
        return normalized;
      } catch (error) {
        throw sanitizedFailure(error);
      }
    },
    async createImageGeneration(request, requestOptions) {
      beginCall();
      try {
        const response = await provider.createImageGeneration(request, requestOptions);
        const typedUsage = (response as unknown as { usage?: AiProviderUsage }).usage;
        const nativeUsage = record(record(response.raw).usage);
        const extractedUsage = typedUsage ?? (Object.keys(nativeUsage).length
          ? {
              ...(finite(nativeUsage.input_tokens) !== undefined
                ? { inputTokens: finite(nativeUsage.input_tokens) }
                : {}),
              ...(finite(nativeUsage.output_tokens) !== undefined
                ? { outputTokens: finite(nativeUsage.output_tokens) }
                : {}),
              ...(finite(nativeUsage.total_tokens) !== undefined
                ? { totalTokens: finite(nativeUsage.total_tokens) }
                : {}),
              raw: nativeUsage,
            }
          : undefined);
        const usage = normalizeProviderUsage(extractedUsage, { generatedImages: 1 });
        const normalized = {
          ...omitProviderMetadata(response as unknown as Record<string, unknown>),
          ...(usage ? { usage } : {}),
        } as unknown as AiProviderImageGenerationResponse;
        notifyObservation(boundaryOptions, { ...(usage ? { usage } : {}), tools: [] });
        return normalized;
      } catch (error) {
        throw sanitizedFailure(error);
      }
    },
  };
}
