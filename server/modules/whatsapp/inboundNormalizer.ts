import type { CanonicalWhatsappIntentName } from "./canonicalIntentSchema";
import {
  inspectWhatsAppUserContentSafety,
  type WhatsAppContentSafetyCheck,
  type WhatsAppUserContentModality,
} from "./promptInjectionGuard";

export type WhatsappInboundMediaKind = "none" | "audio" | "image";

export type WhatsappInboundMediaInput = {
  kind: WhatsappInboundMediaKind;
  mediaId?: string | null;
  mimeType?: string | null;
  caption?: string | null;
  transcribedText?: string | null;
  extractedText?: string | null;
  extractionConfidence?: number | null;
};

export type WhatsappInboundNormalizationInput = {
  messageId?: string | null;
  text?: string | null;
  media?: WhatsappInboundMediaInput | null;
};

export type WhatsappInboundMediaClassification =
  | "none"
  | "audio_transcript"
  | "food_image"
  | "nutrition_label"
  | "ambiguous_media";

export type WhatsappInboundSourceRecommendation =
  | "nenhuma"
  | "catalogo_alimentos"
  | "rotulo_extraido"
  | "revisao_manual";

export type NormalizedWhatsappInboundMessage = {
  messageId: string | null;
  inputModality: "texto" | "audio" | "imagem" | "imagem_com_legenda";
  originalText: string | null;
  normalizedText: string | null;
  routerText: string | null;
  transcribedText: string | null;
  mediaContext: {
    mediaId: string | null;
    mimeType: string | null;
    captionText: string | null;
    extractedLabelText: string | null;
    extractionConfidence: number | null;
    classification: WhatsappInboundMediaClassification;
  } | null;
  intentHint: CanonicalWhatsappIntentName;
  sourceRecommendation: WhatsappInboundSourceRecommendation;
  confidence: number;
  requiresClarification: boolean;
  clarificationQuestion: string | null;
  safetyCheck: WhatsAppContentSafetyCheck;
  auditSummary: {
    mediaKind: WhatsappInboundMediaKind;
    extractionPerformed: boolean;
    mediaClassification: WhatsappInboundMediaClassification;
    confidence: number;
    response: "ready_for_router" | "clarification_needed" | "blocked_by_safety";
  };
};

function compactText(value?: string | null) {
  const compacted = value?.replace(/\s+/g, " ").trim() ?? "";
  return compacted || null;
}

