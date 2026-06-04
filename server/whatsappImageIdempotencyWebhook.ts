import { Request, Response } from "express";
import { createUserWaterLog, getUserIdByWhatsappPhone, listUserExercises, logInferenceEvent } from "./db";
import { runWithWhatsAppGoalProgressContext } from "./modules/whatsapp/goalProgressContext";
import { processMealInput, type MealProcessingResult } from "./nutritionEngine";
import { requireWhatsAppMediaConfig, requireWhatsAppSendConfig } from "./whatsappConfig";
import { handleWhatsAppWebhookWithTextIntent } from "./whatsappIntentWebhook";

type WhatsAppMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string };
};

type IndexedMessage = {
  key: string;
  message: WhatsAppMessage;
};

const reservedImageMessageIds = new Map<string, number>();
const IMAGE_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_WATER_LOG_AMOUNT_ML = 10000;

function extractMessages(payload: any): IndexedMessage[] {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.flatMap((entry: any, entryIndex: number) =>
    Array.isArray(entry?.changes)
      ? entry.changes.flatMap((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          return messages.map((message: WhatsAppMessage, messageIndex: number) => ({
            key: `${entryIndex}:${changeIndex}:${messageIndex}`,
            message,
          }));
        })
      : [],
  );
}

function resolveOccurredAt(message: WhatsAppMessage) {
  const parsed = Number(message.timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return new Date();
  }

  return new Date(String(message.timestamp).length <= 10 ? parsed * 1000 : parsed);
}

function formatDateKeyInSaoPaulo(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

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

function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseWaterAmountMl(text: string) {
  const normalized = normalizeIntentText(text);
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
  const normalized = normalizeIntentText(text || "");
  return /\baguas?\b/.test(normalized) || /\bhidratacao\b/.test(normalized) || /\bwater\b/.test(normalized);
}

function buildWaterLogReply(amountMl: number, occurredAt: Date) {
  return `Registrei ${formatNumber(amountMl)} ml de água às ${formatReplyTime(occurredAt)}.`;
}

function buildWaterImageClarificationReply() {
  return "Identifiquei água na imagem. Para registrar corretamente, me diga a quantidade aproximada, por exemplo: 300 ml de água.";
}

function isSameDateKeyInSaoPaulo(value: number | string | Date, dateKey: string) {
  return formatDateKeyInSaoPaulo(new Date(value)) === dateKey;
}

function getImageCaption(message: WhatsAppMessage) {
  return message.image?.caption?.trim() || message.text?.body?.trim() || "";
}

function isWaterLikeMealResult(processed: MealProcessingResult) {
  const itemTexts = processed.items.map(item => [item.foodName, item.canonicalName, item.portionText].join(" "));
  const searchable = [processed.detectedMealLabel, processed.sourceText, ...itemTexts].filter(Boolean).join(" ");
  const waterMentioned = mentionsWater(searchable);
  if (!waterMentioned) {
    return false;
  }

  const hasNonWaterItem = processed.items.some(item => {
    const text = [item.foodName, item.canonicalName].filter(Boolean).join(" ");
    return !mentionsWater(text) && Number(item.calories || 0) > 5;
  });

  return !hasNonWaterItem && Number(processed.totals?.calories || 0) <= 10;
}

async function sendWhatsAppTextMessage(to: string, body: string) {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de resposta.",
    };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          preview_url: false,
          body,
        },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Meta retornou ${response.status} ${response.statusText} no envio da resposta automática.`,
      };
    }

    return { ok: true, detail: "Resposta automática enviada com sucesso." };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar resposta automática do WhatsApp.",
    };
  }
}

async function downloadImageForAnalysis(message: WhatsAppMessage) {
  const mediaId = message.image?.id;
  if (!mediaId) {
    return null;
  }

  const { accessToken } = await requireWhatsAppMediaConfig();
  const metaResponse = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaResponse.ok) {
    throw new Error(`Falha ao obter URL da imagem do WhatsApp: ${metaResponse.status} ${metaResponse.statusText}`);
  }

  const meta = await metaResponse.json() as { url?: string; mime_type?: string };
  if (!meta.url) {
    throw new Error("A API do WhatsApp não retornou a URL da imagem.");
  }

  const imageResponse = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!imageResponse.ok) {
    throw new Error(`Falha ao baixar imagem do WhatsApp: ${imageResponse.status} ${imageResponse.statusText}`);
  }

  const mimeType = imageResponse.headers.get("content-type") || meta.mime_type || message.image?.mime_type || "image/jpeg";
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function handleWaterImageMessage(item: IndexedMessage) {
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
      occurredAt: resolveOccurredAt(message),
      detail: "Imagem de água com quantidade explícita na legenda registrada pelo WhatsApp.",
    });
    return true;
  }

  try {
    const imageUrl = await downloadImageForAnalysis(message);
    if (!imageUrl) {
      return false;
    }

    const processed = await processMealInput({
      text: "Analise se esta imagem mostra apenas água/bebida sem calorias. Não invente alimentos.",
      imageUrl,
    });

    if (!isWaterLikeMealResult(processed)) {
      return false;
    }

    await sendWaterImageClarification({ userId, sourcePhone: message.from });
    return true;
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.image_water_detection_warning",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao analisar imagem de hidratação.",
    });
    return false;
  }
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

async function buildExerciseCaloriesContext(messages: IndexedMessage[]) {
  const context: Record<string, number> = {};
  const seen = new Set<string>();

  for (const item of messages) {
    const sourcePhone = item.message.from;
    if (!sourcePhone) {
      continue;
    }

    const dateKey = formatDateKeyInSaoPaulo(resolveOccurredAt(item.message));
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
      context[dateKey] = (context[dateKey] ?? 0) + exercises
        .filter(exercise => isSameDateKeyInSaoPaulo(Number(exercise.occurredAt), dateKey))
        .reduce((acc, exercise) => acc + Number(exercise.caloriesBurned || 0), 0);
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

function reserveImageMessages(messages: IndexedMessage[]) {
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
            (_message: WhatsAppMessage, messageIndex: number) => !handledKeys.has(`${entryIndex}:${changeIndex}:${messageIndex}`),
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
  const messages = extractMessages(req.body);
  const duplicateKeys = reserveImageMessages(messages);
  const handledKeys = new Set(duplicateKeys);

  for (const item of messages) {
    if (handledKeys.has(item.key)) {
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

  const context = await buildExerciseCaloriesContext(extractMessages(req.body));
  return runWithWhatsAppGoalProgressContext(context, () => handleWhatsAppWebhookWithTextIntent(req, res));
}
