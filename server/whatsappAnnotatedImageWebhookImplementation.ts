import { Request, Response } from "express";
import { runWithAiUsageScope } from "./_core/ai/usageContext";
import {
  buildSavedMedia,
  confirmPendingMeal,
  createPendingMealInference,
  createUserWaterLog,
  getHabitSnapshots,
  getUserIdByWhatsappPhone,
  listUserMeals,
  logInferenceEvent,
  removeUserMeal,
  removeUserWaterLog,
  updateUserMeal,
} from "./db";
import { executeWhatsappDeleteIntent } from "./modules/whatsapp/deleteIntent";
import { generateAnnotatedMealImage } from "./modules/whatsapp/annotatedImage";
import { getAnnotatedImagePreference } from "./modules/whatsapp/annotatedImagePreference";
import { getWhatsAppMealGoalProgress } from "./modules/whatsapp/goalProgressService";
import { resolveWhatsAppOperationTimeZone } from "./modules/whatsapp/timeZoneContext";
import { createMessageDeduplicationCache } from "./modules/whatsapp/messageDeduplicationCache";
import { consolidateWhatsAppMealAfterSave } from "./modules/whatsapp/mealConsolidationService";
import { requestWhatsappImageMealIdentityClarification } from "./modules/whatsapp/foodQuantityClarification";
import {
  addImageIdentityClarifications,
  buildMealSemanticContract,
} from "./mealSemanticContract";
import {
  inspectWhatsappImageMealItemsPersistence,
  normalizeWhatsappImageMealItemsForPersistence,
} from "./modules/whatsapp/visualMealInferenceValidation";
import {
  buildSuspiciousWhatsAppContentReply,
  inspectWhatsAppUserContentSafety,
} from "./modules/whatsapp/promptInjectionGuard";
import {
  buildWhatsAppConsolidatedMealReplyMessage,
  buildWhatsAppMealReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
  buildWhatsAppWaterVolumeNeededReplyMessage,
} from "./modules/whatsapp/replyMessages";
import { buildWhatsAppCanonicalWaterReply as formatCanonicalWaterReply } from "./modules/whatsapp/domainReplyFormatters";
import { getWhatsAppWaterProgress } from "./modules/whatsapp/userMeasurementReplyContext";
import {
  buildWhatsAppImageNotRecognizedReplyMessage,
  buildWhatsAppImageProcessingFailureReplyMessage,
} from "./modules/whatsapp/mediaReplyMessages";
import {
  assertImageWithinAnalysisBudget,
  normalizeImageForAnalysis,
} from "./modules/whatsapp/imageAnalysisNormalization";
import {
  sendWhatsAppLogicalDomainReply,
  type WhatsAppAuxiliaryImage,
} from "./modules/whatsapp/logicalReplyDelivery";
import {
  startProcessingAcknowledgement,
  type ProcessingAcknowledgementCoordinator,
} from "./modules/whatsapp/processingAcknowledgement";
import { sendWhatsAppProcessingAcknowledgement } from "./modules/whatsapp/processingAcknowledgementDelivery";
import {
  buildMediaDataUrl,
  downloadWhatsAppMedia,
  extensionFromMimeType,
  extractWhatsAppWebhookMessages,
  getExtractedWhatsAppMessageKey,
  isWhatsAppMessageForConfiguredChannel,
  markWhatsAppMessageAsRead,
  resolveWhatsAppMessageOccurredAt,
  type ExtractedWhatsAppWebhookMessage,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";
import {
  MealInferenceError,
  processMealInput,
  type MealProcessingResult,
} from "./nutritionEngine";
import { calculateMealTotals } from "../shared/mealTotals";
import { storagePut } from "./storage";
import { logRuntimeMemoryOperation } from "./_core/runtimeMemoryOperationTelemetry";
import { handleWhatsAppWebhook } from "./whatsappWebhook";
import { splitMealItemsForWaterHydration } from "./modules/whatsapp/waterItemClassification";
import {
  isNutritionLabelPhotoRequestTarget,
  listActiveNutritionLabelPhotoRequests,
  resolveNutritionLabelPhotoEvidence,
} from "./nutritionLabelCandidateService";
import {
  beginInboundMessage,
  claimMessageForProcessingState,
  markMessageProcessed,
  recordDomainLink,
  removeDomainLinksForMessage,
  releaseMessageForRetry,
  wasMessageAlreadyProcessed,
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

type ImageMealProcessingOutcome =
  | { meal: MealProcessingResult }
  | { error: MealInferenceError };

const annotatedImageMessageDeduplicationCache =
  createMessageDeduplicationCache();
const MEDIA_STORAGE_WARNING =
  "Falha ao persistir mídia recebida do WhatsApp; processamento seguirá com mídia inline.";
const ANNOTATED_IMAGE_UNAVAILABLE_REPLY =
  "A refeição foi registrada, mas não consegui gerar a imagem anotada agora. Você já pode acompanhar o resumo nutricional acima.";
const ANNOTATED_IMAGE_SEND_FAILED_REPLY =
  "A refeição foi registrada, mas não consegui enviar a imagem anotada agora. Você já pode acompanhar o resumo nutricional acima.";

function formatWhatsAppOccurredAt(occurredAt: Date, timeZone: string) {
  return occurredAt.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

async function buildCanonicalWaterReply(
  userId: number,
  amountMl: number,
  occurredAt: Date,
  timeZone: string
) {
  const progress = await getWhatsAppWaterProgress(userId, occurredAt, timeZone);
  return formatCanonicalWaterReply({
    amountMl,
    totalMl: progress.totalMl,
    goalMl: progress.goalMl,
    occurredAtLabel: formatWhatsAppOccurredAt(occurredAt, progress.timeZone),
    totalLabel:
      progress.dateKey ===
      new Date().toLocaleDateString("en-CA", { timeZone: progress.timeZone })
        ? "Total de hoje"
        : `Total de ${progress.dateKey.split("-").reverse().join("/")}`,
  });
}

async function persistImageWaterLog(input: {
  userId: number;
  amountMl: number;
  occurredAt: Date;
  lifecycleHandle: MessageLifecycleHandle;
}) {
  const createdWaterLog = await createUserWaterLog(input.userId, {
    amountMl: input.amountMl,
    occurredAt: input.occurredAt.toISOString(),
  });
  await recordDomainLink(input.lifecycleHandle, {
    waterLogId: createdWaterLog.id,
  });
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: "success",
    eventType: "whatsapp.water_logged",
    detail: "Consumo de água identificado em imagem e registrado pelo WhatsApp.",
  });
  return createdWaterLog.id;
}

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

function forgetAnnotatedImageMessageHandled(messageId?: string) {
  annotatedImageMessageDeduplicationCache.forget(messageId);
}

export function __resetWhatsAppAnnotatedImageDeduplicationForTests() {
  annotatedImageMessageDeduplicationCache.clear();
}

async function prepareImageMessage(
  message: WhatsAppWebhookMessage,
  sourcePhone: string
): Promise<PreparedImageMessage> {
  const imageId = message.image?.id;
  if (!imageId) {
    throw new Error("Mensagem sem imagem para processamento anotado.");
  }

  logRuntimeMemoryOperation({
    operation: "whatsapp.annotated_image",
    stage: "download:start",
    correlationValue: imageId,
    always: true,
  });
  const downloaded = await downloadWhatsAppMedia(
    imageId,
    message.image?.mime_type
  );
  const originalByteLength = downloaded.buffer.byteLength;
  await assertImageWithinAnalysisBudget(
    downloaded.buffer,
    downloaded.mimeType,
  );
  logRuntimeMemoryOperation({
    operation: "whatsapp.annotated_image",
    stage: "download:end",
    correlationValue: imageId,
    metrics: { byteLength: originalByteLength },
    always: true,
  });

  const extension = extensionFromMimeType(downloaded.mimeType);
  const fileName = `${sourcePhone}-${imageId}.${extension}`;
  const prepared: PreparedImageMessage = {
    text: getTextBody(message) || undefined,
    imageAnalysisUrl: "",
    media: [],
  };

  logRuntimeMemoryOperation({
    operation: "whatsapp.annotated_image",
    stage: "storage:start",
    correlationValue: imageId,
    metrics: { byteLength: originalByteLength },
    always: true,
  });
  try {
    const stored = await storagePut(
      `whatsapp/image/${fileName}`,
      downloaded.buffer,
      downloaded.mimeType
    );
    const savedMedia = buildSavedMedia({
      mediaType: "image",
      storageKey: stored.key,
      storageUrl: stored.url,
      mimeType: downloaded.mimeType,
      originalFileName: fileName,
    });
    prepared.media.push(savedMedia);
    prepared.imageUrl = savedMedia.storageUrl;
    logRuntimeMemoryOperation({
      operation: "whatsapp.annotated_image",
      stage: "storage:end",
      correlationValue: imageId,
      metrics: { byteLength: originalByteLength, storageOk: true },
      always: true,
    });
  } catch (error) {
    console.warn(
      "[WhatsAppAnnotatedImage] Received media storage failed; continuing with inline image analysis.",
      error instanceof Error ? error.message : error
    );
    prepared.storageWarning = MEDIA_STORAGE_WARNING;
    logRuntimeMemoryOperation({
      operation: "whatsapp.annotated_image",
      stage: "storage:end",
      correlationValue: imageId,
      metrics: { byteLength: originalByteLength, storageOk: false },
      always: true,
    });
  }

  logRuntimeMemoryOperation({
    operation: "whatsapp.annotated_image",
    stage: "normalize:start",
    correlationValue: imageId,
    metrics: { byteLength: originalByteLength },
    always: true,
  });
  const analysisImage = await normalizeImageForAnalysis(
    downloaded.buffer,
    downloaded.mimeType,
  );
  logRuntimeMemoryOperation({
    operation: "whatsapp.annotated_image",
    stage: "normalize:end",
    correlationValue: imageId,
    metrics: {
      inputBytes: originalByteLength,
      analysisBytes: analysisImage.buffer.byteLength,
      normalized: analysisImage.normalized,
    },
    always: true,
  });
  logRuntimeMemoryOperation({
    operation: "whatsapp.annotated_image",
    stage: "base64:start",
    correlationValue: imageId,
    metrics: { analysisBytes: analysisImage.buffer.byteLength },
    always: true,
  });
  prepared.imageAnalysisUrl = buildMediaDataUrl(
    analysisImage.buffer,
    analysisImage.mimeType,
  );
  logRuntimeMemoryOperation({
    operation: "whatsapp.annotated_image",
    stage: "base64:end",
    correlationValue: imageId,
    metrics: {
      analysisBytes: analysisImage.buffer.byteLength,
      dataUrlChars: prepared.imageAnalysisUrl.length,
    },
    always: true,
  });

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
    reasoning:
      "A análise visual não conseguiu montar um rascunho confiável; foi criado um item estimado para manter o registro e permitir correção posterior.",
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
  intentHint?:
    | import("./modules/whatsapp/llmIntentActions").WhatsappLlmNutritionFallback["intentHint"]
    | null;
  nutritionLabelIdentityContext?:
    | import("./nutritionEngineTypes").NutritionLabelIdentityContext
    | null;
  userTimezone: string;
}): Promise<ImageMealProcessingOutcome> {
  const correlationValue =
    input.prepared.media[0]?.storageKey ?? input.prepared.imageUrl ?? "inline-image";
  logRuntimeMemoryOperation({
    operation: "whatsapp.annotated_image",
    stage: "inference:start",
    correlationValue,
    metrics: { hasImage: Boolean(input.prepared.imageAnalysisUrl || input.prepared.imageUrl) },
    always: true,
  });
  try {
    const meal = await runWithAiUsageScope({ userId: input.userId }, async () =>
      processMealInput({
          text: input.prepared.text,
          imageUrl: input.prepared.imageAnalysisUrl || input.prepared.imageUrl,
          habits: await getHabitSnapshots(input.userId),
          occurredAt: input.occurredAt,
          timeZone: input.userTimezone,
          intentHint: input.intentHint ?? undefined,
          nutritionLabelIdentityContext: input.nutritionLabelIdentityContext,
        })
      );
    logRuntimeMemoryOperation({
      operation: "whatsapp.annotated_image",
      stage: "inference:end",
      correlationValue,
      metrics: { inferenceOk: true },
      always: true,
    });
    return { meal };
  } catch (error) {
    logRuntimeMemoryOperation({
      operation: "whatsapp.annotated_image",
      stage: "inference:end",
      correlationValue,
      metrics: { inferenceOk: false },
      always: true,
    });
    if (!(error instanceof MealInferenceError)) {
      throw error;
    }

    console.warn(
      "[WhatsAppAnnotatedImage] Meal image inference returned no reliable items; skipping registration.",
      error.message
    );
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.image_inference_not_recognized",
      detail:
        "A imagem foi recebida, mas a IA não identificou alimentos com segurança suficiente. Nenhum registro foi criado.",
    });

    return { error };
  }
}

