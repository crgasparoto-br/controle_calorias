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

const reservedImageMessageIds = new Map<string, number>();
const IMAGE_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_WATER_LOG_AMOUNT_ML = 10000;

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

async function handleOnboardingLeadMessage(item: IndexedWhatsAppWebhookMessage) {
  const message = item.message;
  if (!message.from) {
    return false;
  }

  const userId = await getUserIdByWhatsappPhone(message.from);
  if (userId) {
    return false;
  }

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
  if (!message.image?.id || message.audio?.id || !message.from) {
    return false;
  }

  const userId = await getUserIdByWhatsappPhone(message.from);
  if (!userId) {
    return false;
  }

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

  // Sem menção explícita de água na legenda, a imagem deve seguir para o fluxo
  // nutricional normal para evitar falso positivo de hidratação.
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
      detail: `Falha ao enviar resposta automática para ${input.sourcePhone}: ${replyResult.detail}`,
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
      detail: `Falha ao enviar resposta automática para ${input.sourcePhone}: ${replyResult.detail}`,
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
        if (seenExternalReferences.has(externalReference)) {
          return total;
        }
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
    if (!sourcePhone) {
      continue;
    }

    const dateKey = formatDateKeyInSaoPaulo(resolveWhatsAppMessageOccurredAt(item.message));
    const cacheKey = `${sourcePhone}:${dateKey}`;
    if (seen.has(cacheKey)) {
      continue;
    }
    seen.add(cacheKey);

    try {
      const userId = await getUserIdByWhatsappPhone(sourcePhone);
      if (!userId) {
        continue;
      }

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

function pruneReservations(now = Date.now()) {
  for (const [messageId, expiresAt] of reservedImageMessageIds) {
    if (expiresAt <= now) {
      reservedImageMessageIds.delete(messageId);
    }
  }
}

function reserveImageMessages(messages: IndexedWhatsAppWebhookMessage[]) {
  const duplicateKeys = new Set<string>();
  const now = Date.now();
  pruneReservations(now);

  for (const item of messages) {
    const messageId = item.message.id;
    if (!messageId || !item.message.image?.id) {
      continue;
    }

    if (reservedImageMessageIds.has(messageId)) {
      duplicateKeys.add(item.key);
      continue;
    }

    reservedImageMessageIds.set(messageId, now + IMAGE_MESSAGE_TTL_MS);
  }

  return duplicateKeys;
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

          return {
            ...change,
            value: {
              ...change.value,
              messages: filteredMessages,
            },
          };
        })
        .filter((change: any) => Array.isArray(change?.value?.messages) && change.value.messages.length > 0);

      return {
        ...entry,
        changes: filteredChanges,
      };
    })
    .filter((entry: any) => Array.isArray(entry?.changes) && entry.changes.length > 0);

  return cloned;
}

export function __resetWhatsAppImageIdempotencyForTests() {
  reservedImageMessageIds.clear();
}

export async function handleWhatsAppWebhookWithImageIdempotency(req: Request, res: Response) {
  const messages = extractIndexedWhatsAppWebhookMessages(req.body);
  const duplicateKeys = reserveImageMessages(messages);
  const handledKeys = new Set(duplicateKeys);

  for (const item of messages) {
    if (handledKeys.has(item.key)) {
      continue;
    }

    if (await handleOnboardingLeadMessage(item)) {
      handledKeys.add(item.key);
      continue;
    }

    if (await handleWaterImageMessage(item)) {
      handledKeys.add(item.key);
    }
  }

  if (handledKeys.size > 0) {
    const remainingPayload = clonePayloadWithoutKeys(req.body, handledKeys);
    if (!Array.isArray(remainingPayload?.entry) || remainingPayload.entry.length === 0) {
      if (duplicateKeys.size > 0 && duplicateKeys.size === handledKeys.size) {
        return res.status(200).json({ ok: true, processed: 0, deduplicated: true });
      }
      return res.status(200).json({ ok: true, processed: messages.length });
    }

    req.body = remainingPayload;
  }

  const context = await buildExerciseCaloriesContext(extractIndexedWhatsAppWebhookMessages(req.body));
  return runWithWhatsAppGoalProgressContext(context, () => handleWhatsAppWebhookWithTextIntent(req, res));
}