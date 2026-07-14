import { Request, Response } from "express";
import { buildSavedMedia, confirmPendingMeal, createPendingMealInference, getHabitSnapshots, getUserIdByWhatsappPhone, listUserMeals, logInferenceEvent, removeUserMeal, updateUserMeal } from "./db";
import { executeWhatsappDeleteIntent } from "./modules/whatsapp/deleteIntent";
import { generateAnnotatedMealImage } from "./modules/whatsapp/annotatedImage";
import { getWhatsAppMealGoalProgress } from "./modules/whatsapp/goalProgressService";
import { createMessageDeduplicationCache } from "./modules/whatsapp/messageDeduplicationCache";
import { consolidateWhatsAppMealAfterSave } from "./modules/whatsapp/mealConsolidationService";
import {
  buildSuspiciousWhatsAppContentReply,
  inspectWhatsAppUserContentSafety,
} from "./modules/whatsapp/promptInjectionGuard";
import { buildWhatsAppConsolidatedMealReplyMessage, buildWhatsAppMealReplyMessage } from "./modules/whatsapp/replyMessages";
import { sendWhatsAppLogicalDomainReply, type WhatsAppAuxiliaryImage } from "./modules/whatsapp/logicalReplyDelivery";
import {
  buildMediaDataUrl,
  downloadWhatsAppMedia,
  extensionFromMimeType,
  extractWhatsAppWebhookMessages,
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
import { MealInferenceError, processMealInput, type MealProcessingResult } from "./nutritionEngine";
import { storagePut } from "./storage";
import { handleWhatsAppWebhook } from "./whatsappWebhook";
import {
  beginInboundMessage,
  markMessageProcessed,
  recordDomainLink,
  recordOutboundReply,
  type MessageLifecycleHandle,
} from "./modules/whatsapp/messageLifecycle";

type SavedMedia = ReturnType<typeof buildSavedMedia>;

type AnnotatedImageResult = {
  url?: string;
  storageKey?: string;
  mimeType?: string;
  buffer?: Buffer;
  skippedReason?: string;
  detail?: string;
};

type PreparedImageMessage = {
  text?: string;
  imageUrl?: string;
  imageAnalysisUrl: string;
  media: SavedMedia[];
  storageWarning?: string;
};

const annotatedImageMessageDeduplicationCache = createMessageDeduplicationCache();
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

function wasAnnotatedImageMessageAlreadyHandled(messageId?: string) {
  return annotatedImageMessageDeduplicationCache.wasAlreadyHandled(messageId);
}

function markAnnotatedImageMessageHandled(messageId?: string) {
  annotatedImageMessageDeduplicationCache.markHandled(messageId);
}

function formatReplyTime(date: Date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
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
  } catch (error) {
    console.warn(
      "[WhatsAppAnnotatedImage] Received media storage failed; continuing with inline image analysis.",
      error instanceof Error ? error.message : error,
    );
    prepared.storageWarning = MEDIA_STORAGE_WARNING;
  }

  return prepared;
}

function buildImageInferenceFallbackResult(input: {
  text?: string;
  imageAnalysisUrl?: string;
  imageUrl?: string;
  occurredAt: Date;
}): MealProcessingResult {
  const sourceText = input.text?.trim() || "Foto enviada pelo WhatsApp";
  const item = {
    foodName: "Refeição fotografada",
    canonicalName: "Refeição fotografada",
    quantity: 1,
    unit: "porção",
    portionText: "1 porção estimada",
    servings: 1,
    estimatedGrams: 100,
    calories: 150,
    protein: 6,
    carbs: 15,
    fat: 5,
    confidence: 0.25,
    source: "heuristic" as const,
  };

  return {
    detectedMealLabel: "Refeição registrada",
    sourceText,
    imageUrl: input.imageAnalysisUrl || input.imageUrl,
    confidence: 0.25,
    needsConfirmation: true,
    reasoning: "A análise visual não conseguiu montar um rascunho confiável; foi criado um item estimado para manter o registro e permitir correção posterior.",
    items: [item],
    totals: {
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    },
  };
}

