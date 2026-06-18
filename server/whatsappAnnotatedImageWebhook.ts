import { Request, Response } from "express";
import { buildSavedMedia, confirmPendingMeal, createPendingMealInference, getHabitSnapshots, getUserDayMealTotals, getUserIdByWhatsappPhone, getUserNutritionGoal, logInferenceEvent } from "./db";
import { tryCreateQuickEditLinkForMeal } from "./modules/quickEdit/service";
import { generateAnnotatedMealImage } from "./modules/whatsapp/annotatedImage";
import {
  buildSuspiciousWhatsAppContentReply,
  inspectWhatsAppUserContentSafety,
} from "./modules/whatsapp/promptInjectionGuard";
import { buildWhatsAppMealReplyMessage } from "./modules/whatsapp/replyMessages";
import {
  buildMediaDataUrl,
  downloadWhatsAppMedia,
  extensionFromMimeType,
  extractWhatsAppWebhookMessages,
  formatDateKeyInSaoPaulo,
  getExtractedWhatsAppMessageKey,
  isWhatsAppMessageForConfiguredChannel,
  markWhatsAppMessageAsRead,
  resolveWhatsAppMessageOccurredAt,
  sendWhatsAppImageBufferMessage,
  sendWhatsAppImageMessage,
  sendWhatsAppInteractiveUrlButtonMessage,
  sendWhatsAppTextMessage,
  type ExtractedWhatsAppWebhookMessage,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";
import { processMealInput } from "./nutritionEngine";
import { storagePut } from "./storage";
import { handleWhatsAppWebhook } from "./whatsappWebhook";

type SavedMedia = ReturnType<typeof buildSavedMedia>;

type PreparedImageMessage = {
  text?: string;
  imageUrl?: string;
  imageAnalysisUrl: string;
  media: SavedMedia[];
  storageWarning?: string;
};

const recentlyHandledAnnotatedImageMessageIds = new Map<string, number>();
const ANNOTATED_IMAGE_DEDUPLICATION_TTL_MS = 24 * 60 * 60 * 1000;
const MEDIA_STORAGE_WARNING = "Falha ao persistir mídia recebida do WhatsApp; processamento seguirá com mídia inline.";
const PROCESSING_ERROR_REPLY = "Não consegui processar essa imagem agora. Tente enviar novamente ou descreva os alimentos em texto para eu registrar.";
const ANNOTATED_IMAGE_UNAVAILABLE_REPLY = "A refeição foi registrada, mas não consegui gerar a imagem anotada agora. Você já pode acompanhar o resumo nutricional acima.";
const ANNOTATED_IMAGE_SEND_FAILED_REPLY = "A refeição foi registrada, mas não consegui enviar a imagem anotada agora. Você já pode acompanhar o resumo nutricional acima.";

function getTextBody(message: WhatsAppWebhookMessage) {
  return message.text?.body?.trim() || message.image?.caption?.trim() || "";
}

function canHandleAnnotatedImageMessage(message: WhatsAppWebhookMessage) {
  return Boolean(message.image?.id && !message.audio?.id);
}

function pruneRecentlyHandledAnnotatedImageMessageIds(now = Date.now()) {
  for (const [messageId, expiresAt] of recentlyHandledAnnotatedImageMessageIds) {
    if (expiresAt <= now) {
      recentlyHandledAnnotatedImageMessageIds.delete(messageId);
    }
  }
}

function wasAnnotatedImageMessageAlreadyHandled(messageId?: string) {
  if (!messageId) {
    return false;
  }

  const now = Date.now();
  pruneRecentlyHandledAnnotatedImageMessageIds(now);
  return recentlyHandledAnnotatedImageMessageIds.has(messageId);
}

function markAnnotatedImageMessageHandled(messageId?: string) {
  if (messageId) {
    recentlyHandledAnnotatedImageMessageIds.set(messageId, Date.now() + ANNOTATED_IMAGE_DEDUPLICATION_TTL_MS);
  }
}

function formatReplyTime(date: Date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

async function getWhatsAppMealGoalProgress(userId: number, occurredAt: Date) {
  try {
    const [goalSummary, dayTotals] = await Promise.all([
      getUserNutritionGoal(userId),
      getUserDayMealTotals(userId, formatDateKeyInSaoPaulo(occurredAt)),
    ]);

    return {
      consumedCalories: dayTotals.totals.calories,
      goalCalories: goalSummary.today.calories,
    };
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.goal_progress_warning",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao calcular progresso da meta para resposta do WhatsApp.",
    });
    return null;
  }
}

