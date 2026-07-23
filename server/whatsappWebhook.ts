import { Request, Response } from "express";
import type { GenerateImageResponse } from "./_core/imageGeneration";
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
  updateUserMeal,
} from "./db";
import { executeWhatsappAiQuestionIntent } from "./modules/whatsapp/aiQuestionAssistant";
import { executeWhatsappTextIntent } from "./modules/whatsapp/intentActions";
import { generateAnnotatedMealImage } from "./modules/whatsapp/annotatedImage";
import { consolidateWhatsAppMealAfterSave } from "./modules/whatsapp/mealConsolidationService";
import {
  buildSuspiciousWhatsAppContentReply,
  inspectWhatsAppUserContentSafety,
  type WhatsAppContentSafetyCheck,
  type WhatsAppUserContentModality,
} from "./modules/whatsapp/promptInjectionGuard";
import { createMessageDeduplicationCache } from "./modules/whatsapp/messageDeduplicationCache";
import { getWhatsAppMealGoalProgress } from "./modules/whatsapp/goalProgressService";
import {
  formatWhatsAppMacro,
  formatWhatsAppReplyTime,
} from "./modules/whatsapp/replyFormatting";
import {
  buildWhatsAppConsolidatedMealReplyMessage,
  buildWhatsAppMealReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
  buildWhatsAppUnlinkedAccountReplyMessage,
  buildWhatsAppWaterVolumeNeededReplyMessage,
} from "./modules/whatsapp/replyMessages";
import {
  buildWhatsAppCanonicalWaterReply as formatCanonicalWaterReply,
  buildWhatsAppCanonicalWeightReply as formatCanonicalWeightReply,
} from "./modules/whatsapp/domainReplyFormatters";
import {
  sendWhatsAppLogicalDomainReply,
  sendWhatsAppStandaloneReply,
  type WhatsAppAuxiliaryImage,
} from "./modules/whatsapp/logicalReplyDelivery";
import {
  composeWhatsAppDeferredReplyText,
  getWhatsAppDeferredLogicalReply,
} from "./modules/whatsapp/deferredLogicalReply";
import {
  startProcessingAcknowledgement,
  type ProcessingAcknowledgementCoordinator,
} from "./modules/whatsapp/processingAcknowledgement";
import { sendWhatsAppProcessingAcknowledgement } from "./modules/whatsapp/processingAcknowledgementDelivery";
import { ensureWhatsAppWeightEntry } from "./modules/whatsapp/weightIdempotency";
import {
  getWhatsAppWaterProgress,
  getWhatsAppWeightVariation,
} from "./modules/whatsapp/userMeasurementReplyContext";
import {
  detectWaterLogFromMessage,
  detectWeightLogFromMessage,
  detectWhatsAppAction,
  handlePendingWhatsAppConfirmation,
  handleWhatsAppAction,
} from "./modules/whatsapp/webhookTextCommands";
import {
  prepareMessageInput,
  type PreparedMessageInput,
} from "./modules/whatsapp/webhookMediaPipeline";
import {
  buildWhatsAppAudioNotUnderstoodReplyMessage,
  buildWhatsAppAudioProcessingFailureReplyMessage,
  buildWhatsAppImageNotRecognizedReplyMessage,
  buildWhatsAppImageProcessingFailureReplyMessage,
} from "./modules/whatsapp/mediaReplyMessages";
import { splitMealItemsForWaterHydration } from "./modules/whatsapp/waterItemClassification";
import { requestWhatsappImageMealQuantityClarification } from "./modules/whatsapp/foodQuantityClarification";
import {
  assertWhatsappImageMealItemsArePersistable,
  getWhatsappImageMissingPortionIndexes,
  inspectWhatsappImageMealItemsPersistence,
  normalizeWhatsappImageMealItemsForPersistence,
} from "./modules/whatsapp/visualMealInferenceValidation";
import {
  extractWhatsAppWebhookMessages,
  isWhatsAppMessageForConfiguredChannel,
  markWhatsAppMessageAsRead,
  resolveWhatsAppMessageOccurredAt,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";
import {
  MealInferenceError,
  MealProcessingResult,
  processMealInput,
} from "./nutritionEngine";
import { getWhatsAppChannelConfig } from "./whatsappConfig";
import { calculateMealTotals } from "../shared/mealTotals";
import { resolveWhatsAppOperationTimeZone } from "./modules/whatsapp/timeZoneContext";
import {
  beginInboundMessage,
  markMessageProcessed,
  recordDomainLink,
  type MessageLifecycleHandle,
} from "./modules/whatsapp/messageLifecycle";

type WhatsAppTextIntentResult = NonNullable<
  Awaited<ReturnType<typeof executeWhatsappTextIntent>>
>;

const whatsAppMessageDeduplicationCache = createMessageDeduplicationCache();

async function resolveUserIdFromPhone(sourcePhone: string) {
  return getUserIdByWhatsappPhone(sourcePhone);
}

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

async function buildCanonicalWeightReply(
  userId: number,
  weightKg: number,
  occurredAt: Date,
  timeZone: string
) {
  const { variationKg } = await getWhatsAppWeightVariation(
    userId,
    occurredAt,
    weightKg
  );
  return formatCanonicalWeightReply({
    weightKg,
    variationKg,
    occurredAtLabel: formatWhatsAppOccurredAt(occurredAt, timeZone),
  });
}

function buildProcessingFailureReply(
  message: WhatsAppWebhookMessage,
  error: unknown
) {
  const notRecognized = error instanceof MealInferenceError;
  if (message.image?.id) {
    return notRecognized
      ? buildWhatsAppImageNotRecognizedReplyMessage()
      : buildWhatsAppImageProcessingFailureReplyMessage();
  }
  if (message.audio?.id) {
    return notRecognized
      ? buildWhatsAppAudioNotUnderstoodReplyMessage()
      : buildWhatsAppAudioProcessingFailureReplyMessage();
  }
  // MealInferenceError carrega uma clarificação de domínio escrita para o
  // usuário (ex.: quantidade inválida); não descartar essa orientação.
  if (
    notRecognized &&
    error instanceof MealInferenceError &&
    error.message.trim()
  ) {
    return buildWhatsAppRecoverableErrorReplyMessage(error.message.trim());
  }
  return buildWhatsAppRecoverableErrorReplyMessage(
    "Não foi possível concluir sua solicitação agora. Tente novamente em alguns instantes."
  );
}

function getVerifyToken() {
  return getWhatsAppChannelConfig().verifyToken;
}

function getPreparedTextModality(
  message: WhatsAppWebhookMessage
): WhatsAppUserContentModality {
  if (message.image?.id && message.audio?.id) return "multimodal";
  if (message.image?.id) return "image_caption";
  if (message.audio?.id) return "multimodal";
  return "text";
}

function inspectPreparedMessageSafety(
  message: WhatsAppWebhookMessage,
  prepared: PreparedMessageInput
) {
  const checks: WhatsAppContentSafetyCheck[] = [];
  if (prepared.text?.trim()) {
    checks.push(
      inspectWhatsAppUserContentSafety(
        prepared.text,
        getPreparedTextModality(message)
      )
    );
  }
  if (prepared.transcript?.trim()) {
    checks.push(
      inspectWhatsAppUserContentSafety(prepared.transcript, "audio_transcript")
    );
  }
  return checks.filter(check => !check.safe);
}

function buildSecurityGuardDetail(unsafeChecks: WhatsAppContentSafetyCheck[]) {
  const categories = Array.from(
    new Set(unsafeChecks.flatMap(check => check.categories))
  );
  const modalities = Array.from(
    new Set(unsafeChecks.map(check => check.modality))
  );
  return `Conteudo bloqueado por seguranca antes da inferencia nutricional: ${categories.join(", ") || "security_guard"}; modalidades: ${modalities.join(", ") || "desconhecida"}.`;
}

function listMessageContentTypes(message: WhatsAppWebhookMessage) {
  const types: string[] = [];
  if (message.text?.body) types.push("texto");
  if (message.image?.id) types.push("imagem");
  if (message.audio?.id) types.push("áudio");
  return types;
}

function formatContentTypeList(types: string[]) {
  if (types.length <= 1) {
    return types[0] || "mensagem";
  }
  if (types.length === 2) {
    return `${types[0]} e ${types[1]}`;
  }
  return `${types.slice(0, -1).join(", ")} e ${types[types.length - 1]}`;
}

function buildProcessingAcknowledgement(message: WhatsAppWebhookMessage) {
  const contentTypes = listMessageContentTypes(message);
  if (contentTypes.length === 1) {
    const contentType = contentTypes[0];
    if (contentType === "imagem") {
      return "Recebi sua imagem e estou processando.";
    }
    if (contentType === "texto") {
      return "Recebi seu texto e estou processando.";
    }
    if (contentType === "áudio") {
      return "Recebi seu áudio e estou processando.";
    }
  }

  const contentLabel = formatContentTypeList(contentTypes);
  return `Recebi seu conteúdo (${contentLabel}) e estou processando.`;
}

async function logWhatsAppOperationWarning(input: {
  userId: number;
  sourcePhone: string;
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

async function sendInterpretedTextIntentReply(input: {
  userId: number;
  sourcePhone: string;
  interpreted: WhatsAppTextIntentResult;
  lifecycleHandle: MessageLifecycleHandle;
  replyText?: string;
}) {
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status:
      input.interpreted.action === "clarification_needed"
        ? "warning"
        : "success",
    eventType: input.interpreted.eventType,
    detail: input.interpreted.detail,
  });

  const mealId =
    typeof input.interpreted.data?.mealId === "number"
      ? input.interpreted.data.mealId
      : null;
  const replyText = input.replyText ?? input.interpreted.reply;
  const delivery = await sendWhatsAppLogicalDomainReply({
    to: input.sourcePhone,
    userId: input.userId,
    replyText,
    mealId,
    logicalReply: input.interpreted.interactiveReply,
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
  if (mealId) {
    await recordDomainLink(input.lifecycleHandle, { mealId });
  }
  await markMessageProcessed(input.lifecycleHandle);
}

function canInterpretAudioTranscriptIntent(
  message: WhatsAppWebhookMessage,
  prepared: PreparedMessageInput
) {
  return Boolean(
    message.audio?.id && !message.image?.id && prepared.transcript?.trim()
  );
}

function isSupportedMessage(message: WhatsAppWebhookMessage) {
  return Boolean(message.text?.body || message.image?.id || message.audio?.id);
}

function reserveWhatsAppMessageForProcessing(messageId?: string) {
  if (!messageId) {
    return true;
  }

  if (whatsAppMessageDeduplicationCache.wasAlreadyHandled(messageId)) {
    return false;
  }

  whatsAppMessageDeduplicationCache.markHandled(messageId);
  return true;
}

export function __resetWhatsAppWebhookDeduplicationForTests() {
  whatsAppMessageDeduplicationCache.clear();
}

export function verifyWhatsAppWebhook(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === getVerifyToken()) {
    return res.status(200).send(challenge);
  }

  return res.status(403).send("Webhook verification failed");
}

export async function handleWhatsAppWebhook(req: Request, res: Response) {
  const messages = extractWhatsAppWebhookMessages(req.body);

  if (!messages.length) {
    return res.status(200).json({ ok: true, processed: 0 });
  }

  for (const message of messages) {
    const sourcePhone = message.from || "unknown";

    if (!reserveWhatsAppMessageForProcessing(message.id)) {
      continue;
    }

    if (!isWhatsAppMessageForConfiguredChannel(message)) {
      logInferenceEvent({
        userId: null,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.unexpected_channel",
        detail: `Mensagem recebida pelo WhatsApp Phone Number ID ${message.channelPhoneNumberId}, diferente do ID fixo configurado para a solução.`,
      });
      continue;
    }

    const userId = await resolveUserIdFromPhone(sourcePhone);

    if (!userId) {
      logInferenceEvent({
        userId: null,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.unlinked_phone",
        detail:
          "Mensagem recebida de telefone sem vínculo ativo com um usuário da plataforma.",
      });
      const delivery = await sendWhatsAppStandaloneReply(
        sourcePhone,
        buildWhatsAppUnlinkedAccountReplyMessage()
      );
      if (!delivery.result.primaryOk) {
        logInferenceEvent({
          userId: null,
          origin: "whatsapp",
          status: "warning",
          eventType: "whatsapp.unlinked_phone_reply_failed",
          detail:
            "Falha ao enviar orientação sanitizada para telefone sem vínculo.",
        });
      }
      continue;
    }

    if (!isSupportedMessage(message)) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.unsupported_message",
        detail: `Mensagem recebida com tipo ${message.type || "desconhecido"} não suportado.`,
      });
      continue;
    }

    const lifecycleHandle = await beginInboundMessage({
      userId,
      whatsappConnectionId: null,
      phoneNumber: sourcePhone,
      externalMessageId: message.id,
      contentType:
        message.image?.id && message.audio?.id
          ? "multimodal"
          : message.image?.id
            ? "image"
            : message.audio?.id
              ? "audio"
              : "text",
      text: message.text?.body ?? null,
      captionText: message.image?.caption ?? null,
      occurredAt: resolveWhatsAppMessageOccurredAt(message),
      allowRawContentStorage: true,
    });
    const deferredReply = getWhatsAppDeferredLogicalReply(req, message.id);
    for (const link of deferredReply?.domainLinks ?? []) {
      await recordDomainLink(lifecycleHandle, link);
    }
    const responsePrefixBlocks = [...(deferredReply?.prefixBlocks ?? [])];
    const composeFinalReply = (reply: string) =>
      composeWhatsAppDeferredReplyText(
        {
          prefixBlocks: responsePrefixBlocks,
          domainLinks: deferredReply?.domainLinks ?? [],
        },
        reply
      );
    let acknowledgement: ProcessingAcknowledgementCoordinator | null = null;
    const sendFinalText = async (reply: string) => {
      await acknowledgement?.beforeFinalReply();
      const finalReply = composeFinalReply(reply);
      const delivery = await sendWhatsAppLogicalDomainReply({
        to: sourcePhone,
        userId,
        replyText: finalReply,
        lifecycleHandle,
      });
      await markMessageProcessed(lifecycleHandle);
      return {
        ok: delivery.result.primaryOk,
        detail:
          delivery.result.sends.find(send => !send.ok)?.detail ??
          "Resposta funcional enviada.",
      };
    };

    const readResult = await markWhatsAppMessageAsRead(message.id);
    if (!readResult.ok) {
      await logWhatsAppOperationWarning({
        userId,
        sourcePhone,
        eventType: "whatsapp.read_receipt_failed",
        detail: readResult.detail,
      });
    }

    try {
      const timeZoneResolution = await resolveWhatsAppOperationTimeZone(userId);
      const userTimezone = timeZoneResolution.timeZone;

      const aiQuestionResult = await executeWhatsappAiQuestionIntent(userId, {
        text: message.text?.body,
        receivedAt: resolveWhatsAppMessageOccurredAt(message),
        userTimezone,
      });
      if (aiQuestionResult) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status:
            aiQuestionResult.action === "ai_question_answered"
              ? "success"
              : "warning",
          eventType: aiQuestionResult.eventType,
          detail: aiQuestionResult.detail,
        });

        const replyResult = await sendFinalText(aiQuestionResult.reply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: "Falha ao enviar resposta automática do WhatsApp.",
          });
        }
        continue;
      }

      const pendingConfirmationResult = await handlePendingWhatsAppConfirmation(
        message,
        userId
      );
      if (pendingConfirmationResult) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status:
            pendingConfirmationResult.eventType === "whatsapp.action_cancelled"
              ? "warning"
              : "success",
          eventType: pendingConfirmationResult.eventType,
          detail: pendingConfirmationResult.detail,
        });

        const replyResult = await sendFinalText(
          pendingConfirmationResult.reply
        );
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: "Falha ao enviar resposta automática do WhatsApp.",
          });
        }
        continue;
      }

      const action = detectWhatsAppAction(message);
      if (action) {
        const actionResult = await handleWhatsAppAction(action, userId);
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status:
            actionResult.eventType === "whatsapp.action_clarification_needed"
              ? "warning"
              : "success",
          eventType: actionResult.eventType,
          detail: actionResult.detail,
        });

        const replyResult = await sendFinalText(actionResult.reply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: "Falha ao enviar resposta automática do WhatsApp.",
          });
        }
        continue;
      }

      // Mídia usa acknowledgement cancelável apenas quando o processamento ultrapassa o limiar.
      if (message.image?.id || message.audio?.id) {
        acknowledgement = startProcessingAcknowledgement({
          send: () =>
            sendWhatsAppProcessingAcknowledgement(
              sourcePhone,
              buildProcessingAcknowledgement(message)
            ),
          onFailure: detail =>
            logWhatsAppOperationWarning({
              userId,
              sourcePhone,
              eventType: "whatsapp.processing_ack_failed",
              detail,
            }),
        });
      }

      const waterLog = detectWaterLogFromMessage(message);
      if (waterLog) {
        const occurredAt = resolveWhatsAppMessageOccurredAt(message);
        const createdWaterLog = await createUserWaterLog(userId, {
          amountMl: waterLog.amountMl,
          occurredAt: occurredAt.toISOString(),
        });
        await recordDomainLink(lifecycleHandle, {
          waterLogId: createdWaterLog.id,
        });

        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: "success",
          eventType: "whatsapp.water_logged",
          detail: "Consumo de água registrado pelo WhatsApp.",
        });

        const waterReply = await buildCanonicalWaterReply(
          userId,
          waterLog.amountMl,
          occurredAt,
          userTimezone
        );
        const replyResult = await sendFinalText(waterReply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: "Falha ao enviar resposta automática do WhatsApp.",
          });
        }
        continue;
      }

      const weightLog = detectWeightLogFromMessage(message);
      if (weightLog) {
        const occurredAt = resolveWhatsAppMessageOccurredAt(message);
        const weightReply = await buildCanonicalWeightReply(
          userId,
          weightLog.weightKg,
          occurredAt,
          userTimezone
        );
        const persistedWeight = await ensureWhatsAppWeightEntry(userId, {
          weightKg: weightLog.weightKg,
          measuredAt: occurredAt,
          notes: "Peso atualizado pelo WhatsApp.",
        });
        if (persistedWeight.entry.id > 0) {
          await recordDomainLink(lifecycleHandle, {
            weightEntryId: persistedWeight.entry.id,
          });
        }

        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: "success",
          eventType: "whatsapp.weight_logged",
          detail: "Peso registrado pelo WhatsApp.",
        });

        const replyResult = await sendFinalText(weightReply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: "Falha ao enviar resposta automática do WhatsApp.",
          });
        }
        continue;
      }

      const prepared = await prepareMessageInput(message, sourcePhone);
      if (prepared.audioTranscriptionFailure?.blockedMealProcessing) {
        const replyResult = await sendFinalText(
          prepared.audioTranscriptionFailure.reply
        );
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail:
              "Falha ao enviar resposta de falha de transcrição pelo WhatsApp.",
          });
        }
        continue;
      }

      const unsafeContent = inspectPreparedMessageSafety(message, prepared);
      if (unsafeContent.length) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: "warning",
          eventType: "whatsapp.security_guard_blocked",
          detail: buildSecurityGuardDetail(unsafeContent),
        });

        const replyResult = await sendFinalText(
          buildSuspiciousWhatsAppContentReply()
        );
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: "Falha ao enviar resposta automática do WhatsApp.",
          });
        }
        continue;
      }

      if (prepared.audioTranscriptionFailure && prepared.text?.trim()) {
        responsePrefixBlocks.push(
          prepared.audioTranscriptionFailure.partialTextReply
        );
      }

      if (canInterpretAudioTranscriptIntent(message, prepared)) {
        const interpreted = await executeWhatsappTextIntent(userId, {
          text: prepared.transcript,
          receivedAt: resolveWhatsAppMessageOccurredAt(message),
          userTimezone,
        });

        if (interpreted) {
          await acknowledgement?.beforeFinalReply();
          await sendInterpretedTextIntentReply({
            userId,
            sourcePhone,
            interpreted,
            lifecycleHandle,
            replyText: composeFinalReply(interpreted.reply),
          });
          continue;
        }
      }

      const occurredAt = resolveWhatsAppMessageOccurredAt(message);
      const processed = await processMealInput({
        text: prepared.text,
        transcript: prepared.transcript,
        imageUrl: prepared.imageAnalysisUrl || prepared.imageUrl,
        audioUrl: prepared.audioUrl,
        habits: await getHabitSnapshots(userId),
        occurredAt,
        timeZone: userTimezone,
      });

      if (message.image?.id) {
        const waterSplit = splitMealItemsForWaterHydration(processed.items);

        if (waterSplit.waterVolumeMl > 0) {
          const createdWaterLog = await createUserWaterLog(userId, {
            amountMl: waterSplit.waterVolumeMl,
            occurredAt: occurredAt.toISOString(),
          });
          await recordDomainLink(lifecycleHandle, {
            waterLogId: createdWaterLog.id,
          });

          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "success",
            eventType: "whatsapp.water_logged",
            detail:
              "Consumo de água identificado em imagem e registrado pelo WhatsApp.",
          });
        }

        processed.items = normalizeWhatsappImageMealItemsForPersistence(
          waterSplit.remainingItems
        );
        processed.totals = calculateMealTotals(processed.items);

        if (!waterSplit.remainingItems.length) {
          if (waterSplit.waterVolumeMl > 0) {
            const waterReply = await buildCanonicalWaterReply(
              userId,
              waterSplit.waterVolumeMl,
              occurredAt,
              userTimezone
            );
            const replyResult = await sendFinalText(waterReply);
            if (!replyResult.ok) {
              logInferenceEvent({
                userId,
                origin: "whatsapp",
                status: "warning",
                eventType: "whatsapp.reply_failed",
                detail: "Falha ao enviar resposta automática do WhatsApp.",
              });
            }
            continue;
          }

          if (waterSplit.hasWaterWithoutVolume) {
            const replyResult = await sendFinalText(
              buildWhatsAppWaterVolumeNeededReplyMessage()
            );
            if (!replyResult.ok) {
              logInferenceEvent({
                userId,
                origin: "whatsapp",
                status: "warning",
                eventType: "whatsapp.reply_failed",
                detail: "Falha ao enviar resposta automática do WhatsApp.",
              });
            }
            continue;
          }
        } else if (waterSplit.waterVolumeMl > 0) {
          responsePrefixBlocks.push(
            await buildCanonicalWaterReply(
              userId,
              waterSplit.waterVolumeMl,
              occurredAt,
              userTimezone
            )
          );
        }

        const imagePersistence = inspectWhatsappImageMealItemsPersistence(
          processed.items
        );
        if (imagePersistence.status === "missing_portion") {
          const clarification =
            await requestWhatsappImageMealQuantityClarification({
              userId,
              detectedMealLabel: processed.detectedMealLabel,
              sourceText: processed.sourceText,
              transcript: processed.transcript,
              reasoning: processed.reasoning,
              confidence: processed.confidence,
              occurredAt,
              items: processed.items,
              media: prepared.media,
              pendingItemIndexes: getWhatsappImageMissingPortionIndexes(
                processed.items
              ),
              messageId: message.id,
            });
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status:
              clarification.action === "food_clarification_requested"
                ? "success"
                : "warning",
            eventType: clarification.eventType,
            detail: clarification.detail,
          });
          const replyResult = await sendFinalText(clarification.reply);
          if (!replyResult.ok) {
            logInferenceEvent({
              userId,
              origin: "whatsapp",
              status: "warning",
              eventType: "whatsapp.reply_failed",
              detail:
                "Falha ao enviar clarificação de quantidade para alimento identificado por imagem.",
            });
          }
          continue;
        }

        assertWhatsappImageMealItemsArePersistable(processed.items);
      }

      const processedForPersistence = {
        ...processed,
        imageUrl: prepared.imageUrl,
      };
      const mediaForPersistence = [...prepared.media];
      let annotatedImage: GenerateImageResponse | null = null;

      if (message.image?.id) {
        try {
          annotatedImage = await generateAnnotatedMealImage(
            processedForPersistence,
            prepared.imageAnalysisUrl
          );
          if (annotatedImage?.url) {
            mediaForPersistence.push(
              buildSavedMedia({
                mediaType: "image",
                storageKey: annotatedImage.storageKey ?? annotatedImage.url,
                storageUrl: annotatedImage.url,
                mimeType: annotatedImage.mimeType ?? "image/png",
                originalFileName: "whatsapp-annotated-meal.png",
              })
            );
          } else {
            logInferenceEvent({
              userId,
              origin: "whatsapp",
              status: "warning",
              eventType: "whatsapp.annotated_image_skipped",
              detail:
                "Imagem anotada não vinculada à refeição; o registro nutricional foi preservado.",
            });
          }
        } catch (annotationError) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.annotated_image_skipped",
            detail:
              "Falha ao gerar imagem anotada; o registro nutricional foi preservado.",
          });
        }
      }

      const draft = createPendingMealInference(
        userId,
        "whatsapp",
        processedForPersistence,
        mediaForPersistence
      );
      const savedMeal = await confirmPendingMeal({
        draftId: draft.draftId,
        userId,
        mealLabel: processedForPersistence.detectedMealLabel || "Refeição",
        occurredAt: occurredAt.toISOString(),
        notes:
          prepared.text?.trim() || prepared.transcript?.trim() || undefined,
        items: processedForPersistence.items,
      });

      const consolidationResult = await consolidateWhatsAppMealAfterSave(
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
          "Mensagem processada e refeição registrada automaticamente pelo WhatsApp.",
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
      const mealReplyText =
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
      const auxiliaryImage: WhatsAppAuxiliaryImage | null = annotatedImage?.url
        ? {
            url: annotatedImage.url,
            caption: "Imagem anotada com os alimentos identificados.",
          }
        : annotatedImage?.buffer
          ? {
              buffer: annotatedImage.buffer,
              mimeType: annotatedImage.mimeType,
              fileName: "whatsapp-annotated-meal.png",
              caption: "Imagem anotada com os alimentos identificados.",
            }
          : null;
      await acknowledgement?.beforeFinalReply();
      const delivery = await sendWhatsAppLogicalDomainReply({
        to: sourcePhone,
        userId,
        replyText: composeFinalReply(mealReplyText),
        mealId: replyMeal.id,
        auxiliaryImage,
        lifecycleHandle,
      });
      if (!delivery.result.ok) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: delivery.result.primaryOk ? "warning" : "error",
          eventType:
            auxiliaryImage && delivery.result.primaryOk
              ? "whatsapp.annotated_image_reply_failed"
              : "whatsapp.reply_failed",
          detail: "Falha ao enviar resposta lógica de refeição pelo WhatsApp.",
        });
      }
      await markMessageProcessed(lifecycleHandle);
    } catch (error) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "error",
        eventType: "whatsapp.processing_error",
        detail:
          error instanceof Error
            ? error.message
            : "Falha desconhecida ao processar webhook.",
      });

      const reply = buildProcessingFailureReply(message, error);
      const replyResult = await sendFinalText(reply);
      if (!replyResult.ok) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: "warning",
          eventType: "whatsapp.reply_failed",
          detail: "Falha ao enviar resposta automática do WhatsApp.",
        });
      }
    } finally {
      await acknowledgement?.beforeFinalReply();
    }
  }

  return res.status(200).json({ ok: true, processed: messages.length });
}