async function processImageMealInputWithFallback(input: {
  userId: number;
  prepared: PreparedImageMessage;
  occurredAt: Date;
  intentHint?: import("./modules/whatsapp/llmIntentActions").WhatsappLlmNutritionFallback["intentHint"] | null;
}): Promise<MealProcessingResult | null> {
  try {
    return await processMealInput({
      text: input.prepared.text,
      imageUrl: input.prepared.imageAnalysisUrl || input.prepared.imageUrl,
      habits: await getHabitSnapshots(input.userId),
      occurredAt: input.occurredAt,
      timeZone: "America/Sao_Paulo",
      intentHint: input.intentHint ?? undefined,
    });
  } catch (error) {
    if (!(error instanceof MealInferenceError)) {
      throw error;
    }

    console.warn(
      "[WhatsAppAnnotatedImage] Meal image inference returned no reliable items; skipping registration.",
      error.message,
    );
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.image_inference_not_recognized",
      detail: "A imagem foi recebida, mas a IA não identificou alimentos com segurança suficiente. Nenhum registro foi criado.",
    });

    return null;
  }
}

function hasUsableAnnotatedImagePayload(annotatedImage: AnnotatedImageResult) {
  return Boolean(annotatedImage.url || annotatedImage.buffer);
}

function getAnnotatedImageSource(annotatedImage: AnnotatedImageResult) {
  const detail = annotatedImage.detail ?? "";
  if (annotatedImage.skippedReason || /overlay local|fallback local|fallback de classificação|provider de imagem/i.test(detail)) {
    return "fallback_local";
  }

  return "ai_edit";
}

function formatAnnotatedImagePayload(annotatedImage: AnnotatedImageResult) {
  return [
    `skippedReason=${annotatedImage.skippedReason || "none"}`,
    `detail=${annotatedImage.detail || "none"}`,
    `hasUrl=${Boolean(annotatedImage.url)}`,
    `hasBuffer=${Boolean(annotatedImage.buffer)}`,
    `hasStorageKey=${Boolean(annotatedImage.storageKey)}`,
  ].join("; ");
}

