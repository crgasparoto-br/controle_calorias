import { Request, Response } from "express";
import type { GenerateImageResponse } from "./_core/imageGeneration";
import { buildSavedMedia, confirmPendingMeal, createPendingMealInference, createUserWaterLog, getHabitSnapshots, getUserDayMealTotals, getUserIdByWhatsappPhone, getUserNutritionGoal, listUserMeals, logInferenceEvent, removeUserMeal, updateUserCurrentWeight, updateUserMeal } from "./db";
import { tryCreateQuickEditLinkForMeal } from "./modules/quickEdit/service";
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
import { formatWhatsAppMacro, formatWhatsAppReplyTime } from "./modules/whatsapp/replyFormatting";
import { buildWhatsAppConsolidatedMealReplyMessage, buildWhatsAppMealReplyMessage, buildWhatsAppWaterVolumeNeededReplyMessage, type WhatsAppMealGoalProgress } from "./modules/whatsapp/replyMessages";
import {
  buildWaterLogReply,
  buildWeightLogReply,
  detectWaterLogFromMessage,
  detectWeightLogFromMessage,
  detectWhatsAppAction,
  handlePendingWhatsAppConfirmation,
  handleWhatsAppAction,
} from "./modules/whatsapp/webhookTextCommands";
import { prepareMessageInput, type PreparedMessageInput } from "./modules/whatsapp/webhookMediaPipeline";
import { splitMealItemsForWaterHydration } from "./modules/whatsapp/waterItemClassification";
import {
  extractWhatsAppWebhookMessages,
  formatDateKeyInSaoPaulo,
  isWhatsAppMessageForConfiguredChannel,
  markWhatsAppMessageAsRead,
  resolveWhatsAppMessageOccurredAt,
  sendWhatsAppImageMessage,
  sendWhatsAppInteractiveUrlButtonMessage,
  sendWhatsAppTextMessage,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";
import { MealInferenceError, MealProcessingResult, processMealInput } from "./nutritionEngine";
import { getWhatsAppChannelConfig } from "./whatsappConfig";
import { calculateMealTotals } from "../shared/mealTotals";

type WhatsAppTextIntentResult = NonNullable<Awaited<ReturnType<typeof executeWhatsappTextIntent>>>;

const recentlyHandledWhatsAppMessageIds = new Map<string, number>();
const MESSAGE_DEDUPLICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PROCESSING_ERROR_REPLY = "Não consegui processar essa mídia agora. Tente enviar novamente ou descreva os alimentos em texto para eu registrar.";

async function resolveUserIdFromPhone(sourcePhone: string) {
  return getUserIdByWhatsappPhone(sourcePhone);
}

function getVerifyToken() {
  return getWhatsAppChannelConfig().verifyToken;
}

async function getWhatsAppMealGoalProgress(userId: number, occurredAt: Date): Promise<WhatsAppMealGoalProgress | null> {
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

function getPreparedTextModality(message: WhatsAppWebhookMessage): WhatsAppUserContentModality {
  if (message.image?.id && message.audio?.id) return "multimodal";
  if (message.image?.id) return "image_caption";
  if (message.audio?.id) return "multimodal";
  return "text";
}

function inspectPreparedMessageSafety(message: WhatsAppWebhookMessage, prepared: PreparedMessageInput) {
  const checks: WhatsAppContentSafetyCheck[] = [];
  if (prepared.text?.trim()) {
    checks.push(inspectWhatsAppUserContentSafety(prepared.text, getPreparedTextModality(message)));
  }
  if (prepared.transcript?.trim()) {
    checks.push(inspectWhatsAppUserContentSafety(prepared.transcript, "audio_transcript"));
  }
  return checks.filter(check => !check.safe);
}

function buildSecurityGuardDetail(unsafeChecks: WhatsAppContentSafetyCheck[]) {
  const categories = Array.from(new Set(unsafeChecks.flatMap(check => check.categories)));
  const modalities = Array.from(new Set(unsafeChecks.map(check => check.modality)));
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
}) {
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: input.interpreted.action === "clarification_needed" ? "warning" : "success",
    eventType: input.interpreted.eventType,
    detail: input.interpreted.detail,
  });

  const mealId = typeof input.interpreted.data?.mealId === "number" ? input.interpreted.data.mealId : null;
  const replyText = input.interpreted.reply;
  let quickEditUrl: string | null = null;
  if (mealId) {
    const quickEditLink = await tryCreateQuickEditLinkForMeal({ userId: input.userId, mealId });
    quickEditUrl = quickEditLink?.url ?? null;
  }

  const replyResult = quickEditUrl
    ? await sendWhatsAppInteractiveUrlButtonMessage(input.sourcePhone, replyText, "Editar refeição", quickEditUrl)
    : await sendWhatsAppTextMessage(input.sourcePhone, replyText);


  if (!replyResult.ok || "usedFallback" in replyResult && replyResult.usedFallback) {
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: replyResult.ok ? "warning" : "error",
      eventType: "whatsapp.reply_failed",
      detail: `Falha ao enviar resposta automática para ${input.sourcePhone}: ${replyResult.detail}`,
    });
  }

}

