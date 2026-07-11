import { Request, Response } from "express";
import { createUserWaterLog, getUserIdByWhatsappPhone, listUserExercises, logInferenceEvent } from "./db";
import { runWithWhatsAppGoalProgressContext } from "./modules/whatsapp/goalProgressContext";
import {
  extractIndexedWhatsAppWebhookMessages,
  formatDateKeyInSaoPaulo,
  normalizeWhatsAppIntentText,
  resolveWhatsAppMessageOccurredAt,
  sendWhatsAppInteractiveUrlButtonMessage,
  sendWhatsAppTextMessage,
  type IndexedWhatsAppWebhookMessage,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";
import { requireWhatsAppMediaConfig } from "./whatsappConfig";
import { handleWhatsAppWebhookWithTextIntent } from "./whatsappIntentWebhook";
import { createMessageDeduplicationCache } from "./modules/whatsapp/messageDeduplicationCache";
import {
  beginInboundMessage,
  claimMessageForProcessing,
  markMessageProcessed,
  runWithMessageLifecycleRequestScope,
  type MessageLifecycleHandle,
} from "./modules/whatsapp/messageLifecycle";
import {
  withWhatsappContextFlow,
  type WhatsappContextFlow,
} from "./modules/whatsapp/conversationContextRollout";

const fallbackMessageDeduplicationCache = createMessageDeduplicationCache();
const MAX_WATER_LOG_AMOUNT_ML = 10000;

type ClaimedMessage = {
  item: IndexedWhatsAppWebhookMessage;
  userId: number;
  lifecycleHandle: MessageLifecycleHandle;
};

function formatReplyTime(date: Date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function parseWaterAmountMl(text: string) {
  const normalized = normalizeWhatsAppIntentText(text);
  const mlMatch = normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:m\s*l|ml|mililitros?)\b/);
  if (mlMatch) {
    return Math.round(Number(mlMatch[1].replace(",", ".")));
  }

  const literMatch = normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:l|litros?)\b/);
  if (literMatch) {
    return Math.round(Number(literMatch[1].replace(",", ".")) * 1000);
  }

  return null;
}

function mentionsWater(text?: string) {
  const normalized = normalizeWhatsAppIntentText(text || "");
  return /\baguas?\b/.test(normalized) || /\bhidratacao\b/.test(normalized) || /\bwater\b/.test(normalized);
}

function buildWaterLogReply(amountMl: number, occurredAt: Date) {
  return `Registrei ${formatNumber(amountMl)} ml de água às ${formatReplyTime(occurredAt)}.`;
}

function buildWaterImageClarificationReply() {
  return "Identifiquei água na imagem. Para registrar corretamente, me diga a quantidade aproximada, por exemplo: 300 ml de água.";
}

function buildOnboardingWelcomeReply() {
  return [
    "Boas-vindas ao Controle de Calorias.",
    "Para começar pelo WhatsApp, finalize seu cadastro no site pelo link seguro abaixo.",
    "Depois disso, este canal passa a registrar suas refeições automaticamente.",
  ].join("\n\n");
}

function isSameDateKeyInSaoPaulo(value: number | string | Date, dateKey: string) {
  return formatDateKeyInSaoPaulo(new Date(value)) === dateKey;
}

function getImageCaption(message: WhatsAppWebhookMessage) {
  return message.image?.caption?.trim() || message.text?.body?.trim() || "";
}

function resolveMessageContentType(message: WhatsAppWebhookMessage) {
  if (message.image?.id && message.audio?.id) return "multimodal" as const;
  if (message.image?.id) return "image" as const;
  if (message.audio?.id) return "audio" as const;
  return "text" as const;
}

function resolveBatchContextFlow(messages: IndexedWhatsAppWebhookMessage[]): WhatsappContextFlow {
  const types = new Set(messages.map(item => resolveMessageContentType(item.message)));
  if (types.size > 1 || types.has("multimodal")) return "multimodal";
  const [type] = [...types];
  return type === "image" || type === "audio" ? type : "text";
}

async function claimIndexedMessage(item: IndexedWhatsAppWebhookMessage): Promise<ClaimedMessage | null | "duplicate"> {
  const message = item.message;
  if (!message.from) return null;

  const userId = await getUserIdByWhatsappPhone(message.from);
  if (!userId) return null;

  const locallySeen = message.id
    ? fallbackMessageDeduplicationCache.wasAlreadyHandled(message.id)
    : false;
  const lifecycleHandle = await beginInboundMessage({
    userId,
    whatsappConnectionId: null,
    phoneNumber: message.from,
    externalMessageId: message.id,
    contentType: resolveMessageContentType(message),
    text: message.text?.body ?? null,
    captionText: message.image?.caption ?? null,
    occurredAt: resolveWhatsAppMessageOccurredAt(message),
    allowRawContentStorage: true,
  });

  if (!lifecycleHandle && locallySeen) {
    return "duplicate";
  }

  if (!await claimMessageForProcessing(lifecycleHandle)) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.idempotency.duplicate_detected",
      detail: JSON.stringify({
        source: "persistent_processing_claim",
        contentType: resolveMessageContentType(message),
        locallySeen,
      }),
    });
    return "duplicate";
  }

  if (message.id) fallbackMessageDeduplicationCache.markHandled(message.id);
  return { item, userId, lifecycleHandle };
}