function buildAnnotatedImageMedia(annotatedImage: AnnotatedImageResult) {
  if (!hasUsableAnnotatedImagePayload(annotatedImage) || !annotatedImage.url || !annotatedImage.storageKey) {
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

async function sendAnnotatedImageBuffer(input: {
  sourcePhone: string;
  annotatedImage: AnnotatedImageResult;
  caption: string;
}) {
  if (!input.annotatedImage.buffer) {
    return null;
  }

  return sendWhatsAppImageBufferMessage(
    input.sourcePhone,
    {
      buffer: input.annotatedImage.buffer,
      mimeType: input.annotatedImage.mimeType || "image/png",
      fileName: "whatsapp-annotated-meal.png",
    },
    input.caption,
  );
}

async function sendAnnotatedImageToWhatsApp(input: {
  sourcePhone: string;
  annotatedImage: AnnotatedImageResult;
}) {
  const caption = "Imagem anotada com os alimentos identificados.";
  if (!hasUsableAnnotatedImagePayload(input.annotatedImage)) {
    return {
      attempted: false,
      ok: false,
      detail: "Imagem anotada não possui URL nem arquivo local para envio.",
    };
  }

  if (input.annotatedImage.url) {
    const urlResult = await sendWhatsAppImageMessage(input.sourcePhone, input.annotatedImage.url, caption);
    if (urlResult.ok || !input.annotatedImage.buffer) {
      return {
        attempted: true,
        ...urlResult,
      };
    }

    const bufferResult = await sendAnnotatedImageBuffer({
      sourcePhone: input.sourcePhone,
      annotatedImage: input.annotatedImage,
      caption,
    });

    return {
      attempted: true,
      ok: Boolean(bufferResult?.ok),
      detail: bufferResult?.ok
        ? "Envio por URL falhou; imagem enviada por buffer local."
        : `Envio por URL falhou: ${urlResult.detail}. Envio por buffer falhou: ${bufferResult?.detail || "buffer indisponível"}.`,
    };
  }

  const bufferResult = await sendAnnotatedImageBuffer({
    sourcePhone: input.sourcePhone,
    annotatedImage: input.annotatedImage,
    caption,
  });

  if (bufferResult) {
    return {
      attempted: true,
      ...bufferResult,
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
  mealId?: number | null;
  logicalReply?: import("./modules/whatsapp/replyContract").WhatsAppLogicalReply;
  lifecycleHandle?: MessageLifecycleHandle;
}) {
  const delivery = await sendWhatsAppLogicalDomainReply({
    to: input.sourcePhone,
    userId: input.userId,
    replyText: input.reply,
    mealId: input.mealId,
    logicalReply: input.logicalReply,
    lifecycleHandle: input.lifecycleHandle,
  });
  if (!delivery.result.ok) {
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: delivery.result.primaryOk ? "warning" : "error",
      eventType: "whatsapp.reply_failed",
      detail: `Falha ao enviar resposta lógica para ${input.sourcePhone}.`,
    });
  }
}

async function tryHandleAnnotatedImageMessage(
  message: ExtractedWhatsAppWebhookMessage,
  intentHints?: Map<string, import("./modules/whatsapp/llmIntentActions").WhatsappLlmNutritionFallback["intentHint"]>,
) {
  const sourcePhone = message.from || "unknown";
  if (!isWhatsAppMessageForConfiguredChannel(message) || !canHandleAnnotatedImageMessage(message)) {
    return false;
  }

  if (wasAnnotatedImageMessageAlreadyHandled(message.id)) {
    return true;
  }

  let userId: number | null = null;
  let lifecycleHandle: MessageLifecycleHandle = null;

  try {
    userId = await getUserIdByWhatsappPhone(sourcePhone);
    if (!userId) {
      return false;
    }

    lifecycleHandle = await beginInboundMessage({
      userId,
      whatsappConnectionId: null,
      phoneNumber: sourcePhone,
      externalMessageId: message.id,
      contentType: message.audio?.id ? "multimodal" : "image",
      captionText: getTextBody(message) || null,
      occurredAt: resolveWhatsAppMessageOccurredAt(message),
      allowRawContentStorage: true,
    });

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
        lifecycleHandle,
      });
      markAnnotatedImageMessageHandled(message.id);
      return true;
    }

    // Se a legenda da foto for um comando de exclusão (ex: "exclua", "apague"),
    // encaminhar para o handler de texto em vez de processar como alimento.
    const captionText = prepared.text?.trim();
    if (captionText) {
      const deleteResult = await executeWhatsappDeleteIntent(userId, { text: captionText });
      if (deleteResult) {
        await sendAnnotatedImageFallbackText({
          userId,
          sourcePhone,
          reply: deleteResult.reply,
          mealId: deleteResult.action === "meal_deleted" ? null : typeof deleteResult.data?.mealId === "number" ? deleteResult.data.mealId : null,
          logicalReply: deleteResult.interactiveReply,
          lifecycleHandle,
        });
        markAnnotatedImageMessageHandled(message.id);
        return true;
      }
    }

    const occurredAt = resolveWhatsAppMessageOccurredAt(message);
    const messageKey = getExtractedWhatsAppMessageKey(message);
    const intentHint = intentHints?.get(messageKey) ?? null;
    const processed = await processImageMealInputWithFallback({
      userId,
      prepared,
      occurredAt,
      intentHint,
    });

    if (!processed) {
      const notRecognizedReply = prepared.text?.trim()
        ? `Não consegui identificar alimentos na imagem com segurança suficiente. Tente descrever o que você comeu em texto para eu registrar corretamente.`
        : `Não consegui identificar alimentos nessa foto. Tente tirar uma foto com melhor iluminação ou descreva o que você comeu em texto.`;
      await sendAnnotatedImageFallbackText({ userId, sourcePhone, reply: notRecognizedReply, lifecycleHandle });
      markAnnotatedImageMessageHandled(message.id);
      return true;
    }

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

    const draft = createPendingMealInference(userId, "whatsapp", processedForPersistence, prepared.media);
    const savedMeal = await confirmPendingMeal({
      draftId: draft.draftId,
      userId,
      mealLabel: processedForPersistence.detectedMealLabel || "Refeição",
      occurredAt: occurredAt.toISOString(),
      notes: prepared.text?.trim() || undefined,
      items: processedForPersistence.items,
    });

    const consolidationResult = await consolidateWhatsAppMealAfterSave(
      {
        listUserMeals,
        updateUserMeal,
        removeUserMeal,
      },
      savedMeal,
    );
    const replyMeal = consolidationResult.meal;
    await recordDomainLink(lifecycleHandle, { mealId: replyMeal.id });

    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.message_processed",
      detail: `Mensagem imagem de ${sourcePhone} processada e refeição ${savedMeal.mealLabel} registrada automaticamente às ${formatReplyTime(occurredAt)}.`,
    });

    const mealReplyText = consolidationResult.action === "updated"
      ? buildWhatsAppConsolidatedMealReplyMessage(replyMeal, {
          registeredAt: occurredAt,
          goalProgress: await getWhatsAppMealGoalProgress(userId, occurredAt),
        })
      : buildWhatsAppMealReplyMessage(processedForPersistence, {
          registeredAt: occurredAt,
          goalProgress: await getWhatsAppMealGoalProgress(userId, occurredAt),
        });
    const auxiliaryImage: WhatsAppAuxiliaryImage | null = annotatedImage.url
      ? { url: annotatedImage.url, caption: "Imagem anotada com os alimentos identificados." }
      : annotatedImage.buffer
        ? { buffer: annotatedImage.buffer, mimeType: annotatedImage.mimeType, fileName: "whatsapp-annotated-meal.png", caption: "Imagem anotada com os alimentos identificados." }
        : null;
    const delivery = await sendWhatsAppLogicalDomainReply({
      to: sourcePhone,
      userId,
      replyText: mealReplyText,
      mealId: replyMeal.id,
      auxiliaryImage,
      lifecycleHandle,
    });

    const imageSource = getAnnotatedImageSource(annotatedImage);
    if (!delivery.result.primaryOk) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "error",
        eventType: "whatsapp.reply_failed",
        detail: `Falha ao enviar resposta funcional de refeição para ${sourcePhone}.`,
      });
    } else if (auxiliaryImage && !delivery.result.ok) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.annotated_image_reply_failed",
        detail: `Resposta nutricional enviada, mas a imagem auxiliar falhou. origem=${imageSource}; ${formatAnnotatedImagePayload(annotatedImage)}`,
      });
    } else if (auxiliaryImage) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.annotated_image_sent",
        detail: `Imagem anotada enviada para ${sourcePhone}. origem=${imageSource}; ${formatAnnotatedImagePayload(annotatedImage)}`,
      });
    } else {
      const skipDetail = annotatedImage.detail || annotatedImage.skippedReason || "imagem auxiliar indisponível";
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.annotated_image_skipped",
        detail: `Imagem anotada não enviada para ${sourcePhone}: ${skipDetail}. origem=${imageSource}; ${formatAnnotatedImagePayload(annotatedImage)}`,
      });
    }

    markAnnotatedImageMessageHandled(message.id);
    return true;
  } catch (error) {
    console.warn(
      "[WhatsAppAnnotatedImage] Image webhook processing failed.",
      error instanceof Error ? error.message : error,
    );
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
    } else if (userId) {
      await recordOutboundReply(lifecycleHandle, { userId, text: PROCESSING_ERROR_REPLY });
    }

    markAnnotatedImageMessageHandled(message.id);
    return true;
  } finally {
    await markMessageProcessed(lifecycleHandle);
  }
}

export async function handleWhatsAppWebhookWithAnnotatedImages(req: Request, res: Response) {
  const messages = extractWhatsAppWebhookMessages(req.body);
  if (!messages.length) {
    return handleWhatsAppWebhook(req, res);
  }

  const intentHints = (req as any).__intentHints as Map<string, import("./modules/whatsapp/llmIntentActions").WhatsappLlmNutritionFallback["intentHint"]> | undefined;

  const handledMessageKeys = new Set<string>();
  for (const message of messages) {
    const handled = await tryHandleAnnotatedImageMessage(message, intentHints);
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
