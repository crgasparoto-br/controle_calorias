import { Request, Response } from "express";
import { generateImage, type GenerateImageResponse } from "./_core/imageGeneration";
import { storagePut } from "./storage";
import { transcribeAudio } from "./_core/voiceTranscription";
import { buildSavedMedia, confirmPendingMeal, createPendingMealInference, createUserWaterLog, getHabitSnapshots, getUserIdByWhatsappPhone, listUserMeals, logInferenceEvent, relabelUserMeals, updateUserCurrentWeight } from "./db";
import { executeWhatsappTextIntent } from "./modules/whatsapp/intentActions";
import { MealProcessingResult, processMealInput } from "./nutritionEngine";
import { getWhatsAppChannelConfig, requireWhatsAppMediaConfig, requireWhatsAppSendConfig } from "./whatsappConfig";

type WhatsAppMessage = {
  id?: string;
  from?: string;
  channelPhoneNumberId?: string;
  channelDisplayPhoneNumber?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
};

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

function extractMessages(payload: any): WhatsAppMessage[] {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.flatMap((entry: any) =>
    Array.isArray(entry?.changes)
      ? entry.changes.flatMap((change: any) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          return messages.map((message: WhatsAppMessage) => ({
            ...message,
            channelPhoneNumberId: change?.value?.metadata?.phone_number_id,
            channelDisplayPhoneNumber: change?.value?.metadata?.display_phone_number,
          }));
        })
      : [],
  );
}

function isMessageForConfiguredChannel(message: WhatsAppMessage) {
  const configuredPhoneNumberId = getWhatsAppChannelConfig().phoneNumberId;
  return !message.channelPhoneNumberId || !configuredPhoneNumberId || message.channelPhoneNumberId === configuredPhoneNumberId;
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

function getMealEmoji(mealLabel: string) {
  const normalized = mealLabel.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  if (normalized.includes("cafe")) return "☕";
  if (normalized.includes("almoco")) return "🍽️";
  if (normalized.includes("jantar")) return "🌙";
  if (normalized.includes("lanche")) return "🥪";
  return "🍎";
}

function resolveOccurredAt(message: WhatsAppMessage) {
  const parsed = Number(message.timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return new Date();
  }

  return new Date(String(message.timestamp).length <= 10 ? parsed * 1000 : parsed);
}

function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function canonicalMealLabel(label: string) {
  const normalized = normalizeIntentText(label);
  if (normalized.includes("cafe") || normalized.includes("manha")) return "Café da manhã";
  if (normalized.includes("almoco")) return "Almoço";
  if (normalized.includes("janta")) return "Jantar";
  if (normalized.includes("lanche")) return "Lanche";
  if (normalized.includes("bebida")) return "Bebida";
  return label.trim();
}

function getTextBody(message: WhatsAppMessage) {
  return message.text?.body?.trim() || message.image?.caption?.trim() || "";
}

function detectWhatsAppAction(message: WhatsAppMessage): WhatsAppAction | null {
  const text = getTextBody(message);
  if (!text || message.image?.id || message.audio?.id) {
    return null;
  }

  const normalized = normalizeIntentText(text);
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

function isConfirmationMessage(message: WhatsAppMessage) {
  const normalized = normalizeIntentText(getTextBody(message));
  return ["sim", "confirmar", "confirma", "pode confirmar", "ok", "pode seguir"].includes(normalized);
}

function isCancellationMessage(message: WhatsAppMessage) {
  const normalized = normalizeIntentText(getTextBody(message));
  return ["nao", "não", "cancelar", "cancela", "parar", "desfazer"].includes(normalized);
}

function formatFoodDescription(item: MealProcessingResult["items"][number]) {
  const portionHasGrams = /\d\s*g\b/i.test(item.portionText);
  const gramsLabel = !portionHasGrams && item.estimatedGrams > 0 ? ` (aprox. ${formatMacro(item.estimatedGrams)}g)` : "";
  return `${item.portionText}${gramsLabel} ${item.foodName}`.trim();
}

function formatFoodMacroDetails(item: MealProcessingResult["items"][number]) {
  return `${formatMacro(item.calories)} kcal | P ${formatMacro(item.protein)}g | C ${formatMacro(item.carbs)}g | G ${formatMacro(item.fat)}g`;
}

function buildWhatsAppReplyMessage(processed: MealProcessingResult, registeredAt = new Date()) {
  const mealLabel = processed.detectedMealLabel || "Refeição";
  const mealHeader = `${getMealEmoji(mealLabel)} ${mealLabel}:`;
  const timeLabel = formatReplyTime(registeredAt);
  const calories = formatMacro(processed.totals.calories);

  if (!processed.items.length) {
    return [
      mealHeader,
      processed.sourceText || "Alimento não identificado.",
      `Total estimado: ${calories} kcal.`,
      `Horário: ${timeLabel}.`,
    ].join("\n");
  }

  const foodLines = processed.items
    .map((item, index) => `${index + 1}. ${formatFoodDescription(item)} — ${formatFoodMacroDetails(item)}`)
    .filter(Boolean);

  return [
    mealHeader,
    "Alimentos e macros:",
    ...foodLines,
    `Total estimado: ${calories} kcal | P ${formatMacro(processed.totals.protein)}g | C ${formatMacro(processed.totals.carbs)}g | G ${formatMacro(processed.totals.fat)}g.`,
    `Horário: ${timeLabel}.`,
  ].join("\n");
}

function imageDataFromDataUrl(dataUrl?: string) {
  const match = dataUrl?.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], b64Json: match[2] };
}

