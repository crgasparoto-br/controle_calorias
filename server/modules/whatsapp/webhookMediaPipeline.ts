import { transcribeAudio } from "../../_core/voiceTranscription";
import { buildSavedMedia, getUserIdByWhatsappPhone, logInferenceEvent } from "../../db";
import { storagePut } from "../../storage";
import {
  buildMediaDataUrl,
  downloadWhatsAppMedia,
  extensionFromMimeType,
  getWhatsAppMessageTextBody,
  type WhatsAppWebhookMessage,
} from "./webhookUtils";

const MEDIA_STORAGE_WARNING = "Falha ao persistir mídia recebida do WhatsApp; processamento seguirá com mídia inline.";

export type PreparedMessageInput = {
  text?: string;
  transcript?: string;
  imageUrl?: string;
  imageAnalysisUrl?: string;
  audioUrl?: string;
  audioAnalysisBase64?: string;
  audioAnalysisMimeType?: string;
  media: ReturnType<typeof buildSavedMedia>[];
  summary: string;
};

type PersistedIncomingMedia = {
  savedMedia?: ReturnType<typeof buildSavedMedia>;
  analysisDataUrl: string;
  mimeType: string;
  storageWarning?: string;
};

async function persistIncomingMedia(sourcePhone: string, mediaType: "image" | "audio", mediaId: string, fallbackMimeType?: string): Promise<PersistedIncomingMedia> {
  const downloaded = await downloadWhatsAppMedia(mediaId, fallbackMimeType);
  const analysisDataUrl = buildMediaDataUrl(downloaded.buffer, downloaded.mimeType);
  const extension = extensionFromMimeType(downloaded.mimeType);
  const fileName = `${sourcePhone}-${mediaId}.${extension}`;

  try {
    const stored = await storagePut(`whatsapp/${mediaType}/${fileName}`, downloaded.buffer, downloaded.mimeType);
    return {
      savedMedia: buildSavedMedia({
        mediaType,
        storageKey: stored.key,
        storageUrl: stored.url,
        mimeType: downloaded.mimeType,
        originalFileName: fileName,
      }),
      analysisDataUrl,
      mimeType: downloaded.mimeType,
    };
  } catch {
    return {
      analysisDataUrl,
      mimeType: downloaded.mimeType,
      storageWarning: MEDIA_STORAGE_WARNING,
    };
  }
}

async function logMediaStorageWarning(sourcePhone: string, warning?: string) {
  if (!warning) {
    return;
  }

  logInferenceEvent({
    userId: await getUserIdByWhatsappPhone(sourcePhone),
    origin: "whatsapp",
    status: "warning",
    eventType: "whatsapp.media_storage_warning",
    detail: warning,
  });
}

export async function prepareMessageInput(message: WhatsAppWebhookMessage, sourcePhone: string): Promise<PreparedMessageInput> {
  const text = getWhatsAppMessageTextBody(message) || undefined;
  const prepared: PreparedMessageInput = {
    text,
    media: [],
    summary: "texto",
  };

  if (message.image?.id) {
    const storedImage = await persistIncomingMedia(sourcePhone, "image", message.image.id, message.image.mime_type);
    if (storedImage.savedMedia) {
      prepared.media.push(storedImage.savedMedia);
      prepared.imageUrl = storedImage.savedMedia.storageUrl;
    }
    prepared.imageAnalysisUrl = storedImage.analysisDataUrl;
    prepared.summary = prepared.text ? "texto + imagem" : "imagem";
    await logMediaStorageWarning(sourcePhone, storedImage.storageWarning);
  }

  if (message.audio?.id) {
    const storedAudio = await persistIncomingMedia(sourcePhone, "audio", message.audio.id, message.audio.mime_type);
    if (storedAudio.savedMedia) {
      prepared.media.push(storedAudio.savedMedia);
      prepared.audioUrl = storedAudio.savedMedia.storageUrl;
    }
    prepared.audioAnalysisBase64 = storedAudio.analysisDataUrl;
    prepared.audioAnalysisMimeType = storedAudio.mimeType;
    prepared.summary = prepared.summary === "texto + imagem" || prepared.summary === "imagem"
      ? `${prepared.summary} + áudio`
      : prepared.text
        ? "texto + áudio"
        : "áudio";
    await logMediaStorageWarning(sourcePhone, storedAudio.storageWarning);

    const transcription = await transcribeAudio({
      audioBase64: storedAudio.analysisDataUrl,
      mimeType: storedAudio.mimeType,
      language: "pt",
      prompt: "Transcreva a refeição descrita pelo usuário em português do Brasil.",
    });

    if ("error" in transcription) {
      logInferenceEvent({
        userId: await getUserIdByWhatsappPhone(sourcePhone),
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.audio_transcription_warning",
        detail: transcription.details || transcription.error,
      });
    } else {
      prepared.transcript = transcription.text;
    }
  }

  return prepared;
}