function normalizeText(value?: string | null) {
  const text = compactText(value);
  if (!text) return null;
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:,.%/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampConfidence(value: number | null | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function hasNutritionLabelSignal(value: string | null) {
  if (!value) return false;
  return /\b(?:tabela nutricional|informacao nutricional|informa[cç][aã]o nutricional|valor energetico|kcal|calorias|carboidratos?|proteinas?|prote[ií]nas?|gorduras?|por[cç][aã]o|ingredientes?)\b/i.test(value);
}

function hasFoodImageSignal(value: string | null) {
  if (!value) return false;
  return /\b(?:comida|alimento|refei[cç][aã]o|prato|almoco|almo[cç]o|jantar|lanche|cafe|caf[eé]|arroz|feij[aã]o|frango|salada|banana|p[aã]o)\b/i.test(value);
}

function resolveInputModality(input: WhatsappInboundNormalizationInput): NormalizedWhatsappInboundMessage["inputModality"] {
  const media = input.media;
  if (!media || media.kind === "none") return "texto";
  if (media.kind === "audio") return "audio";
  return compactText(media.caption) ? "imagem_com_legenda" : "imagem";
}

function resolveGuardModality(inputModality: NormalizedWhatsappInboundMessage["inputModality"]): WhatsAppUserContentModality {
  if (inputModality === "audio") return "audio_transcript";
  if (inputModality === "imagem_com_legenda") return "image_caption";
  if (inputModality === "imagem") return "multimodal";
  return "text";
}

function buildRouterText(parts: Array<string | null>) {
  return parts.filter(Boolean).join("\n").trim() || null;
}

function classifyMedia(input: WhatsappInboundNormalizationInput): {
  classification: WhatsappInboundMediaClassification;
  intentHint: CanonicalWhatsappIntentName;
  sourceRecommendation: WhatsappInboundSourceRecommendation;
  confidence: number;
  requiresClarification: boolean;
  clarificationQuestion: string | null;
} {
  const media = input.media;
  if (!media || media.kind === "none") {
    return {
      classification: "none",
      intentHint: "registrar_alimento",
      sourceRecommendation: "catalogo_alimentos",
      confidence: compactText(input.text) ? 0.9 : 0.1,
      requiresClarification: !compactText(input.text),
      clarificationQuestion: compactText(input.text) ? null : "Envie uma mensagem, áudio ou imagem com contexto para eu interpretar.",
    };
  }

  const caption = compactText(media.caption);
  const transcript = compactText(media.transcribedText);
  const extractedText = compactText(media.extractedText);
  const combinedText = buildRouterText([input.text ?? null, caption, transcript, extractedText]);

  if (media.kind === "audio") {
    return {
      classification: "audio_transcript",
      intentHint: transcript ? "registrar_alimento" : "pedir_esclarecimento",
      sourceRecommendation: "catalogo_alimentos",
      confidence: transcript ? 0.86 : 0.2,
      requiresClarification: !transcript,
      clarificationQuestion: transcript ? null : "Não consegui transcrever o áudio. Pode enviar em texto ou tentar novamente?",
    };
  }

  if (hasNutritionLabelSignal(extractedText) || hasNutritionLabelSignal(caption)) {
    return {
      classification: "nutrition_label",
      intentHint: "extrair_rotulo_nutricional",
      sourceRecommendation: "rotulo_extraido",
      confidence: clampConfidence(media.extractionConfidence, 0.82),
      requiresClarification: false,
      clarificationQuestion: null,
    };
  }

  if (hasFoodImageSignal(combinedText)) {
    return {
      classification: "food_image",
      intentHint: "analisar_imagem_alimento",
      sourceRecommendation: "revisao_manual",
      confidence: caption || extractedText ? 0.76 : 0.55,
      requiresClarification: !caption && !extractedText,
      clarificationQuestion: caption || extractedText
        ? null
        : "Recebi a imagem, mas preciso de uma legenda ou descrição para interpretar com segurança.",
    };
  }

  return {
    classification: "ambiguous_media",
    intentHint: "midia_ambigua",
    sourceRecommendation: "revisao_manual",
    confidence: 0.35,
    requiresClarification: true,
    clarificationQuestion: "Recebi a mídia, mas não ficou claro se é alimento, rótulo nutricional ou outro assunto. Pode descrever o que devo analisar?",
  };
}

export function normalizeWhatsappInboundMessage(input: WhatsappInboundNormalizationInput): NormalizedWhatsappInboundMessage {
  const media = input.media ?? null;
  const inputModality = resolveInputModality(input);
  const caption = compactText(media?.caption);
  const transcribedText = compactText(media?.transcribedText);
  const extractedText = compactText(media?.extractedText);
  const originalText = compactText(input.text);
  const mediaDecision = classifyMedia(input);
  const routerText = buildRouterText([
    originalText,
    caption ? `Legenda da imagem: ${caption}` : null,
    transcribedText ? `Transcricao do audio: ${transcribedText}` : null,
    extractedText ? `Texto extraido da midia: ${extractedText}` : null,
  ]);
  const guardText = routerText ?? mediaDecision.clarificationQuestion ?? "";
  const safetyCheck = inspectWhatsAppUserContentSafety(guardText, resolveGuardModality(inputModality));
  const blockedBySafety = !safetyCheck.safe;
  const response = blockedBySafety
    ? "blocked_by_safety"
    : mediaDecision.requiresClarification
      ? "clarification_needed"
      : "ready_for_router";

  return {
    messageId: compactText(input.messageId),
    inputModality,
    originalText,
    normalizedText: normalizeText(routerText),
    routerText,
    transcribedText,
    mediaContext: media && media.kind !== "none"
      ? {
          mediaId: compactText(media.mediaId),
          mimeType: compactText(media.mimeType),
          captionText: caption,
          extractedLabelText: mediaDecision.classification === "nutrition_label" ? extractedText : null,
          extractionConfidence: media.extractionConfidence ?? null,
          classification: mediaDecision.classification,
        }
      : null,
    intentHint: mediaDecision.intentHint,
    sourceRecommendation: mediaDecision.sourceRecommendation,
    confidence: mediaDecision.confidence,
    requiresClarification: mediaDecision.requiresClarification || blockedBySafety,
    clarificationQuestion: blockedBySafety
      ? "Não posso executar instruções para alterar regras, permissões, validações ou acessar dados de outras pessoas."
      : mediaDecision.clarificationQuestion,
    safetyCheck,
    auditSummary: {
      mediaKind: media?.kind ?? "none",
      extractionPerformed: Boolean(transcribedText || extractedText),
      mediaClassification: mediaDecision.classification,
      confidence: mediaDecision.confidence,
      response,
    },
  };
}
