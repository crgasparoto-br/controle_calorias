import { Request, Response } from "express";
import type { GenerateImageResponse } from "./_core/imageGeneration";
import { storagePut } from "./storage";
import { transcribeAudio } from "./_core/voiceTranscription";
import { buildSavedMedia, confirmPendingMeal, createPendingMealInference, createUserWaterLog, getHabitSnapshots, getUserDayMealTotals, getUserIdByWhatsappPhone, getUserNutritionGoal, listUserMeals, logInferenceEvent, relabelUserMeals, updateUserCurrentWeight } from "./db";
import { tryCreateQuickEditLinkForMeal } from "./modules/quickEdit/service";
import { executeWhatsappTextIntent } from "./modules/whatsapp/intentActions";
import { generateAnnotatedMealImage } from "./modules/whatsapp/annotatedImage";
import { buildWhatsAppMealReplyMessage, type WhatsAppMealGoalProgress } from "./modules/whatsapp/replyMessages";
import {
  buildMediaDataUrl,
  downloadWhatsAppMedia,
  extensionFromMimeType,
  extractWhatsAppWebhookMessages,
  formatDateKeyInSaoPaulo,
  isWhatsAppMessageForConfiguredChannel,
  markWhatsAppMessageAsRead,
  normalizeWhatsAppIntentText,
  resolveWhatsAppMessageOccurredAt,
  sendWhatsAppImageMessage,
  sendWhatsAppInteractiveUrlButtonMessage,
  sendWhatsAppTextMessage,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";
import { MealProcessingResult, processMealInput } from "./nutritionEngine";
import { getWhatsAppChannelConfig } from "./whatsappConfig";

type PreparedMessageInput = {
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

type WhatsAppAction = {
  kind: "reclassify_recent_meals";
  fromMealLabel: string;
  toMealLabel: string;
};

type PendingWhatsAppConfirmation = {
  action: WhatsAppAction;
  mealIds: number[];
  createdAt: number;
  expiresAt: number;
  summary: string;
};

type WhatsAppTextIntentResult = NonNullable<Awaited<ReturnType<typeof executeWhatsappTextIntent>>>;

const pendingWhatsAppConfirmations = new Map<number, PendingWhatsAppConfirmation>();
const recentlyHandledWhatsAppMessageIds = new Map<string, number>();
const PENDING_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const MESSAGE_DEDUPLICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PROCESSING_ERROR_REPLY = "Não consegui processar essa mídia agora. Tente enviar novamente ou descreva os alimentos em texto para eu registrar.";
const MEDIA_STORAGE_WARNING = "Falha ao persistir mídia recebida do WhatsApp; processamento seguirá com mídia inline.";
const MAX_WATER_LOG_AMOUNT_ML = 10000;
const MIN_WEIGHT_LOG_KG = 25;
const MAX_WEIGHT_LOG_KG = 350;
const WATER_LOG_ALLOWED_WORDS = [
  "agua",
  "aguas",
  "ml",
  "m l",
  "mililitro",
  "mililitros",
  "l",
  "litro",
  "litros",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "mais",
  "bebi",
  "beber",
  "tomei",
  "tomar",
  "consumi",
  "registrar",
  "registra",
  "registre",
  "registro",
  "registrei",
  "para",
  "por",
  "favor",
  "hoje",
  "agora",
];

async function resolveUserIdFromPhone(sourcePhone: string) {
  return getUserIdByWhatsappPhone(sourcePhone);
}

function getVerifyToken() {
  return getWhatsAppChannelConfig().verifyToken;
}

function formatMacro(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatReplyTime(date: Date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
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

function canonicalMealLabel(label: string) {
  const normalized = normalizeWhatsAppIntentText(label);
  if (normalized.includes("cafe") || normalized.includes("manha")) return "Café da manhã";
  if (normalized.includes("almoco")) return "Almoço";
  if (normalized.includes("janta")) return "Jantar";
  if (normalized.includes("lanche")) return "Lanche";
  if (normalized.includes("bebida")) return "Bebida";
  return label.trim();
}

function getTextBody(message: WhatsAppWebhookMessage) {
  return message.text?.body?.trim() || message.image?.caption?.trim() || "";
}

function detectWhatsAppAction(message: WhatsAppWebhookMessage): WhatsAppAction | null {
  const text = getTextBody(message);
  if (!text || message.image?.id || message.audio?.id) {
    return null;
  }

  const normalized = normalizeWhatsAppIntentText(text);
  const match = normalized.match(/(?:mudar|trocar|alterar)\s+a?\s*refeicao\s+(.+?)\s+para\s+(.+)/i);
  if (!match) {
    return null;
  }

  const fromMealLabel = canonicalMealLabel(match[1] || "");
  const toMealLabel = canonicalMealLabel(match[2] || "");
  if (!fromMealLabel || !toMealLabel || fromMealLabel === toMealLabel) {
    return null;
  }

  return {
    kind: "reclassify_recent_meals",
    fromMealLabel,
    toMealLabel,
  };
}

function isConfirmationMessage(message: WhatsAppWebhookMessage) {
  const normalized = normalizeWhatsAppIntentText(getTextBody(message));
  return ["sim", "confirmar", "confirma", "pode confirmar", "ok", "pode seguir"].includes(normalized);
}

function isCancellationMessage(message: WhatsAppWebhookMessage) {
  const normalized = normalizeWhatsAppIntentText(getTextBody(message));
  return ["nao", "não", "cancelar", "cancela", "parar", "desfazer"].includes(normalized);
}

async function handlePendingWhatsAppConfirmation(message: WhatsAppWebhookMessage, userId: number) {
  const pending = pendingWhatsAppConfirmations.get(userId);
  if (!pending) {
    return null;
  }

  if (pending.expiresAt < Date.now()) {
    pendingWhatsAppConfirmations.delete(userId);
    return {
      handled: true,
      reply: "A solicitação anterior expirou. Se ainda quiser alterar a classificação das refeições, envie o comando novamente.",
      eventType: "whatsapp.action_confirmation_expired",
      detail: `Confirmação expirada para ${pending.summary}.`,
    };
  }

  if (isCancellationMessage(message)) {
    pendingWhatsAppConfirmations.delete(userId);
    return {
      handled: true,
      reply: "Tudo certo. Não alterei nenhum registro histórico.",
      eventType: "whatsapp.action_cancelled",
      detail: `Confirmação cancelada para ${pending.summary}.`,
    };
  }

  if (!isConfirmationMessage(message)) {
    return null;
  }

  const updatedMeals = await relabelUserMeals({
    userId,
    mealIds: pending.mealIds,
    mealLabel: pending.action.toMealLabel,
    origin: "whatsapp",
  });
  pendingWhatsAppConfirmations.delete(userId);

  return {
    handled: true,
    reply: `${updatedMeals.length} registro(s) recente(s) foram alterados de ${pending.action.fromMealLabel} para ${pending.action.toMealLabel}.`,
    eventType: "whatsapp.action_applied",
    detail: `Comando confirmado e executado com sucesso: ${pending.summary} em ${updatedMeals.length} registro(s).`,
  };
}

async function handleWhatsAppAction(action: WhatsAppAction, userId: number) {
  const recentMeals = (await listUserMeals(userId))
    .filter(meal => meal.source === "whatsapp")
    .slice(0, 3);
  const matchingMeals = recentMeals.filter(
    meal => canonicalMealLabel(meal.mealLabel) === action.fromMealLabel,
  );

  if (!recentMeals.length || !matchingMeals.length) {
    return {
      handled: true,
      reply: `Não encontrei refeições recentes no WhatsApp marcadas como ${action.fromMealLabel}. Me diga quais alimentos você quer mover para ${action.toMealLabel}.`,
      eventType: "whatsapp.action_clarification_needed",
      detail: `Comando de reclassificação sem refeições recentes compatíveis: ${action.fromMealLabel} → ${action.toMealLabel}.`,
    };
  }

  if (matchingMeals.length !== recentMeals.length) {
    const recentSummary = recentMeals
      .map(meal => `${meal.mealLabel} às ${formatReplyTime(new Date(meal.occurredAt))}`)
      .join(", ");

    return {
      handled: true,
      reply: `Encontrei registros recentes com classificações diferentes (${recentSummary}). Você quer que eu mova apenas os itens marcados como ${action.fromMealLabel} ou todos os últimos ${recentMeals.length} registros para ${action.toMealLabel}?`,
      eventType: "whatsapp.action_clarification_needed",
      detail: `Comando ambíguo de reclassificação para ${action.toMealLabel}. Registros recentes: ${recentSummary}.`,
    };
  }

  const summary = `${action.fromMealLabel} → ${action.toMealLabel}`;
  pendingWhatsAppConfirmations.set(userId, {
    action,
    mealIds: matchingMeals.map(meal => meal.id),
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_CONFIRMATION_TTL_MS,
    summary,
  });

  return {
    handled: true,
    reply: `Encontrei ${matchingMeals.length} registro(s) recente(s) marcados como ${action.fromMealLabel}. Responda SIM para confirmar a mudança para ${action.toMealLabel} ou CANCELAR para desistir.`,
    eventType: "whatsapp.action_confirmation_requested",
    detail: `Confirmação solicitada para ${summary} em ${matchingMeals.length} registro(s).`,
  };
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

function isWaterOnlyText(text: string) {
  const normalized = normalizeWhatsAppIntentText(text);
  if (!/\baguas?\b/.test(normalized)) {
    return false;
  }

  const remaining = normalized
    .replace(/\d+(?:[,.]\d+)?/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !WATER_LOG_ALLOWED_WORDS.includes(word));

  return remaining.length === 0;
}

function detectWaterLogFromMessage(message: WhatsAppWebhookMessage) {
  const text = getTextBody(message);
  if (!text || message.image?.id || message.audio?.id) {
    return null;
  }

  if (!isWaterOnlyText(text)) {
    return null;
  }

  const amountMl = parseWaterAmountMl(text);
  if (!amountMl || amountMl <= 0 || amountMl > MAX_WATER_LOG_AMOUNT_ML) {
    return null;
  }

  return { amountMl };
}

function parseWeightKg(text: string) {
  const normalized = normalizeWhatsAppIntentText(text);
  const kgMatch = normalized.match(/(?:\bpeso\b|\bpesei\b|\bpesando\b|\bpeso atual\b)?\s*(\d{2,3}(?:[,.]\d{1,2})?)\s*(?:kg|kgs|quilo|quilos)\b/);
  if (kgMatch) {
    return Number(kgMatch[1].replace(",", "."));
  }

  const numberBeforeWeightMatch = normalized.match(/\b(\d{2,3}(?:[,.]\d{1,2})?)\s*(?:de\s*)?(?:peso|pesei|pesando|peso atual)\b/);
  if (numberBeforeWeightMatch) {
    return Number(numberBeforeWeightMatch[1].replace(",", "."));
  }

  const weightFirstMatch = normalized.match(/\b(?:peso|pesei|pesando|peso atual)\b[^\d]*(\d{2,3}(?:[,.]\d{1,2})?)\b/);
  if (weightFirstMatch) {
    return Number(weightFirstMatch[1].replace(",", "."));
  }

  return null;
}

function detectWeightLogFromMessage(message: WhatsAppWebhookMessage) {
  const text = getTextBody(message);
  if (!text || message.image?.id || message.audio?.id) {
    return null;
  }

  const normalized = normalizeWhatsAppIntentText(text);
  if (!/\b(peso|pesei|pesando|kg|kgs|quilo|quilos)\b/.test(normalized)) {
    return null;
  }

  const weightKg = parseWeightKg(text);
  if (!weightKg || weightKg < MIN_WEIGHT_LOG_KG || weightKg > MAX_WEIGHT_LOG_KG) {
    return null;
  }

  return { weightKg };
}

function buildWaterLogReply(amountMl: number, occurredAt: Date) {
  return `Registrei ${formatMacro(amountMl)} ml de água às ${formatReplyTime(occurredAt)}.`;
}

function buildWeightLogReply(weightKg: number, occurredAt: Date) {
  return `Atualizei seu peso atual para ${formatMacro(weightKg)} kg às ${formatReplyTime(occurredAt)}.`;
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

function canInterpretAudioTranscriptIntent(message: WhatsAppWebhookMessage, prepared: PreparedMessageInput) {
  return Boolean(message.audio?.id && !message.image?.id && prepared.transcript?.trim());
}

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
    userId: await resolveUserIdFromPhone(sourcePhone),
    origin: "whatsapp",
    status: "warning",
    eventType: "whatsapp.media_storage_warning",
    detail: warning,
  });
}

async function prepareMessageInput(message: WhatsAppWebhookMessage, sourcePhone: string): Promise<PreparedMessageInput> {
  const text = getTextBody(message) || undefined;
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
        userId: await resolveUserIdFromPhone(sourcePhone),
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
          detail: `Consumo de ${waterLog.amountMl} ml de água registrado pelo WhatsApp às ${formatReplyTime(occurredAt)}.`,
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
          detail: `Peso de ${formatMacro(weightLog.weightKg)} kg registrado pelo WhatsApp às ${formatReplyTime(occurredAt)}.`,
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
      const processedForPersistence = {
        ...processed,
        imageUrl: prepared.imageUrl,
      };
      const occurredAt = resolveWhatsAppMessageOccurredAt(message);
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

      logInferenceEvent({
        userId,
        origin: "whatsapp",
        status: "success",
        eventType: "whatsapp.message_processed",
        detail: `Mensagem ${prepared.summary} de ${sourcePhone} processada e refeição ${savedMeal.mealLabel} registrada automaticamente às ${formatReplyTime(occurredAt)}.`,
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
    }
  }

  return res.status(200).json({ ok: true, processed: messages.length });
}
