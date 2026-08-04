import type {
  AiProvider,
  AiProviderAudioTranscriptionRequest,
  AiProviderAudioTranscriptionResponse,
  AiProviderRequestOptions,
} from "../aiProvider";
import type { OptionalSegmentTranscriptionResponse } from "./transcriptionProvider";

export type AiDomainAudioUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type AiDomainAudioTranscription = {
  task: "transcribe";
  text: string;
  language?: string;
  duration?: number;
  segments?: AiProviderAudioTranscriptionResponse["segments"];
  usage?: AiDomainAudioUsage;
};

function sanitizeUsage(
  usage: OptionalSegmentTranscriptionResponse["usage"],
): AiDomainAudioUsage | undefined {
  if (!usage) return undefined;
  return {
    ...(typeof usage.inputTokens === "number" ? { inputTokens: usage.inputTokens } : {}),
    ...(typeof usage.outputTokens === "number" ? { outputTokens: usage.outputTokens } : {}),
    ...(typeof usage.totalTokens === "number" ? { totalTokens: usage.totalTokens } : {}),
  };
}

/**
 * One call to this boundary performs exactly one outbound provider operation.
 * SDK-native raw content remains inside _core and is never returned to meal or
 * WhatsApp domain services.
 */
export async function createDomainAudioTranscription(
  provider: AiProvider,
  request: AiProviderAudioTranscriptionRequest,
  options?: AiProviderRequestOptions,
): Promise<AiDomainAudioTranscription> {
  const response = await provider.createAudioTranscription(request, options) as unknown as OptionalSegmentTranscriptionResponse;
  const usage = sanitizeUsage(response.usage);

  return {
    task: "transcribe",
    text: typeof response.text === "string" ? response.text.trim() : "",
    ...(typeof response.language === "string" && response.language.trim()
      ? { language: response.language.trim() }
      : {}),
    ...(typeof response.duration === "number" && Number.isFinite(response.duration)
      ? { duration: response.duration }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(response, "segments") && Array.isArray(response.segments)
      ? { segments: response.segments }
      : {}),
    ...(usage ? { usage } : {}),
  };
}