async function prepareImageMessage(message: WhatsAppWebhookMessage, sourcePhone: string): Promise<PreparedImageMessage> {
  const imageId = message.image?.id;
  if (!imageId) {
    throw new Error("Mensagem sem imagem para processamento anotado.");
  }

  const downloaded = await downloadWhatsAppMedia(imageId, message.image?.mime_type);
  const imageAnalysisUrl = buildMediaDataUrl(downloaded.buffer, downloaded.mimeType);
  const extension = extensionFromMimeType(downloaded.mimeType);
  const fileName = `${sourcePhone}-${imageId}.${extension}`;
  const prepared: PreparedImageMessage = {
    text: getTextBody(message) || undefined,
    imageAnalysisUrl,
    media: [],
  };

  try {
    const stored = await storagePut(`whatsapp/image/${fileName}`, downloaded.buffer, downloaded.mimeType);
    const savedMedia = buildSavedMedia({
      mediaType: "image",
      storageKey: stored.key,
      storageUrl: stored.url,
      mimeType: downloaded.mimeType,
      originalFileName: fileName,
    });
    prepared.media.push(savedMedia);
    prepared.imageUrl = savedMedia.storageUrl;
  } catch {
    prepared.storageWarning = MEDIA_STORAGE_WARNING;
  }

  return prepared;
}

function buildAnnotatedImageMedia(annotatedImage: { url?: string; storageKey?: string; mimeType?: string }) {
  if (!annotatedImage.url || !annotatedImage.storageKey) {
    return null;
  }

  return buildSavedMedia({
    mediaType: "image",
    storageKey: annotatedImage.storageKey,
    storageUrl: annotatedImage.url,
    mimeType: annotatedImage.mimeType || "image/png",
    originalFileName: "whatsapp-annotated-meal.png",
  });
}

async function sendAnnotatedImageToWhatsApp(input: {
  sourcePhone: string;
  annotatedImage: { url?: string; buffer?: Buffer; mimeType?: string };
}) {
  const caption = "Imagem anotada com os alimentos identificados.";
  if (input.annotatedImage.url) {
    return {
      attempted: true,
      ...(await sendWhatsAppImageMessage(input.sourcePhone, input.annotatedImage.url, caption)),
    };
  }

  if (input.annotatedImage.buffer) {
    return {
      attempted: true,
      ...(await sendWhatsAppImageBufferMessage(
        input.sourcePhone,
        {
          buffer: input.annotatedImage.buffer,
          mimeType: input.annotatedImage.mimeType || "image/png",
          fileName: "whatsapp-annotated-meal.png",
        },
        caption,
      )),
    };
  }

  return {
    attempted: false,
    ok: false,
    detail: "Imagem anotada não possui URL nem arquivo local para envio.",
  };
}