function buildAnnotatedMealImagePrompt(processed: MealProcessingResult) {
  const labels = processed.items
    .slice(0, 12)
    .map((item, index) => `${index + 1}. ${item.foodName}: ${formatMacro(item.calories)} kcal, P ${formatMacro(item.protein)}g, C ${formatMacro(item.carbs)}g, G ${formatMacro(item.fat)}g`)
    .join("\n");

  return [
    "Edite a foto original da refeição adicionando legendas visuais sobre os alimentos identificados, no estilo de análise nutricional da imagem de referência.",
    "Use etiquetas verdes translúcidas com texto grande e linhas discretas apontando para cada alimento quando fizer sentido.",
    "Cada legenda deve mostrar nome do alimento, calorias e macronutrientes no formato P/C/G em gramas.",
    "Mantenha a foto realista, preserve o prato original e não adicione alimentos novos.",
    "Use texto em português do Brasil, grande e legível em celular.",
    `Itens detectados:\n${labels || "Alimentos identificados na refeição."}`,
  ].join("\n");
}

function buildMealCardsImagePrompt(processed: MealProcessingResult) {
  const labels = processed.items
    .slice(0, 12)
    .map((item, index) => `${index + 1}. ${item.foodName}: ${formatFoodDescription(item)}, ${formatMacro(item.calories)} kcal, proteína ${formatMacro(item.protein)}g, carboidratos ${formatMacro(item.carbs)}g, gorduras ${formatMacro(item.fat)}g`)
    .join("\n");

  return [
    "Crie uma imagem quadrada com cards nutricionais limpos e legíveis para celular.",
    "Use fundo claro, cards organizados, ícones simples de comida e texto em português do Brasil.",
    "Cada card deve mostrar alimento, porção, calorias e macronutrientes P/C/G.",
    "Não inclua foto real nem alimentos novos; use apenas os dados abaixo.",
    `Refeição: ${processed.detectedMealLabel || "Refeição"}`,
    `Total: ${formatMacro(processed.totals.calories)} kcal | P ${formatMacro(processed.totals.protein)}g | C ${formatMacro(processed.totals.carbs)}g | G ${formatMacro(processed.totals.fat)}g`,
    `Itens:\n${labels || "Alimentos identificados na refeição."}`,
  ].join("\n");
}

async function generateAnnotatedMealImage(processed: MealProcessingResult, prepared: PreparedMessageInput): Promise<GenerateImageResponse> {
  const sourceImage = imageDataFromDataUrl(prepared.imageAnalysisUrl);
  if (!processed.items.length) {
    return { skippedReason: "no_prompt" };
  }

  if (sourceImage) {
    const editedImage = await generateImage({
      prompt: buildAnnotatedMealImagePrompt(processed),
      originalImages: [sourceImage],
    });

    if (editedImage.url) {
      return editedImage;
    }
  }

  return generateImage({
    prompt: buildMealCardsImagePrompt(processed),
  });
}

async function handlePendingWhatsAppConfirmation(message: WhatsAppMessage, userId: number) {
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

    return {
      ok: true,
      detail: "Resposta automática enviada com sucesso.",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar resposta automática do WhatsApp.",
    };
  }
}