async function handleOnboardingLeadMessage(item: IndexedWhatsAppWebhookMessage) {
  const message = item.message;
  if (!message.from) return false;

  const userId = await getUserIdByWhatsappPhone(message.from);
  if (userId) return false;

  const { createWhatsappOnboardingLead } = await import("./modules/onboarding/whatsappLeadService");
  const onboarding = await createWhatsappOnboardingLead({ phoneNumber: message.from });
  const replyResult = await sendWhatsAppInteractiveUrlButtonMessage(
    message.from,
    buildOnboardingWelcomeReply(),
    "Finalizar cadastro",
    onboarding.url,
  );

  if (!replyResult.ok) {
    const textResult = await sendWhatsAppTextMessage(
      message.from,
      `${buildOnboardingWelcomeReply()}\n\n${onboarding.url}`,
    );
    if (!textResult.ok) {
      logInferenceEvent({
        userId: null,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.onboarding_reply_failed",
        detail: `Falha ao enviar link de onboarding para telefone mascarado ${onboarding.lead.phoneNumberMasked}: ${textResult.detail}`,
      });
    }
  }

  return true;
}

async function handleWaterImageMessage(item: IndexedWhatsAppWebhookMessage) {
  const message = item.message;
  if (!message.image?.id || message.audio?.id || !message.from) return false;

  const userId = await getUserIdByWhatsappPhone(message.from);
  if (!userId) return false;

  const caption = getImageCaption(message);
  const amountFromCaption = parseWaterAmountMl(caption || "");
  const captionMentionsWater = mentionsWater(caption);

  if (captionMentionsWater) {
    if (!amountFromCaption || amountFromCaption <= 0 || amountFromCaption > MAX_WATER_LOG_AMOUNT_ML) {
      await sendWaterImageClarification({ userId, sourcePhone: message.from });
      return true;
    }

    await registerWaterImage({
      userId,
      sourcePhone: message.from,
      amountMl: amountFromCaption,
      occurredAt: resolveWhatsAppMessageOccurredAt(message),
      detail: "Imagem de água com quantidade explícita na legenda registrada pelo WhatsApp.",
    });
    return true;
  }

  return false;
}

async function registerWaterImage(input: { userId: number; sourcePhone: string; amountMl: number; occurredAt: Date; detail: string }) {
  await createUserWaterLog(input.userId, {
    amountMl: input.amountMl,
    occurredAt: input.occurredAt.toISOString(),
  });

  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: "success",
    eventType: "whatsapp.image_water_logged",
    detail: `${input.detail} Quantidade: ${input.amountMl} ml às ${formatReplyTime(input.occurredAt)}.`,
  });

  const replyResult = await sendWhatsAppTextMessage(input.sourcePhone, buildWaterLogReply(input.amountMl, input.occurredAt));
  if (!replyResult.ok) {
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.reply_failed",
      detail: `Falha ao enviar resposta automática: ${replyResult.detail}`,
    });
  }
}

async function sendWaterImageClarification(input: { userId: number; sourcePhone: string }) {
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: "warning",
    eventType: "whatsapp.image_water_clarification_needed",
    detail: "Imagem de água recebida sem quantidade explícita para registro de hidratação.",
  });

  const replyResult = await sendWhatsAppTextMessage(input.sourcePhone, buildWaterImageClarificationReply());
  if (!replyResult.ok) {
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.reply_failed",
      detail: `Falha ao enviar resposta automática: ${replyResult.detail}`,
    });
  }
}

function getStravaExerciseReference(exercise: { notes?: string | null }) {
  const match = exercise.notes?.match(/\bstrava:(\d+)\b/i);
  return match?.[1] ? `strava:${match[1]}` : null;
}

function sumExerciseCaloriesForDate(exercises: Array<{ occurredAt: number | string | Date; caloriesBurned?: number | null; notes?: string | null }>, dateKey: string) {
  const seenExternalReferences = new Set<string>();

  return exercises
    .filter(exercise => isSameDateKeyInSaoPaulo(exercise.occurredAt, dateKey))
    .reduce((total, exercise) => {
      const externalReference = getStravaExerciseReference(exercise);
      if (externalReference) {
        if (seenExternalReferences.has(externalReference)) return total;
        seenExternalReferences.add(externalReference);
      }
      return total + Number(exercise.caloriesBurned || 0);
    }, 0);
}