function buildImageInferenceFailureReply(error: MealInferenceError) {
  if (
    (error.code === "food_identity_clarification_required" ||
      error.code === "image_identity_unresolved") &&
    error.message.trim()
  ) {
    const prefix = error.code === "image_identity_unresolved"
      ? "Não consegui identificar com segurança um item da imagem."
      : "Identifiquei um produto na imagem, mas ainda não consegui confirmar a variante/nutrição com segurança.";
    return buildWhatsAppRecoverableErrorReplyMessage(
      `${prefix} ${error.message.trim()}`
    );
  }

  return buildWhatsAppImageNotRecognizedReplyMessage();
}

function hasUsableAnnotatedImagePayload(annotatedImage: AnnotatedImageResult) {
  return Boolean(annotatedImage.url || annotatedImage.buffer);
}

function getAnnotatedImageSource(annotatedImage: AnnotatedImageResult) {
  const detail = annotatedImage.detail ?? "";
  if (
    annotatedImage.skippedReason ||
    /overlay local|fallback local|fallback de classificação|provider de imagem/i.test(
      detail
    )
  ) {
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
  if (
    !hasUsableAnnotatedImagePayload(annotatedImage) ||
    !annotatedImage.url ||
    !annotatedImage.storageKey
  ) {
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

function clonePayloadWithoutHandledMessages(
  payload: any,
  handledMessageKeys: Set<string>
) {
  const cloned = structuredClone(payload);
  const entries = Array.isArray(cloned?.entry) ? cloned.entry : [];
  cloned.entry = entries
    .map((entry: any, entryIndex: number) => {
      if (!Array.isArray(entry?.changes)) {
        return entry;
      }

      const changes = entry.changes
        .map((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages)
            ? change.value.messages
            : [];
          const pendingMessages = messages.filter(
            (_message: WhatsAppWebhookMessage, messageIndex: number) =>
              !handledMessageKeys.has(
                getExtractedWhatsAppMessageKey({
                  entryIndex,
                  changeIndex,
                  messageIndex,
                })
              )
          );
          return {
            ...change,
            value: {
              ...change.value,
              messages: pendingMessages,
            },
          };
        })
        .filter(
          (change: any) =>
            Array.isArray(change?.value?.messages) &&
            change.value.messages.length > 0
        );

      return {
        ...entry,
        changes,
      };
    })
    .filter(
      (entry: any) => Array.isArray(entry?.changes) && entry.changes.length > 0
    );

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
  response?: Response;
  acknowledgement?: ProcessingAcknowledgementCoordinator | null;
  rollback?: () => Promise<void>;
  onPrimaryDelivered?: () => void;
}): Promise<boolean> {
  await input.acknowledgement?.beforeFinalReply();
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
      detail: "Falha ao enviar resposta lógica do WhatsApp.",
    });
  }
  if (!delivery.result.primaryOk) {
    try {
      await input.rollback?.();
    } catch (error) {
      logInferenceEvent({
        userId: input.userId,
        origin: "whatsapp",
        status: "error",
        eventType: "whatsapp.domain_effect_rollback_failed",
        detail:
          error instanceof Error
            ? error.message
            : "Falha ao compensar efeitos de domínio.",
      });
    }
    await releaseMessageForRetry(input.lifecycleHandle ?? null);
    input.response?.status(503).json({
      ok: false,
      retryable: true,
      reason: "whatsapp_reply_delivery_failed",
    });
    return false;
  }
  input.onPrimaryDelivered?.();
  await markMessageProcessed(input.lifecycleHandle ?? null);
  return true;
}

