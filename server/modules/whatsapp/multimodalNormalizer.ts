import { normalizeTextMeasurementUnits } from "../../../shared/measurementUnits";
import type { WhatsappInputModality } from "./canonicalIntentSchema";

export const whatsappMediaKinds = ["alimento", "rotulo_nutricional", "ambigua", "nao_relacionada"] as const;
export type WhatsappMediaKind = typeof whatsappMediaKinds[number];

export type WhatsappInboundMediaType = "audio" | "image";

export type WhatsappInboundMediaInput = {
  type: WhatsappInboundMediaType;
  mediaId?: string | null;
  mimeType?: string | null;
  caption?: string | null;
  transcription?: string | null;
  imageDescription?: string | null;
};

export type WhatsappMultimodalInput = {
  text?: string | null;
  media?: WhatsappInboundMediaInput | null;
};

export type WhatsappMediaExtraction = {
  performed: "none" | "audio_transcription" | "image_classification";
  confidence: number | null;
  source: "text" | "caption" | "provided_transcription" | "provided_image_description" | "provider" | "none";
};

export type WhatsappNormalizedMultimodalInput = {
  inputModality: WhatsappInputModality;
  originalText: string | null;
  normalizedText: string | null;
  transcribedText: string | null;
  routerText: string | null;
  mediaContext: {
    mediaId: string | null;
    caption: string | null;
    mediaKind: WhatsappMediaKind | null;
    mimeType: string | null;
    extractionConfidence: number | null;
  } | null;
  extraction: WhatsappMediaExtraction;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  historyDetail: string;
};

type WhatsappMultimodalNormalizerProviders = {
  transcribeAudio?: (media: WhatsappInboundMediaInput) => Promise<{ text: string; confidence?: number | null } | null>;
  describeImage?: (media: WhatsappInboundMediaInput) => Promise<{ description: string; confidence?: number | null } | null>;
};