function clonePayloadWithoutHandledMessages(payload: any, handledMessageKeys: Set<string>) {
  const cloned = structuredClone(payload);
  const entries = Array.isArray(cloned?.entry) ? cloned.entry : [];
  cloned.entry = entries
    .map((entry: any, entryIndex: number) => {
      if (!Array.isArray(entry?.changes)) {
        return entry;
      }

      const changes = entry.changes
        .map((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          const pendingMessages = messages.filter(
            (_message: WhatsAppWebhookMessage, messageIndex: number) => !handledMessageKeys.has(getExtractedWhatsAppMessageKey({
              entryIndex,
              changeIndex,
              messageIndex,
            })),
          );
          return {
            ...change,
            value: {
              ...change.value,
              messages: pendingMessages,
            },
          };
        })
        .filter((change: any) => Array.isArray(change?.value?.messages) && change.value.messages.length > 0);

      return {
        ...entry,
        changes,
      };
    })
    .filter((entry: any) => Array.isArray(entry?.changes) && entry.changes.length > 0);

  return cloned;
}

async function logWhatsAppOperationWarning(input: {
  userId: number;
  eventType: string;
  detail: string;
}) {
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: "warning",
    eventType: input.eventType,
    detail: `Falha ao processar operação automática do WhatsApp: ${input.detail}`,
  });
}

async function sendAnnotatedImageFallbackText(input: {
  userId: number;
  sourcePhone: string;
  reply: string;
}) {
  const replyResult = await sendWhatsAppTextMessage(input.sourcePhone, input.reply);
  if (!replyResult.ok) {
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.reply_failed",
      detail: `Falha ao enviar fallback da imagem anotada para ${input.sourcePhone}: ${replyResult.detail}`,
    });
  }
}

