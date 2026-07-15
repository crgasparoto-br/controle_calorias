import { Request, Response } from "express";
import { createUserWaterLog, getUserIdByWhatsappPhone, listUserExercises, logInferenceEvent } from "./db";
import {
  extractIndexedWhatsAppWebhookMessages,
  formatDateKeyInSaoPaulo,
  normalizeWhatsAppIntentText,
  resolveWhatsAppMessageOccurredAt,
  type IndexedWhatsAppWebhookMessage,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";
import {
  buildWhatsAppExerciseCaloriesByDateKey,
  runWithWhatsAppGoalProgressContext,
} from "./modules/whatsapp/goalProgressContext";
import { handleWhatsAppWebhookWithTextIntent } from "./whatsappIntentWebhook";
import { createMessageDeduplicationCache } from "./modules/whatsapp/messageDeduplicationCache";
import {
  beginInboundMessage,
  claimMessageForProcessing,
  recordDomainLink,
  runWithMessageLifecycleRequestScope,
  type MessageLifecycleHandle,
} from "./modules/whatsapp/messageLifecycle";
import {
  withWhatsappContextFlow,
  type WhatsappContextFlow,
} from "./modules/whatsapp/conversationContextRollout";
import { textReply, withCtaUrl } from "./modules/whatsapp/replyContract";
import { sendWhatsAppStandaloneLogicalReply } from "./modules/whatsapp/logicalReplyDelivery";
import { sendWhatsAppLogicalDomainReply } from "./modules/whatsapp/logicalReplyDelivery";
import { buildWhatsAppCanonicalWaterReply } from "./modules/whatsapp/domainReplyFormatters";
import {
  buildWhatsAppOnboardingLeadReplyMessage,
  buildWhatsAppWaterImageClarificationReplyMessage,
} from "./modules/whatsapp/replyMessages";
import { getWhatsAppWaterProgress } from "./modules/whatsapp/userMeasurementReplyContext";

const fallbackMessageDeduplicationCache = createMessageDeduplicationCache();
const MAX_WATER_LOG_AMOUNT_ML = 10000;

type ClaimedMessage = {
  item: IndexedWhatsAppWebhookMessage;
  userId: number;
  lifecycleHandle: MessageLifecycleHandle;
};

function parseWaterAmountMl(text: string) {
  const normalized = normalizeWhatsAppIntentText(text);
  const mlMatch = normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:m\s*l|ml|mililitros?)\b/);
  if (mlMatch) return Math.round(Number(mlMatch[1].replace(",", ".")));

  const literMatch = normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:l|litros?)\b/);
  if (literMatch) return Math.round(Number(literMatch[1].replace(",", ".")) * 1000);

  return null;
}

function mentionsWater(text?: string) {
  const normalized = normalizeWhatsAppIntentText(text || "");
  return /\baguas?\b/.test(normalized) || /\bhidratacao\b/.test(normalized) || /\bwater\b/.test(normalized);
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

  if (!lifecycleHandle && locallySeen) return "duplicate";

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
  const { result: replyResult } = await sendWhatsAppStandaloneLogicalReply(
    message.from,
    withCtaUrl(textReply(buildWhatsAppOnboardingLeadReplyMessage()), {
      buttonText: "Finalizar cadastro",
      url: onboarding.url,
    }),
  );

  if (!replyResult.primaryOk) {
    logInferenceEvent({
      userId: null,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.onboarding_reply_failed",
      detail: `Falha ao enviar link de onboarding para telefone mascarado ${onboarding.lead.phoneNumberMasked}.`,
    });
  }

  return true;
}

async function handleWaterImageMessage(item: IndexedWhatsAppWebhookMessage, claim: ClaimedMessage | null) {
  const message = item.message;
  if (!message.image?.id || message.audio?.id || !message.from) return false;

  const userId = await getUserIdByWhatsappPhone(message.from);
  if (!userId) return false;

  const caption = getImageCaption(message);
  const amountFromCaption = parseWaterAmountMl(caption || "");
  const captionMentionsWater = mentionsWater(caption);

  if (captionMentionsWater) {
    if (!amountFromCaption || amountFromCaption <= 0 || amountFromCaption > MAX_WATER_LOG_AMOUNT_ML) {
      await sendWaterImageClarification({ userId, sourcePhone: message.from, lifecycleHandle: claim?.lifecycleHandle ?? null });
      return true;
    }

    await registerWaterImage({
      userId,
      sourcePhone: message.from,
      amountMl: amountFromCaption,
      occurredAt: resolveWhatsAppMessageOccurredAt(message),
      detail: "Imagem de água com quantidade explícita na legenda registrada pelo WhatsApp.",
      lifecycleHandle: claim?.lifecycleHandle ?? null,
    });
    return true;
  }

  return false;
}