function cleanText(value?: string | null) {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function normalizeRouterText(value?: string | null) {
  const cleaned = cleanText(value);
  return cleaned ? normalizeTextMeasurementUnits(cleaned) : null;
}

function detectLabelText(value: string) {
  return /\b(rotulo|r[oó]tulo|tabela nutricional|informacao nutricional|informa[cç][aã]o nutricional|por[cç][aã]o|valor energ[eé]tico|calorias|carboidratos|prote[ií]nas|gorduras?)\b/i.test(value);
}

function detectFoodText(value: string) {
  return /\b(comida|alimento|prato|refei[cç][aã]o|marmita|salada|arroz|feij[aã]o|frango|carne|peixe|ovo|banana|ma[cç][aã]|iogurte|p[aã]o|batata|massa|lanche|caf[eé]|almo[cç]o|jantar)\b/i.test(value);
}

function classifyImage(text: string | null): { mediaKind: WhatsappMediaKind; confidence: number | null } {
  if (!text) {
    return { mediaKind: "ambigua", confidence: null };
  }
  if (detectLabelText(text)) {
    return { mediaKind: "rotulo_nutricional", confidence: 0.84 };
  }
  if (detectFoodText(text)) {
    return { mediaKind: "alimento", confidence: 0.72 };
  }
  return { mediaKind: "ambigua", confidence: 0.4 };
}

function mediaInputModality(input: WhatsappMultimodalInput): WhatsappInputModality {
  if (!input.media) return "texto";
  if (input.media.type === "audio") return "audio";
  return cleanText(input.media.caption) ? "imagem_com_legenda" : "imagem";
}

function buildImageRouterText(mediaKind: WhatsappMediaKind, caption: string | null, description: string | null) {
  const context = [caption, description].filter(Boolean).join(". ");
  if (mediaKind === "rotulo_nutricional") {
    return normalizeRouterText(`Rótulo nutricional enviado por imagem. ${context}`);
  }
  if (mediaKind === "alimento") {
    return normalizeRouterText(`Imagem de alimento enviada. ${context}`);
  }
  return normalizeRouterText(context);
}

export async function normalizeWhatsappMultimodalInput(
  input: WhatsappMultimodalInput,
  providers: WhatsappMultimodalNormalizerProviders = {},
): Promise<WhatsappNormalizedMultimodalInput> {
  const originalText = cleanText(input.text);
  const textOnly = !input.media;
  if (textOnly) {
    const normalizedText = normalizeRouterText(originalText);
    return {
      inputModality: "texto",
      originalText,
      normalizedText,
      transcribedText: null,
      routerText: normalizedText,
      mediaContext: null,
      extraction: { performed: "none", confidence: null, source: originalText ? "text" : "none" },
      needsClarification: false,
      clarificationQuestion: null,
      historyDetail: "Entrada de texto normalizada antes do roteador do WhatsApp.",
    };
  }

  const media = input.media!;
  const caption = cleanText(media.caption);
  if (media.type === "audio") {
    const providedTranscription = cleanText(media.transcription);
    const providerTranscription = providedTranscription ? null : await providers.transcribeAudio?.(media);
    const transcribedText = providedTranscription ?? cleanText(providerTranscription?.text);
    const routerText = normalizeRouterText([originalText, transcribedText].filter(Boolean).join(". "));
    const needsClarification = !routerText;

    return {
      inputModality: "audio",
      originalText,
      normalizedText: routerText,
      transcribedText,
      routerText,
      mediaContext: {
        mediaId: media.mediaId ?? null,
        caption: null,
        mediaKind: needsClarification ? "ambigua" : null,
        mimeType: media.mimeType ?? null,
        extractionConfidence: providedTranscription ? 0.9 : providerTranscription?.confidence ?? null,
      },
      extraction: {
        performed: "audio_transcription",
        confidence: providedTranscription ? 0.9 : providerTranscription?.confidence ?? null,
        source: providedTranscription ? "provided_transcription" : providerTranscription ? "provider" : "none",
      },
      needsClarification,
      clarificationQuestion: needsClarification ? "Não consegui transcrever o áudio com segurança. Pode enviar a refeição em texto?" : null,
      historyDetail: needsClarification
        ? "Áudio recebido, mas sem transcrição suficiente para roteamento seguro."
        : "Áudio transcrito e normalizado antes do roteador do WhatsApp.",
    };
  }

  const providedDescription = cleanText(media.imageDescription);
  const providerDescription = providedDescription ? null : await providers.describeImage?.(media);
  const imageDescription = providedDescription ?? cleanText(providerDescription?.description);
  const classificationText = [caption, imageDescription, originalText].filter(Boolean).join(". ") || null;
  const classification = classifyImage(classificationText);
  const routerText = buildImageRouterText(classification.mediaKind, caption ?? originalText, imageDescription);
  const needsClarification = classification.mediaKind === "ambigua";

  return {
    inputModality: mediaInputModality(input),
    originalText,
    normalizedText: routerText,
    transcribedText: null,
    routerText,
    mediaContext: {
      mediaId: media.mediaId ?? null,
      caption: caption ?? originalText,
      mediaKind: classification.mediaKind,
      mimeType: media.mimeType ?? null,
      extractionConfidence: providedDescription ? Math.max(classification.confidence ?? 0, 0.75) : providerDescription?.confidence ?? classification.confidence,
    },
    extraction: {
      performed: "image_classification",
      confidence: providedDescription ? Math.max(classification.confidence ?? 0, 0.75) : providerDescription?.confidence ?? classification.confidence,
      source: caption ? "caption" : providedDescription ? "provided_image_description" : providerDescription ? "provider" : "none",
    },
    needsClarification,
    clarificationQuestion: needsClarification ? "Recebi a imagem, mas preciso de uma legenda dizendo se é alimento ou rótulo nutricional." : null,
    historyDetail: classification.mediaKind === "rotulo_nutricional"
      ? "Imagem classificada como rótulo nutricional antes do roteador do WhatsApp."
      : classification.mediaKind === "alimento"
        ? "Imagem classificada como alimento antes do roteador do WhatsApp."
        : "Imagem recebida sem contexto alimentar suficiente para roteamento seguro.",
  };
}