async function sendWhatsAppImageMessage(to: string, imageUrl: string, caption: string) {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de imagem.",
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
        type: "image",
        image: {
          link: imageUrl,
          caption,
        },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Meta retornou ${response.status} ${response.statusText} no envio da imagem anotada.`,
      };
    }

    return {
      ok: true,
      detail: "Imagem anotada enviada com sucesso.",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar imagem anotada do WhatsApp.",
    };
  }
}

async function markWhatsAppMessageAsRead(messageId?: string) {
  if (!messageId) {
    return { ok: true, detail: "Mensagem sem ID para marcar como lida." };
  }

  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para marcar mensagem como lida.",
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
        status: "read",
        message_id: messageId,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Meta retornou ${response.status} ${response.statusText} ao marcar mensagem como lida.`,
      };
    }

    return {
      ok: true,
      detail: "Mensagem marcada como lida.",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao marcar mensagem do WhatsApp como lida.",
    };
  }
}

function listMessageContentTypes(message: WhatsAppMessage) {
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

function buildProcessingAcknowledgement(message: WhatsAppMessage) {
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

function isWaterOnlyText(text: string) {
  const normalized = normalizeIntentText(text);
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

function detectWaterLogFromMessage(message: WhatsAppMessage) {
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
  const normalized = normalizeIntentText(text);
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

function detectWeightLogFromMessage(message: WhatsAppMessage) {
  const text = getTextBody(message);
  if (!text || message.image?.id || message.audio?.id) {
    return null;
  }

  const normalized = normalizeIntentText(text);
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

  const replyResult = await sendWhatsAppTextMessage(input.sourcePhone, input.interpreted.reply);
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

function canInterpretAudioTranscriptIntent(message: WhatsAppMessage, prepared: PreparedMessageInput) {
  return Boolean(message.audio?.id && !message.image?.id && prepared.transcript?.trim());
}

async function getMediaDownloadUrl(mediaId: string) {
  const { accessToken } = await requireWhatsAppMediaConfig();

  const response = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Falha ao obter URL da mídia do WhatsApp: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as { url?: string; mime_type?: string };
  if (!payload.url) {
    throw new Error("A API do WhatsApp não retornou a URL da mídia.");
  }

  return { url: payload.url, mimeType: payload.mime_type };
}

async function downloadWhatsAppMedia(mediaId: string, fallbackMimeType?: string) {
  const { accessToken } = await requireWhatsAppMediaConfig();

  const meta = await getMediaDownloadUrl(mediaId);
  const response = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar mídia do WhatsApp: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    mimeType: response.headers.get("content-type") || meta.mimeType || fallbackMimeType || "application/octet-stream",
  };
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  return "bin";
}

function buildMediaDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
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

async function prepareMessageInput(message: WhatsAppMessage, sourcePhone: string): Promise<PreparedMessageInput> {
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

function isSupportedMessage(message: WhatsAppMessage) {
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
  const messages = extractMessages(req.body);

  if (!messages.length) {
    return res.status(200).json({ ok: true, processed: 0 });
  }

  for (const message of messages) {
    const sourcePhone = message.from || "unknown";

    if (!reserveWhatsAppMessageForProcessing(message.id)) {
      continue;
    }

    if (!isMessageForConfiguredChannel(message)) {
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
        const occurredAt = resolveOccurredAt(message);
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
        const occurredAt = resolveOccurredAt(message);
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
          receivedAt: resolveOccurredAt(message),
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
      const occurredAt = resolveOccurredAt(message);
      const draft = createPendingMealInference(userId, "whatsapp", processedForPersistence, prepared.media);
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

      const replyResult = await sendWhatsAppTextMessage(
        sourcePhone,
        buildWhatsAppReplyMessage(processedForPersistence, occurredAt),
      );

      if (!replyResult.ok) {
        logInferenceEvent({
          userId,
          origin: "whatsapp",
          status: "warning",
          eventType: "whatsapp.reply_failed",
          detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
        });
      }

      if (message.image?.id) {
        const annotatedImage = await generateAnnotatedMealImage(processedForPersistence, prepared);
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
        } else {
          logInferenceEvent({
            userId,
            origin: "whatsapp",
            status: "warning",
            eventType: "whatsapp.annotated_image_skipped",
            detail: `Imagem anotada não enviada para ${sourcePhone}: ${annotatedImage?.detail || annotatedImage?.skippedReason || "geração sem URL"}.`,
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