async function buildExerciseCaloriesContext(messages: IndexedWhatsAppWebhookMessage[]) {
  const context: Record<string, number> = {};
  const seen = new Set<string>();

  for (const item of messages) {
    const sourcePhone = item.message.from;
    if (!sourcePhone) continue;

    const dateKey = formatDateKeyInSaoPaulo(resolveWhatsAppMessageOccurredAt(item.message));
    const cacheKey = `${sourcePhone}:${dateKey}`;
    if (seen.has(cacheKey)) continue;
    seen.add(cacheKey);

    try {
      const userId = await getUserIdByWhatsappPhone(sourcePhone);
      if (!userId) continue;
      const exercises = await listUserExercises(userId);
      context[dateKey] = (context[dateKey] ?? 0) + sumExerciseCaloriesForDate(exercises, dateKey);
    } catch (error) {
      logInferenceEvent({
        userId: 0,
        origin: "whatsapp",
        status: "warning",
        eventType: "whatsapp.exercise_context_warning",
        detail: error instanceof Error ? error.message : "Falha desconhecida ao calcular exercícios para contexto da resposta do WhatsApp.",
      });
    }
  }

  return { exerciseCaloriesByDateKey: context };
}

function clonePayloadWithoutKeys(payload: any, handledKeys: Set<string>) {
  const cloned = structuredClone(payload);
  const entries = Array.isArray(cloned?.entry) ? cloned.entry : [];

  cloned.entry = entries
    .map((entry: any, entryIndex: number) => {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      const filteredChanges = changes
        .map((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          const filteredMessages = messages.filter(
            (_message: WhatsAppWebhookMessage, messageIndex: number) => !handledKeys.has(`${entryIndex}:${changeIndex}:${messageIndex}`),
          );
          return { ...change, value: { ...change.value, messages: filteredMessages } };
        })
        .filter((change: any) => Array.isArray(change?.value?.messages) && change.value.messages.length > 0);
      return { ...entry, changes: filteredChanges };
    })
    .filter((entry: any) => Array.isArray(entry?.changes) && entry.changes.length > 0);

  return cloned;
}

export function __resetWhatsAppImageIdempotencyForTests() {
  fallbackMessageDeduplicationCache.clear();
}

async function handleWhatsAppWebhookWithImageIdempotencyInternal(req: Request, res: Response) {
  const messages = extractIndexedWhatsAppWebhookMessages(req.body);
  const handledKeys = new Set<string>();
  const duplicateKeys = new Set<string>();
  const claimedMessages: ClaimedMessage[] = [];

  for (const item of messages) {
    if (await handleOnboardingLeadMessage(item)) {
      handledKeys.add(item.key);
      continue;
    }

    const claim = await claimIndexedMessage(item);
    if (claim === "duplicate") {
      duplicateKeys.add(item.key);
      handledKeys.add(item.key);
      continue;
    }
    if (claim) claimedMessages.push(claim);

    if (await handleWaterImageMessage(item)) {
      handledKeys.add(item.key);
      if (claim) await markMessageProcessed(claim.lifecycleHandle);
    }
  }

  if (handledKeys.size > 0) {
    const remainingPayload = clonePayloadWithoutKeys(req.body, handledKeys);
    if (!Array.isArray(remainingPayload?.entry) || remainingPayload.entry.length === 0) {
      return res.status(200).json({
        ok: true,
        processed: messages.length - duplicateKeys.size,
        ...(duplicateKeys.size > 0 ? { deduplicated: true } : {}),
      });
    }
    req.body = remainingPayload;
  }

  const remainingMessages = extractIndexedWhatsAppWebhookMessages(req.body);
  const context = await buildExerciseCaloriesContext(remainingMessages);
  const flow = resolveBatchContextFlow(remainingMessages);

  try {
    return await withWhatsappContextFlow(flow, () =>
      runWithWhatsAppGoalProgressContext(context, () => handleWhatsAppWebhookWithTextIntent(req, res)),
    );
  } finally {
    const remainingKeys = new Set(remainingMessages.map(item => item.key));
    await Promise.all(
      claimedMessages
        .filter(claim => remainingKeys.has(claim.item.key))
        .map(claim => markMessageProcessed(claim.lifecycleHandle)),
    );
  }
}

export async function handleWhatsAppWebhookWithImageIdempotency(req: Request, res: Response) {
  return runWithMessageLifecycleRequestScope(() => handleWhatsAppWebhookWithImageIdempotencyInternal(req, res));
}

void requireWhatsAppMediaConfig;
