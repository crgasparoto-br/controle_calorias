import type {
  AiProvider,
  AiProviderAudioTranscriptionRequest,
  AiProviderAudioTranscriptionResponse,
  AiProviderRequestOptions,
} from "../aiProvider";
import type { OptionalSegmentTranscriptionResponse } from "./transcriptionProvider";

const NON_SPEECH_TRANSCRIPTION_TOKENS = new Set([
  "again",
  "apenas",
  "audio",
  "background",
  "cannot",
  "cant",
  "consegui",
  "conseguimos",
  "conteudo",
  "could",
  "couldnt",
  "de",
  "detectada",
  "detectado",
  "detectar",
  "detected",
  "entender",
  "esta",
  "fala",
  "foi",
  "fundo",
  "inaudible",
  "inaudivel",
  "in",
  "identificar",
  "indisponivel",
  "is",
  "music",
  "musica",
  "nao",
  "nenhum",
  "nenhuma",
  "no",
  "noise",
  "novamente",
  "o",
  "only",
  "please",
  "possivel",
  "ruido",
  "sem",
  "silence",
  "silencio",
  "somente",
  "speech",
  "the",
  "tente",
  "transcribe",
  "transcrever",
  "try",
  "unavailable",
  "understand",
  "unintelligible",
  "voice",
  "voz",
  "we",
]);

const NON_SPEECH_TRANSCRIPTION_PATTERNS = [
  /^(?:silencio|silence)$/u,
  /^(?:audio|the audio) (?:esta |is )?(?:inaudivel|unintelligible|indisponivel|unavailable)$/u,
  /^(?:audio|the audio) (?:sem conteudo|without content)$/u,
  /^(?:nenhuma?|nenhum|no) (?:fala|voz|speech|voice)(?: foi| was)? (?:detectad[oa]|detected|identificad[oa]|identified|encontrad[oa]|found)$/u,
  /^(?:sem|no) (?:fala|voz|speech|voice)(?: foi| was)? (?:detectad[oa]|detected)?(?: no| in the)? ?(?:audio)?$/u,
  /^(?:somente|apenas|only) (?:ruido|noise|silencio|silence|musica|music)(?: de fundo| in the background| background)?$/u,
  /^(?:ruido|noise|musica|music)(?: de fundo| in the background| background)?(?: foi| was)? (?:detectad[oa]|detected)$/u,
  /^(?:nao foi possivel|nao consegui(?:mos)?|impossivel) (?:detectar|identificar|entender|transcrever) (?:a |o )?(?:fala|voz|audio)?$/u,
  /^(?:could not|couldnt|unable to|cannot|cant) (?:detect|identify|understand|transcribe) (?:the )?(?:speech|voice|audio)?$/u,
];

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
 * beyond provider boilerplate for silence or unintelligible audio. Marker-only
 * phrases may contain articles, helper verbs and retry guidance; mixed content
 * such as "[inaudível] arroz 100 g" remains valid because it still carries
 * actionable speech.
 */
export function isUsefulTranscriptionText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || !/[\p{L}\p{N}]/u.test(trimmed)) return false;
  const normalized = normalizeTranscriptionMarker(trimmed)
    .replace(/(?:por favor )?tente novamente$/u, "")
    .replace(/(?:please )?try again$/u, "")
    .trim();
  if (!normalized) return false;
  if (NON_SPEECH_TRANSCRIPTION_PATTERNS.some(pattern => pattern.test(normalized))) {
    return false;
  }
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.some(token => !NON_SPEECH_TRANSCRIPTION_TOKENS.has(token));
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