async function tryHandleAnnotatedImageMessage(message: ExtractedWhatsAppWebhookMessage) {
  const sourcePhone = message.from || "unknown";
  if (!isWhatsAppMessageForConfiguredChannel(message) || !canHandleAnnotatedImageMessage(message)) {
    return false;
  }

  if (wasAnnotatedImageMessageAlreadyHandled(message.id)) {
    return true;
  }

  let userId: number | null = null;

  try {
    userId = await getUserIdByWhatsappPhone(sourcePhone);
    if (!userId) {
      return false;
    }

    const readResult = await markWhatsAppMessageAsRead(message.id);
    if (!readResult.ok) {
      await logWhatsAppOperationWarning({
        userId,
        eventType: "whatsapp.read_receipt_failed",
        detail: readResult.detail,
      });
    }

    const acknowledgementResult = await sendWhatsAppTextMessage(sourcePhone, "Recebi sua imagem e estou processando.");
    if (!acknowledgementResult.ok) {
      await logWhatsAppOperationWarning({
        userId,
        eventType: "whatsapp.processing_ack_failed",
        detail: acknowledgementResult.detail,
      });
    }

    const prepared = await prepareImageMessage(message, sourcePhone);
    if (prepared.storageWarning) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.media_storage_warning",
        detail: prepared.storageWarning,
      });
    }

    const captionSafety = inspectWhatsAppUserContentSafety(prepared.text, "image_caption");
    if (!captionSafety.safe) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.security_guard_blocked",
        detail: `Conteudo bloqueado por seguranca antes da inferencia de imagem: ${captionSafety.categories.join(", ") || "security_guard"}.`,
      });
      await sendAnnotatedImageFallbackText({
        userId,
        sourcePhone,
        reply: buildSuspiciousWhatsAppContentReply(),
      });
      markAnnotatedImageMessageHandled(message.id);
      return true;
    }

    const processed = await processMealInput({
      text: prepared.text,
      imageUrl: prepared.imageAnalysisUrl || prepared.imageUrl,
      habits: await getHabitSnapshots(userId),
    });
    const processedForPersistence = {
      ...processed,
      imageUrl: prepared.imageUrl,
    };

    const annotatedImage = await generateAnnotatedMealImage(processedForPersistence, prepared.imageAnalysisUrl);
    const annotatedMedia = buildAnnotatedImageMedia(annotatedImage);
    if (annotatedMedia) {
      prepared.media.push(annotatedMedia);
    } else if (annotatedImage.url) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.annotated_image_not_persisted",
        detail: "Imagem anotada gerada sem chave de storage; envio ao WhatsApp será tentado, mas a mídia não foi vinculada à refeição.",
      });
    }

    const occurredAt = resolveWhatsAppMessageOccurredAt(message);
    const draft = createPendingMealInference(userId, "whatsapp", processedForPersistence, prepared.media);
    const savedMeal = await confirmPendingMeal({
      draftId: draft.draftId,
      userId,
      mealLabel: processedForPersistence.detectedMealLabel || "Refeição",
      occurredAt: occurredAt.toISOString(),
      notes: prepared.text?.trim() || undefined,
      items: processedForPersistence.items,
    });

    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.message_processed",
      detail: `Mensagem imagem de ${sourcePhone} processada e refeição ${savedMeal.mealLabel} registrada automaticamente às ${formatReplyTime(occurredAt)}.`,
    });

    const quickEditLink = await tryCreateQuickEditLinkForMeal({ userId, mealId: savedMeal.id });
    const mealReplyText = buildWhatsAppMealReplyMessage(processedForPersistence, {
      registeredAt: occurredAt,
      goalProgress: await getWhatsAppMealGoalProgress(userId, occurredAt),
    });
    const replyResult = quickEditLink?.url
      ? await sendWhatsAppInteractiveUrlButtonMessage(sourcePhone, mealReplyText, "Editar refeição", quickEditLink.url)
      : await sendWhatsAppTextMessage(sourcePhone, mealReplyText);

    if (!replyResult.ok) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.reply_failed",
        detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
      });
    }

    const imageReplyResult = await sendAnnotatedImageToWhatsApp({ sourcePhone, annotatedImage });
    if (imageReplyResult.attempted) {
      if (!imageReplyResult.ok) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: "warning",
          eventType: "whatsapp.annotated_image_reply_failed",
          detail: `Falha ao enviar imagem anotada para ${sourcePhone}: ${imageReplyResult.detail}`,
        });
        await sendAnnotatedImageFallbackText({
          userId,
          sourcePhone,
          reply: ANNOTATED_IMAGE_SEND_FAILED_REPLY,
        });
      }
    } else {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.annotated_image_skipped",
        detail: `Imagem anotada não enviada para ${sourcePhone}: ${annotatedImage.detail || annotatedImage.skippedReason || imageReplyResult.detail}.`,
      });
      await sendAnnotatedImageFallbackText({
        userId,
        sourcePhone,
        reply: ANNOTATED_IMAGE_UNAVAILABLE_REPLY,
      });
    }

    markAnnotatedImageMessageHandled(message.id);
    return true;
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "error",
      eventType: "whatsapp.processing_error",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao processar imagem do WhatsApp.",
    });

    const replyResult = await sendWhatsAppTextMessage(sourcePhone, PROCESSING_ERROR_REPLY);
    if (!replyResult.ok) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.reply_failed",
        detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
      });
    }

    markAnnotatedImageMessageHandled(message.id);
    return true;
  }
}

export async function handleWhatsAppWebhookWithAnnotatedImages(req: Request, res: Response) {
  const messages = extractWhatsAppWebhookMessages(req.body);
  if (!messages.length) {
    return handleWhatsAppWebhook(req, res);
  }

  const handledMessageKeys = new Set<string>();
  for (const message of messages) {
    const handled = await tryHandleAnnotatedImageMessage(message);
    if (handled) {
      handledMessageKeys.add(getExtractedWhatsAppMessageKey(message));
    }
  }

  if (!handledMessageKeys.size) {
    return handleWhatsAppWebhook(req, res);
  }

  const remainingPayload = clonePayloadWithoutHandledMessages(req.body, handledMessageKeys);
  if (!Array.isArray(remainingPayload?.entry) || remainingPayload.entry.length === 0) {
    return res.status(200).json({ ok: true, processed: messages.length });
  }

  req.body = remainingPayload;
  return handleWhatsAppWebhook(req, res);
}