function canInterpretAudioTranscriptIntent(message: WhatsAppWebhookMessage, prepared: PreparedMessageInput) {
  return Boolean(message.audio?.id && !message.image?.id && prepared.transcript?.trim());
}

function isSupportedMessage(message: WhatsAppWebhookMessage) {
  return Boolean(message.text?.body || message.image?.id || message.audio?.id);
}

function pruneRecentlyHandledMessageIds(now = Date.now()) {
  for (const [messageId, expiresAt] of recentlyHandledWhatsAppMessageIds) {
    if (expiresAt <= now) {
      recentlyHandledWhatsAppMessageIds.delete(messageId);
    }
  }
}

function reserveWhatsAppMessageForProcessing(messageId?: string) {
  if (!messageId) {
    return true;
  }

  const now = Date.now();
  pruneRecentlyHandledMessageIds(now);

  if (recentlyHandledWhatsAppMessageIds.has(messageId)) {
    return false;
  }

  recentlyHandledWhatsAppMessageIds.set(messageId, now + MESSAGE_DEDUPLICATION_TTL_MS);
  return true;
}

export function __resetWhatsAppWebhookDeduplicationForTests() {
  recentlyHandledWhatsAppMessageIds.clear();
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
        detail: `Mensagem recebida de ${sourcePhone} sem vínculo ativo com um usuário da plataforma.`,
      });
      continue;
    }

    if (!isSupportedMessage(message)) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.unsupported_message",
        detail: `Mensagem recebida de ${sourcePhone} com tipo ${message.type || "desconhecido"}.`,
      });
      continue;
    }

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
      const aiQuestionResult = await executeWhatsappAiQuestionIntent(userId, {
        text: message.text?.body,
        receivedAt: resolveWhatsAppMessageOccurredAt(message),
      });
      if (aiQuestionResult) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: aiQuestionResult.action === "ai_question_answered" ? "success" : "warning",
          eventType: aiQuestionResult.eventType,
          detail: aiQuestionResult.detail,
        });

        const replyResult = await sendWhatsAppTextMessage(sourcePhone, aiQuestionResult.reply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
          });
        }
        continue;
      }

      const pendingConfirmationResult = await handlePendingWhatsAppConfirmation(message, userId);
      if (pendingConfirmationResult) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: pendingConfirmationResult.eventType === "whatsapp.action_cancelled" ? "warning" : "success",
          eventType: pendingConfirmationResult.eventType,
          detail: pendingConfirmationResult.detail,
        });

        const replyResult = await sendWhatsAppTextMessage(sourcePhone, pendingConfirmationResult.reply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
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
          status: actionResult.eventType === "whatsapp.action_clarification_needed" ? "warning" : "success",
          eventType: actionResult.eventType,
          detail: actionResult.detail,
        });

        const replyResult = await sendWhatsAppTextMessage(sourcePhone, actionResult.reply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
          });
        }
        continue;
      }

      const acknowledgementResult = await sendWhatsAppTextMessage(sourcePhone, buildProcessingAcknowledgement(message));
      if (!acknowledgementResult.ok) {
        await logWhatsAppOperationWarning({
          userId,
          sourcePhone,
          eventType: "whatsapp.processing_ack_failed",
          detail: acknowledgementResult.detail,
        });
      }

      const waterLog = detectWaterLogFromMessage(message);
      if (waterLog) {
        const occurredAt = resolveWhatsAppMessageOccurredAt(message);
        await createUserWaterLog(userId, {
          amountMl: waterLog.amountMl,
          occurredAt: occurredAt.toISOString(),
        });

        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: "success",
          eventType: "whatsapp.water_logged",
          detail: `Consumo de ${waterLog.amountMl} ml de água registrado pelo WhatsApp às ${formatWhatsAppReplyTime(occurredAt)}.`,
        });

        const replyResult = await sendWhatsAppTextMessage(sourcePhone, buildWaterLogReply(waterLog.amountMl, occurredAt));
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
          });
        }
        continue;
      }

      const weightLog = detectWeightLogFromMessage(message);
      if (weightLog) {
        const occurredAt = resolveWhatsAppMessageOccurredAt(message);
        await updateUserCurrentWeight(userId, {
          weightKg: weightLog.weightKg,
          measuredAt: occurredAt,
          notes: "Peso atualizado pelo WhatsApp.",
        });

        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: "success",
          eventType: "whatsapp.weight_logged",
          detail: `Peso de ${formatWhatsAppMacro(weightLog.weightKg)} kg registrado pelo WhatsApp às ${formatWhatsAppReplyTime(occurredAt)}.`,
        });

        const replyResult = await sendWhatsAppTextMessage(sourcePhone, buildWeightLogReply(weightLog.weightKg, occurredAt));
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
          });
        }
        continue;
      }

      const prepared = await prepareMessageInput(message, sourcePhone);
      if (prepared.audioTranscriptionFailure?.blockedMealProcessing) {
        const replyResult = await sendWhatsAppTextMessage(sourcePhone, prepared.audioTranscriptionFailure.reply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: `Falha ao enviar resposta de falha de transcrição para ${sourcePhone}: ${replyResult.detail}`,
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

        const replyResult = await sendWhatsAppTextMessage(sourcePhone, buildSuspiciousWhatsAppContentReply());
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
          });
        }
        continue;
      }

      if (prepared.audioTranscriptionFailure && prepared.text?.trim()) {
        const replyResult = await sendWhatsAppTextMessage(sourcePhone, prepared.audioTranscriptionFailure.partialTextReply);
        if (!replyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.reply_failed",
            detail: `Falha ao enviar aviso de transcrição parcial para ${sourcePhone}: ${replyResult.detail}`,
          });
        }
      }

      if (canInterpretAudioTranscriptIntent(message, prepared)) {
        const interpreted = await executeWhatsappTextIntent(userId, {
          text: prepared.transcript,
          receivedAt: resolveWhatsAppMessageOccurredAt(message),
        });

        if (interpreted) {
          await sendInterpretedTextIntentReply({
            userId,
            sourcePhone,
            interpreted,
          });
          continue;
        }
      }

      const processed = await processMealInput({
        text: prepared.text,
        transcript: prepared.transcript,
        imageUrl: prepared.imageAnalysisUrl || prepared.imageUrl,
        audioUrl: prepared.audioUrl,
        habits: await getHabitSnapshots(userId),
      });
      const occurredAt = resolveWhatsAppMessageOccurredAt(message);

      if (message.image?.id) {
        const waterSplit = splitMealItemsForWaterHydration(processed.items);

        if (waterSplit.waterVolumeMl > 0) {
          await createUserWaterLog(userId, {
            amountMl: waterSplit.waterVolumeMl,
            occurredAt: occurredAt.toISOString(),
          });

          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "success",
            eventType: "whatsapp.water_logged",
            detail: `Consumo de ${waterSplit.waterVolumeMl} ml de água identificado em imagem e registrado pelo WhatsApp às ${formatWhatsAppReplyTime(occurredAt)}.`,
          });
        }

        processed.items = waterSplit.remainingItems;
        processed.totals = calculateMealTotals(waterSplit.remainingItems);

        if (!waterSplit.remainingItems.length) {
          if (waterSplit.waterVolumeMl > 0) {
            const replyResult = await sendWhatsAppTextMessage(sourcePhone, buildWaterLogReply(waterSplit.waterVolumeMl, occurredAt));
            if (!replyResult.ok) {
              logInferenceEvent({
                userId,
                origin: "whatsapp",
                status: "warning",
                eventType: "whatsapp.reply_failed",
                detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
              });
            }
            continue;
          }

          if (waterSplit.hasWaterWithoutVolume) {
            const replyResult = await sendWhatsAppTextMessage(sourcePhone, buildWhatsAppWaterVolumeNeededReplyMessage());
            if (!replyResult.ok) {
              logInferenceEvent({
                userId,
                origin: "whatsapp",
                status: "warning",
                eventType: "whatsapp.reply_failed",
                detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
              });
            }
            continue;
          }
        } else if (waterSplit.waterVolumeMl > 0) {
          const waterReplyResult = await sendWhatsAppTextMessage(sourcePhone, buildWaterLogReply(waterSplit.waterVolumeMl, occurredAt));
          if (!waterReplyResult.ok) {
            logInferenceEvent({
              userId,
              origin: "whatsapp",
              status: "warning",
              eventType: "whatsapp.reply_failed",
              detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${waterReplyResult.detail}`,
            });
          }
        }
      }

      const processedForPersistence = {
        ...processed,
        imageUrl: prepared.imageUrl,
      };
      const mediaForPersistence = [...prepared.media];
      let annotatedImage: GenerateImageResponse | null = null;

      if (message.image?.id) {
        try {
          annotatedImage = await generateAnnotatedMealImage(processedForPersistence, prepared.imageAnalysisUrl);
          if (annotatedImage?.url) {
            mediaForPersistence.push(buildSavedMedia({
              mediaType: "image",
              storageKey: annotatedImage.storageKey ?? annotatedImage.url,
              storageUrl: annotatedImage.url,
              mimeType: annotatedImage.mimeType ?? "image/png",
              originalFileName: "whatsapp-annotated-meal.png",
            }));
          } else {
            logInferenceEvent({
              userId,
              origin: "whatsapp",
              status: "warning",
              eventType: "whatsapp.annotated_image_skipped",
              detail: `Imagem anotada não vinculada à refeição ${prepared.summary} de ${sourcePhone}: ${annotatedImage?.detail || annotatedImage?.skippedReason || "geração sem URL"}.`,
            });
          }
        } catch (annotationError) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.annotated_image_skipped",
            detail: `Falha ao gerar imagem anotada para ${prepared.summary} de ${sourcePhone}: ${annotationError instanceof Error ? annotationError.message : "erro desconhecido"}.`,
          });
        }
      }

      const draft = createPendingMealInference(userId, "whatsapp", processedForPersistence, mediaForPersistence);
      const savedMeal = await confirmPendingMeal({
        draftId: draft.draftId,
        userId,
        mealLabel: processedForPersistence.detectedMealLabel || "Refeição",
        occurredAt: occurredAt.toISOString(),
        notes: prepared.text?.trim() || prepared.transcript?.trim() || undefined,
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

      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.message_processed",
        detail: `Mensagem ${prepared.summary} de ${sourcePhone} processada e refeição ${savedMeal.mealLabel} registrada automaticamente às ${formatWhatsAppReplyTime(occurredAt)}.`,
      });

      const quickEditLink = await tryCreateQuickEditLinkForMeal({ userId, mealId: replyMeal.id });
      const mealReplyText = consolidationResult.action === "updated"
        ? buildWhatsAppConsolidatedMealReplyMessage(replyMeal, {
            registeredAt: occurredAt,
            goalProgress: await getWhatsAppMealGoalProgress(userId, occurredAt),
          })
        : buildWhatsAppMealReplyMessage(processedForPersistence, {
            registeredAt: occurredAt,
            goalProgress: await getWhatsAppMealGoalProgress(userId, occurredAt),
          });
      const replyResult = quickEditLink?.url
        ? await sendWhatsAppInteractiveUrlButtonMessage(sourcePhone, mealReplyText, "Editar refeição", quickEditLink.url)
        : await sendWhatsAppTextMessage(sourcePhone, mealReplyText);

      if (!replyResult.ok || "usedFallback" in replyResult && replyResult.usedFallback) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: replyResult.ok ? "warning" : "error",
          eventType: "whatsapp.reply_failed",
          detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
        });
      }

      if (annotatedImage?.url) {
        const imageReplyResult = await sendWhatsAppImageMessage(
          sourcePhone,
          annotatedImage.url,
          "Imagem anotada com os alimentos identificados.",
        );

        if (!imageReplyResult.ok) {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.annotated_image_reply_failed",
            detail: `Falha ao enviar imagem anotada para ${sourcePhone}: ${imageReplyResult.detail}`,
          });
        }
      }
    } catch (error) {
      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "error",
        eventType: "whatsapp.processing_error",
        detail: error instanceof Error ? error.message : "Falha desconhecida ao processar webhook.",
      });

      const reply = error instanceof MealInferenceError ? error.message : PROCESSING_ERROR_REPLY;
      const replyResult = await sendWhatsAppTextMessage(sourcePhone, reply);
      if (!replyResult.ok) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: "warning",
          eventType: "whatsapp.reply_failed",
          detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
        });
      }
    }
  }

  return res.status(200).json({ ok: true, processed: messages.length });
}