async function tryHandleAnnotatedImageMessage(
  message: ExtractedWhatsAppWebhookMessage,
  intentHints?: Map<
    string,
    import("./modules/whatsapp/llmIntentActions").WhatsappLlmNutritionFallback["intentHint"]
  >,
  res?: Response,
) {
  const sourcePhone = message.from || "unknown";
  if (
    !isWhatsAppMessageForConfiguredChannel(message) ||
    !canHandleAnnotatedImageMessage(message)
  ) {
    return false;
  }

  let userId: number | null = null;
  let lifecycleHandle: MessageLifecycleHandle = null;
  let acknowledgement: ProcessingAcknowledgementCoordinator | null = null;
  let createdWaterLogId: number | undefined;
  let savedMealId: number | undefined;
  let consolidationResult:
    | Awaited<ReturnType<typeof consolidateWhatsAppMealAfterSave>>
    | undefined;
  let domainEffectsCommitted = false;
  const rollbackImageDomainEffects = async () => {
    if (domainEffectsCommitted || (!createdWaterLogId && !savedMealId)) {
      return;
    }

    let rollbackFailed = false;
    const compensate = async (detail: string, action: () => Promise<unknown>) => {
      try {
        await action();
      } catch {
        rollbackFailed = true;
        logInferenceEvent({
          userId: userId ?? 0,
          origin: "whatsapp",
          status: "error",
          eventType: "whatsapp.domain_effect_rollback_failed",
          detail,
        });
      }
    };

    if (consolidationResult?.action === "updated") {
      const previousMeal = consolidationResult.previousMeal;
      await compensate("Falha ao restaurar a refeição anterior após erro de imagem.", () =>
        updateUserMeal({
          userId: previousMeal.userId,
          mealId: previousMeal.id,
          mealLabel: previousMeal.mealLabel,
          occurredAt: new Date(previousMeal.occurredAt).toISOString(),
          notes: previousMeal.notes,
          items: previousMeal.items,
        })
      );
    }
    if (savedMealId !== undefined && consolidationResult?.action !== "updated") {
      await compensate("Falha ao remover a refeição transitória após erro de imagem.", () =>
        removeUserMeal(userId!, savedMealId!)
      );
    }
    if (createdWaterLogId !== undefined) {
      await compensate("Falha ao remover a hidratação parcial após erro de imagem.", () =>
        removeUserWaterLog(userId!, createdWaterLogId!)
      );
    }
    await compensate("Falha ao limpar vínculos parciais do lifecycle da imagem.", () =>
      removeDomainLinksForMessage(lifecycleHandle)
    );
    if (!rollbackFailed) {
      domainEffectsCommitted = true;
    }
  };

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

    if (await wasMessageAlreadyProcessed(lifecycleHandle)) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.idempotency.processed_duplicate",
        detail: "Reentrega de imagem ignorada após efeito ou resposta persistida.",
      });
      return true;
    }

    const claimStatus = await claimMessageForProcessingState(lifecycleHandle);
    if (claimStatus === "inflight" || claimStatus === "unavailable") {
      res?.status(503).json({
        ok: false,
        retryable: true,
        reason:
          claimStatus === "inflight"
            ? "message_processing_inflight"
            : "message_processing_unavailable",
      });
      return true;
    }
    if (claimStatus === "processed") {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.idempotency.processed_duplicate",
        detail: "Reentrega de imagem ignorada após claim persistente concluído.",
      });
      return true;
    }

    const timeZoneResolution = await resolveWhatsAppOperationTimeZone(userId);
    const userTimezone = timeZoneResolution.timeZone;

    const readResult = await markWhatsAppMessageAsRead(message.id);
    if (!readResult.ok) {
      await logWhatsAppOperationWarning({
        userId,
        eventType: "whatsapp.read_receipt_failed",
        detail: readResult.detail,
      });
    }

    acknowledgement = startProcessingAcknowledgement({
      send: () =>
        sendWhatsAppProcessingAcknowledgement(
          sourcePhone,
          "Recebi sua imagem e estou processando."
        ),
      onFailure: detail =>
        logWhatsAppOperationWarning({
          userId: userId!,
          eventType: "whatsapp.processing_ack_failed",
          detail,
        }),
    });

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

    const captionSafety = inspectWhatsAppUserContentSafety(
      prepared.text,
      "image_caption"
    );
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
        response: res,
        acknowledgement,
      });
      markAnnotatedImageMessageHandled(message.id);
      return true;
    }

    // Se a legenda da foto for um comando de exclusão (ex: "exclua", "apague"),
    // encaminhar para o handler de texto em vez de processar como alimento.
    const captionText = prepared.text?.trim();
    if (captionText) {
      const deleteResult = await executeWhatsappDeleteIntent(userId, {
        text: captionText,
        timeZone: userTimezone,
      });
      if (deleteResult) {
        await sendAnnotatedImageFallbackText({
          userId,
          sourcePhone,
          reply: deleteResult.reply,
          mealId:
            deleteResult.action === "meal_deleted"
              ? null
              : typeof deleteResult.data?.mealId === "number"
                ? deleteResult.data.mealId
                : null,
          logicalReply: deleteResult.interactiveReply,
          lifecycleHandle,
          response: res,
          acknowledgement,
        });
        markAnnotatedImageMessageHandled(message.id);
        return true;
      }
    }

    const occurredAt = resolveWhatsAppMessageOccurredAt(message);
    const messageKey = getExtractedWhatsAppMessageKey(message);
    const intentHint = intentHints?.get(messageKey) ?? null;
    const activeNutritionLabelRequests = message.image?.id
      ? await listActiveNutritionLabelPhotoRequests(userId)
      : [];
    const nutritionLabelIdentityContext =
      activeNutritionLabelRequests.length === 1 &&
      isNutritionLabelPhotoRequestTarget(
        activeNutritionLabelRequests[0]?.target
      )
        ? activeNutritionLabelRequests[0].target
        : null;
    const processingOutcome = await processImageMealInputWithFallback({
      userId,
      prepared,
      occurredAt,
      intentHint,
      nutritionLabelIdentityContext,
      userTimezone,
    });

    if ("error" in processingOutcome) {
      const identityError = processingOutcome.error;
      const inferenceContext = identityError.context;
      const nutritionLabelResult = await resolveNutritionLabelPhotoEvidence({
        userId,
        item:
          inferenceContext?.items?.find(
            item => item.resolution?.nutritionOrigin === "nutrition_label"
          ) ??
          inferenceContext?.items?.[0] ??
          null,
        sourceText: inferenceContext?.originalText ?? prepared.text ?? null,
        captionText: message.image?.caption ?? null,
        sourceMessageId: message.id,
        evidence:
          prepared.media.find(media => media.mediaType === "image") ?? null,
      });
      if (nutritionLabelResult.handled) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: nutritionLabelResult.action.includes("failed")
            ? "warning"
            : "success",
          eventType: nutritionLabelResult.eventType,
          detail: nutritionLabelResult.detail,
        });
        await sendAnnotatedImageFallbackText({
          userId,
          sourcePhone,
          reply: nutritionLabelResult.reply,
          lifecycleHandle,
          response: res,
          acknowledgement,
        });
        markAnnotatedImageMessageHandled(message.id);
        return true;
      }

      const errorWaterSplit = splitMealItemsForWaterHydration(
        inferenceContext?.items ?? []
      );
      if (errorWaterSplit.remainingItems.length === 0) {
        if (errorWaterSplit.waterVolumeMl > 0) {
          createdWaterLogId = await persistImageWaterLog({
            userId,
            amountMl: errorWaterSplit.waterVolumeMl,
            occurredAt,
            lifecycleHandle,
          });
          await sendAnnotatedImageFallbackText({
            userId,
            sourcePhone,
            reply: await buildCanonicalWaterReply(
              userId,
              errorWaterSplit.waterVolumeMl,
              occurredAt,
              userTimezone
            ),
            lifecycleHandle,
            response: res,
            acknowledgement,
            rollback: rollbackImageDomainEffects,
            onPrimaryDelivered: () => {
              domainEffectsCommitted = true;
            },
          });
          markAnnotatedImageMessageHandled(message.id);
          return true;
        }
        if (errorWaterSplit.hasWaterWithoutVolume) {
          await sendAnnotatedImageFallbackText({
            userId,
            sourcePhone,
            reply: buildWhatsAppWaterVolumeNeededReplyMessage(),
            lifecycleHandle,
            response: res,
            acknowledgement,
          });
          markAnnotatedImageMessageHandled(message.id);
          return true;
        }
      }

      const identityContext =
        identityError.code === "food_identity_clarification_required"
          ? identityError.context
          : null;
      const identityIndexes = identityContext?.semanticContract?.clarifications
        .filter(clarification =>
          clarification.code === "commercial_identity_unverified" ||
          clarification.code === "commercial_nutrition_unverified" ||
          clarification.code === "brand_variant_unresolved"
        )
        .map(clarification => clarification.itemIndex)
        .filter(index => Number.isInteger(index)) ?? [];
      if (
        identityContext?.semanticContract &&
        identityContext.items?.length &&
        identityIndexes.length
      ) {
        const identityResult = await requestWhatsappImageMealIdentityClarification({
          userId,
          detectedMealLabel: identityContext.detectedMealLabel || "Refeição",
          sourceText: identityContext.originalText ?? getTextBody(message),
          transcript: undefined,
          reasoning: identityContext.reasoning || "A identidade comercial foi preservada para continuação textual.",
          confidence: identityContext.confidence ?? 0.6,
          occurredAt,
          items: identityContext.items,
          semanticContract: identityContext.semanticContract,
          media: prepared.media,
          pendingItemIndexes: identityIndexes,
          currentItemIndex: identityIndexes[0],
          messageId: message.id,
          instructionText: identityError.message,
        });
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: identityResult.action === "food_clarification_requested" ? "warning" : "error",
          eventType: identityResult.eventType,
          detail: identityResult.detail,
        });
        await sendAnnotatedImageFallbackText({
          userId,
          sourcePhone,
          reply: identityResult.reply,
          lifecycleHandle,
          response: res,
          acknowledgement,
          rollback: rollbackImageDomainEffects,
          onPrimaryDelivered: () => {
            domainEffectsCommitted = true;
          },
        });
        markAnnotatedImageMessageHandled(message.id);
        return true;
      }
      await sendAnnotatedImageFallbackText({
        userId,
        sourcePhone,
        reply: buildImageInferenceFailureReply(processingOutcome.error),
        lifecycleHandle,
        response: res,
        acknowledgement,
      });
      markAnnotatedImageMessageHandled(message.id);
      return true;
    }

    const processed = processingOutcome.meal;
    const nutritionLabelResult = await resolveNutritionLabelPhotoEvidence({
      userId,
      item:
        processed.items.find(
          item => item.resolution?.nutritionOrigin === "nutrition_label"
        ) ??
        processed.items[0] ??
        null,
      sourceText: processed.sourceText ?? prepared.text ?? null,
      captionText: message.image?.caption ?? null,
      sourceMessageId: message.id,
      evidence:
        prepared.media.find(media => media.mediaType === "image") ?? null,
    });
    if (nutritionLabelResult.handled) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: nutritionLabelResult.action.includes("failed")
          ? "warning"
          : "success",
        eventType: nutritionLabelResult.eventType,
        detail: nutritionLabelResult.detail,
      });
      await sendAnnotatedImageFallbackText({
        userId,
        sourcePhone,
        reply: nutritionLabelResult.reply,
        lifecycleHandle,
        response: res,
        acknowledgement,
      });
      markAnnotatedImageMessageHandled(message.id);
      return true;
    }

    const waterSplit = splitMealItemsForWaterHydration(processed.items);
    let waterReplyPrefix = "";
    const detectedWater =
      waterSplit.waterVolumeMl > 0 || waterSplit.hasWaterWithoutVolume;
    if (detectedWater) {
      if (waterSplit.waterVolumeMl > 0) {
        createdWaterLogId = await persistImageWaterLog({
          userId,
          amountMl: waterSplit.waterVolumeMl,
          occurredAt,
          lifecycleHandle,
        });
        if (waterSplit.remainingItems.length > 0) {
          waterReplyPrefix = `${await buildCanonicalWaterReply(
            userId,
            waterSplit.waterVolumeMl,
            occurredAt,
            userTimezone
          )}\n\n`;
        }
      }
      processed.items = normalizeWhatsappImageMealItemsForPersistence(
        waterSplit.remainingItems
      );
      processed.totals = calculateMealTotals(processed.items);
      processed.semanticContract = buildMealSemanticContract({
        processingInput: {
          text: processed.sourceText,
          imageUrl: processed.imageUrl,
          occurredAt,
          timeZone: userTimezone,
        },
        sourceText: processed.sourceText,
        items: processed.items,
      });
      if (!waterSplit.remainingItems.length) {
        if (waterSplit.waterVolumeMl > 0) {
          await sendAnnotatedImageFallbackText({
            userId,
            sourcePhone,
            reply: await buildCanonicalWaterReply(
              userId,
              waterSplit.waterVolumeMl,
              occurredAt,
              userTimezone
            ),
            lifecycleHandle,
            response: res,
            acknowledgement,
            rollback: rollbackImageDomainEffects,
            onPrimaryDelivered: () => {
              domainEffectsCommitted = true;
            },
          });
        } else {
          await sendAnnotatedImageFallbackText({
            userId,
            sourcePhone,
            reply: buildWhatsAppWaterVolumeNeededReplyMessage(),
            lifecycleHandle,
            response: res,
            acknowledgement,
          });
        }
        markAnnotatedImageMessageHandled(message.id);
        return true;
      }
    }

    processed.items = normalizeWhatsappImageMealItemsForPersistence(processed.items);
    const imagePersistence = inspectWhatsappImageMealItemsPersistence(processed.items);
    if (imagePersistence.status === "missing_identity") {
      if (
        imagePersistence.itemIndexes.length > 0 &&
        imagePersistence.itemIndexes.length < processed.items.length
      ) {
        const semanticContract = addImageIdentityClarifications({
          contract: processed.semanticContract ?? buildMealSemanticContract({
            processingInput: {
              text: processed.sourceText,
              imageUrl: prepared.imageAnalysisUrl || prepared.imageUrl,
              occurredAt,
              timeZone: userTimezone,
            },
            sourceText: processed.sourceText,
            items: processed.items,
          }),
          items: processed.items,
          itemIndexes: imagePersistence.itemIndexes,
        });
        const identityResult = await requestWhatsappImageMealIdentityClarification({
          userId,
          detectedMealLabel: processed.detectedMealLabel || "Refeição",
          sourceText: processed.sourceText,
          reasoning: processed.reasoning,
          confidence: processed.confidence,
          occurredAt,
          items: processed.items,
          semanticContract,
          media: prepared.media,
          pendingItemIndexes: imagePersistence.itemIndexes,
          currentItemIndex: imagePersistence.itemIndexes[0],
          messageId: message.id,
          instructionText: semanticContract.clarifications.find(
            clarification => clarification.itemIndex === imagePersistence.itemIndexes[0]
          )?.message,
        });
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: identityResult.action === "food_clarification_requested" ? "warning" : "error",
          eventType: identityResult.eventType,
          detail: identityResult.detail,
        });
        await sendAnnotatedImageFallbackText({
          userId,
          sourcePhone,
          reply: identityResult.reply,
          lifecycleHandle,
          response: res,
          acknowledgement,
        });
        markAnnotatedImageMessageHandled(message.id);
        return true;
      }

      await sendAnnotatedImageFallbackText({
        userId,
        sourcePhone,
        reply: buildWhatsAppImageNotRecognizedReplyMessage(),
        lifecycleHandle,
        response: res,
        acknowledgement,
        rollback: rollbackImageDomainEffects,
        onPrimaryDelivered: () => {
          domainEffectsCommitted = true;
        },
      });
      markAnnotatedImageMessageHandled(message.id);
      return true;
    }

    const processedForPersistence = {
      ...processed,
      imageUrl: prepared.imageUrl,
    };

    const annotatedImagePreference = await getAnnotatedImagePreference(userId);
    const annotatedImage: AnnotatedImageResult =
      annotatedImagePreference.enabled
        ? await generateAnnotatedMealImage(
            processedForPersistence,
            prepared.imageAnalysisUrl
          )
        : {};
    const annotatedMedia = buildAnnotatedImageMedia(annotatedImage);
    if (annotatedMedia) {
      prepared.media.push(annotatedMedia);
    } else if (annotatedImage.url) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.annotated_image_not_persisted",
        detail:
          "Imagem anotada gerada sem chave de storage; envio ao WhatsApp será tentado, mas a mídia não foi vinculada à refeição.",
      });
    }

    const draft = createPendingMealInference(
      userId,
      "whatsapp",
      processedForPersistence,
      prepared.media
    );
    const savedMeal = await confirmPendingMeal({
      draftId: draft.draftId,
      userId,
      mealLabel: processedForPersistence.detectedMealLabel || "Refeição",
      occurredAt: occurredAt.toISOString(),
      notes: getTextBody(message) || undefined,
      items: processedForPersistence.items,
    });
    savedMealId = savedMeal.id;

    consolidationResult = await consolidateWhatsAppMealAfterSave(
      {
        listUserMeals,
        updateUserMeal,
        removeUserMeal,
      },
      savedMeal,
      userTimezone
    );
    const replyMeal = consolidationResult.meal;
    await recordDomainLink(lifecycleHandle, { mealId: replyMeal.id });

    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.message_processed",
      detail:
        "Imagem processada e refeição registrada automaticamente pelo WhatsApp.",
    });

    const persistedReplyInput: MealProcessingResult = {
      ...processedForPersistence,
      detectedMealLabel: replyMeal.mealLabel,
      items: replyMeal.items ?? [],
      totals: calculateMealTotals(replyMeal.items ?? []),
    };
    const goalProgress = await getWhatsAppMealGoalProgress(
      userId,
      occurredAt,
      userTimezone
    );
    const mealReplyBody =
      consolidationResult.action === "updated"
        ? buildWhatsAppConsolidatedMealReplyMessage(replyMeal, {
            registeredAt: occurredAt,
            goalProgress,
            timeZone: userTimezone,
          })
        : buildWhatsAppMealReplyMessage(persistedReplyInput, {
            registeredAt: occurredAt,
            goalProgress,
            timeZone: userTimezone,
          });
    const mealReplyText = `${waterReplyPrefix}${mealReplyBody}`;
    const auxiliaryImage: WhatsAppAuxiliaryImage | null = annotatedImage.url
      ? {
          url: annotatedImage.url,
          caption: "Imagem anotada com os alimentos identificados.",
        }
      : annotatedImage.buffer
        ? {
            buffer: annotatedImage.buffer,
            mimeType: annotatedImage.mimeType,
            fileName: "whatsapp-annotated-meal.png",
            caption: "Imagem anotada com os alimentos identificados.",
          }
        : null;
    await acknowledgement.beforeFinalReply();
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
        detail: "Falha ao enviar resposta funcional de refeição pelo WhatsApp.",
      });
      await rollbackImageDomainEffects();
      await releaseMessageForRetry(lifecycleHandle);
      res?.status(503).json({
        ok: false,
        retryable: true,
        reason: "whatsapp_reply_delivery_failed",
      });
      return true;
    } else if (auxiliaryImage && !delivery.result.ok) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.annotated_image_reply_failed",
        detail: `Resposta nutricional enviada, mas a imagem auxiliar falhou. origem=${imageSource}.`,
      });
    } else if (auxiliaryImage) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.annotated_image_sent",
        detail: `Imagem anotada enviada pelo WhatsApp. origem=${imageSource}${annotatedImage.skippedReason ? `; skippedReason=${annotatedImage.skippedReason}` : ""}.`,
      });
    } else if (annotatedImagePreference.enabled) {
      const skipDetail =
        annotatedImage.detail ||
        annotatedImage.skippedReason ||
        "imagem auxiliar indisponível";
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.annotated_image_skipped",
        detail: `Imagem anotada não enviada; resposta nutricional preservada. origem=${imageSource}; motivo=${skipDetail}.`,
      });
    }

    domainEffectsCommitted = true;
    await markMessageProcessed(lifecycleHandle);
    return true;
  } catch (error) {
    console.warn(
      "[WhatsAppAnnotatedImage] Image webhook processing failed.",
      error instanceof Error ? error.message : error
    );
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "error",
      eventType: "whatsapp.processing_error",
      detail:
        error instanceof Error
          ? error.message
          : "Falha desconhecida ao processar imagem do WhatsApp.",
    });

    await rollbackImageDomainEffects();
    if (userId) {
      await sendAnnotatedImageFallbackText({
        userId,
        sourcePhone,
        reply: buildWhatsAppImageProcessingFailureReplyMessage(),
        lifecycleHandle,
        response: res,
        acknowledgement,
        rollback: rollbackImageDomainEffects,
        onPrimaryDelivered: () => {
          domainEffectsCommitted = true;
        },
      });
    }

    markAnnotatedImageMessageHandled(message.id);
    return true;
  } finally {
    await acknowledgement?.beforeFinalReply();
  }
}