async function buildCanonicalWaterImageReply(userId: number, amountMl: number, occurredAt: Date) {
  const progress = await getWhatsAppWaterProgress(userId, occurredAt);
  return buildWhatsAppCanonicalWaterReply({
    amountMl,
    totalMl: progress.totalMl,
    goalMl: progress.goalMl,
    occurredAtLabel: occurredAt.toLocaleString("pt-BR", { timeZone: progress.timeZone }),
    totalLabel: progress.dateKey === new Date().toLocaleDateString("en-CA", { timeZone: progress.timeZone })
      ? "Total de hoje"
      : `Total de ${progress.dateKey.split("-").reverse().join("/")}`,
  });
}

async function registerWaterImage(input: { userId: number; sourcePhone: string; amountMl: number; occurredAt: Date; detail: string; lifecycleHandle: MessageLifecycleHandle }) {
  const created = await createUserWaterLog(input.userId, {
    amountMl: input.amountMl,
    occurredAt: input.occurredAt.toISOString(),
  });
  await recordDomainLink(input.lifecycleHandle, { waterLogId: created.id });

  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: "success",
    eventType: "whatsapp.image_water_logged",
    detail: `${input.detail} Registro de hidratação persistido pelo WhatsApp.`,
  });

  const delivery = await sendWhatsAppLogicalDomainReply({
    to: input.sourcePhone,
    userId: input.userId,
    replyText: await buildCanonicalWaterImageReply(input.userId, input.amountMl, input.occurredAt),
    lifecycleHandle: input.lifecycleHandle,
  });
  if (!delivery.result.primaryOk) {
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.reply_failed",
      detail: "Falha ao enviar resposta funcional de hidratação.",
    });
  }
}

async function sendWaterImageClarification(input: { userId: number; sourcePhone: string; lifecycleHandle: MessageLifecycleHandle }) {
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: "warning",
    eventType: "whatsapp.image_water_clarification_needed",
    detail: "Imagem de água recebida sem quantidade explícita para registro de hidratação.",
  });

  const delivery = await sendWhatsAppLogicalDomainReply({
    to: input.sourcePhone,
    userId: input.userId,
    replyText: buildWhatsAppWaterImageClarificationReplyMessage(),
    lifecycleHandle: input.lifecycleHandle,
  });
  if (!delivery.result.primaryOk) {
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.reply_failed",
      detail: "Falha ao enviar clarificação de hidratação.",
    });
  }
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
    if (await handleWaterImageMessage(item, claim)) {
      handledKeys.add(item.key);
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
  const flow = resolveBatchContextFlow(remainingMessages);
  const goalProgressContext = await resolveGoalProgressContext(remainingMessages);
  const result = await runWithWhatsAppGoalProgressContext(
    goalProgressContext,
    () => withWhatsappContextFlow(flow, () => handleWhatsAppWebhookWithTextIntent(req, res)),
  );

  return result;
}

/**
 * Disponibiliza aos formatters downstream as calorias de exercícios por dia,
 * deduplicadas por atividade externa (#784). Falhas não bloqueiam o fluxo:
 * o contexto vazio apenas omite o dado contextual.
 */
async function resolveGoalProgressContext(messages: IndexedWhatsAppWebhookMessage[]) {
  const sourcePhone = messages[0]?.message.from;
  if (!sourcePhone) return { exerciseCaloriesByDateKey: {} };
  try {
    const userId = await getUserIdByWhatsappPhone(sourcePhone);
    if (!userId) return { exerciseCaloriesByDateKey: {} };
    const exercises = await listUserExercises(userId);
    return {
      exerciseCaloriesByDateKey: buildWhatsAppExerciseCaloriesByDateKey(exercises ?? [], formatDateKeyInSaoPaulo),
    };
  } catch {
    return { exerciseCaloriesByDateKey: {} };
  }
}

export async function handleWhatsAppWebhookWithImageIdempotency(req: Request, res: Response) {
  return runWithMessageLifecycleRequestScope(() => handleWhatsAppWebhookWithImageIdempotencyInternal(req, res));
}
