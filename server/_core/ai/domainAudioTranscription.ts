import type {
  AiProvider,
  AiProviderAudioTranscriptionRequest,
  AiProviderAudioTranscriptionResponse,
  AiProviderRequestOptions,
} from "../aiProvider";
import type { OptionalSegmentTranscriptionResponse } from "./transcriptionProvider";

const NON_SPEECH_TRANSCRIPTION_MARKERS = new Set([
  "audio inaudivel",
  "audio unavailable",
  "background noise",
  "inaudible",
  "inaudivel",
  "music",
  "nao foi possivel entender",
  "nao foi possivel transcrever",
  "nenhuma fala detectada",
  "no speech",
  "sem audio",
  "sem fala",
  "silence",
  "silencio",
  "unintelligible",
]);

function normalizeTranscriptionMarker(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * A transcription is useful only when it contains lexical or numeric content
 * and is not an exact provider placeholder for silence or unintelligible audio.
 * Mixed content such as "[inaudível] arroz 100 g" remains valid because it
 * still carries actionable speech.
 */
export function isUsefulTranscriptionText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || !/[\p{L}\p{N}]/u.test(trimmed)) return false;
  return !NON_SPEECH_TRANSCRIPTION_MARKERS.has(normalizeTranscriptionMarker(trimmed));
}

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