export async function handleWhatsAppWebhookWithAnnotatedImages(
  req: Request,
  res: Response
) {
  const messages = extractWhatsAppWebhookMessages(req.body);
  if (!messages.length) {
    return handleWhatsAppWebhook(req, res);
  }

  const intentHints = (req as any).__intentHints as
    | Map<
        string,
        import("./modules/whatsapp/llmIntentActions").WhatsappLlmNutritionFallback["intentHint"]
      >
    | undefined;

  const handledMessageKeys = new Set<string>();
  for (const message of messages) {
    const handled = await tryHandleAnnotatedImageMessage(message, intentHints, res);
    if ((res as Response & { statusCode?: number }).statusCode === 503) {
      forgetAnnotatedImageMessageHandled(message.id);
    } else if (handled) {
      handledMessageKeys.add(getExtractedWhatsAppMessageKey(message));
    }
  }

  if ((res as Response & { statusCode?: number }).statusCode === 503 || res.headersSent) {
    return res;
  }

  if (!handledMessageKeys.size) {
    return handleWhatsAppWebhook(req, res);
  }

  const remainingPayload = clonePayloadWithoutHandledMessages(
    req.body,
    handledMessageKeys
  );
  if (
    !Array.isArray(remainingPayload?.entry) ||
    remainingPayload.entry.length === 0
  ) {
    return res.status(200).json({ ok: true, processed: messages.length });
  }

  req.body = remainingPayload;
  return handleWhatsAppWebhook(req, res);
}
