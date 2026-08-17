import type {
  AiProvider,
  AiProviderAudioTranscriptionRequest,
  AiProviderAudioTranscriptionResponse,
  AiProviderRequestOptions,
} from "../aiProvider";
import type { OptionalSegmentTranscriptionResponse } from "./transcriptionProvider";

const NON_SPEECH_TRANSCRIPTION_TOKENS = new Set([
  "a",
  "again",
  "any",
  "anything",
  "are",
  "apenas",
  "audio",
  "audible",
  "audivel",
  "background",
  "clip",
  "clipe",
  "be",
  "been",
  "being",
  "can",
  "cannot",
  "cant",
  "contains",
  "contain",
  "contained",
  "contem",
  "consigo",
  "consegui",
  "conseguimos",
  "conteudo",
  "content",
  "could",
  "couldn",
  "couldnt",
  "de",
  "detectada",
  "detectadas",
  "detectado",
  "detectados",
  "detectavel",
  "detectar",
  "detected",
  "do",
  "does",
  "e",
  "entender",
  "escutar",
  "eu",
  "existe",
  "esta",
  "estatica",
  "fala",
  "falada",
  "faladas",
  "falado",
  "falados",
  "foi",
  "foram",
  "found",
  "fundo",
  "gravacao",
  "human",
  "humana",
  "humanas",
  "humano",
  "humanos",
  "ha",
  "has",
  "hear",
  "heard",
  "hearing",
  "inaudible",
  "inaudivel",
  "intelligible",
  "in",
  "identificar",
  "i",
  "indisponivel",
  "is",
  "listen",
  "make",
  "music",
  "musica",
  "nao",
  "nada",
  "nenhum",
  "nenhuma",
  "no",
  "not",
  "nothing",
  "noise",
  "novamente",
  "o",
  "only",
  "out",
  "ouvir",
  "ouve",
  "ouvida",
  "ouvidas",
  "ouvido",
  "ouvidos",
  "please",
  "possivel",
  "recording",
  "silent",
  "silenciosa",
  "silenciosas",
  "silencioso",
  "silenciosos",
  "ruido",
  "sem",
  "se",
  "silence",
  "silencio",
  "som",
  "somente",
  "sound",
  "speech",
  "spoken",
  "static",
  "the",
  "there",
  "tente",
  "t",
  "transcribe",
  "transcrever",
  "try",
  "unable",
  "unavailable",
  "understand",
  "unintelligible",
  "verbal",
  "was",
  "wasn",
  "were",
  "without",
  "voice",
  "voz",
  "we",
  "word",
  "words",
  "palavra",
  "palavras",
]);

const NON_SPEECH_SUBJECT_TOKENS = new Set([
  "audio",
  "clip",
  "clipe",
  "content",
  "conteudo",
  "fala",
  "gravacao",
  "palavra",
  "palavras",
  "recording",
  "som",
  "sound",
  "speech",
  "voice",
  "voz",
  "word",
  "words",
]);

const NON_SPEECH_NEGATION_TOKENS = new Set([
  "anything",
  "cannot",
  "cant",
  "couldnt",
  "nada",
  "nao",
  "nenhum",
  "nenhuma",
  "no",
  "not",
  "nothing",
  "sem",
  "unable",
  "without",
]);

const NON_SPEECH_FAILURE_TOKENS = new Set([
  "contain",
  "contained",
  "contains",
  "contem",
  "detectada",
  "detectadas",
  "detectado",
  "detectados",
  "detectavel",
  "detected",
  "entender",
  "escutar",
  "existe",
  "found",
  "hear",
  "heard",
  "hearing",
  "identificar",
  "inaudible",
  "inaudivel",
  "listen",
  "ouvir",
  "ouve",
  "ouvida",
  "ouvidas",
  "ouvido",
  "ouvidos",
  "possivel",
  "transcribe",
  "transcrever",
  "silent",
  "silenciosa",
  "silenciosas",
  "silencioso",
  "silenciosos",
  "static",
  "estatica",
  "unavailable",
  "understand",
  "unintelligible",
]);

const DIRECT_NON_SPEECH_MARKERS = new Set([
  "inaudible",
  "inaudivel",
  "music",
  "musica",
  "noise",
  "ruido",
  "silence",
  "silencio",
  "silent",
  "silenciosa",
  "silenciosas",
  "silencioso",
  "silenciosos",
  "static",
  "estatica",
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

function isSemanticNonSpeechStatement(tokens: string[]): boolean {
  if (!tokens.length) return true;
  if (!tokens.every(token => NON_SPEECH_TRANSCRIPTION_TOKENS.has(token))) {
    return false;
  }

  const hasDirectMarker = tokens.some(token => DIRECT_NON_SPEECH_MARKERS.has(token));
  const hasSubject = tokens.some(token => NON_SPEECH_SUBJECT_TOKENS.has(token));
  const hasNegation = tokens.some(token => NON_SPEECH_NEGATION_TOKENS.has(token));
  const hasFailure = tokens.some(token => NON_SPEECH_FAILURE_TOKENS.has(token));

  return hasDirectMarker
    || (hasSubject && (hasNegation || hasFailure))
    || (hasNegation && hasFailure);
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
  return !isSemanticNonSpeechStatement(tokens);
}

export type AiDomainAudioUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  audioSeconds?: number;
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
  const normalized = usage as (OptionalSegmentTranscriptionResponse["usage"] & { audioSeconds?: number }) | undefined;
  if (!normalized) return undefined;
  return {
    ...(typeof normalized.inputTokens === "number" ? { inputTokens: normalized.inputTokens } : {}),
    ...(typeof normalized.outputTokens === "number" ? { outputTokens: normalized.outputTokens } : {}),
    ...(typeof normalized.totalTokens === "number" ? { totalTokens: normalized.totalTokens } : {}),
    ...(typeof normalized.audioSeconds === "number" ? { audioSeconds: normalized.audioSeconds } : {}),
  };
}

/**
 * One call to this boundary performs exactly one outbound provider operation.
 * SDK-native response content is discarded by the adapter and never returned to meal or
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
