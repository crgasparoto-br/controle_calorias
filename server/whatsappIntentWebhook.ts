import { Request, Response } from "express";
import { getCatalogCache } from "./catalogRuntime";
import { executeWhatsappTextIntent } from "./modules/whatsapp/intentActions";
import { getUserIdByWhatsappPhone, getUserNutritionGoal, listUserExercises, logInferenceEvent } from "./db";
import { listMeals } from "./modules/meals/service";
import { getWhatsAppChannelConfig, requireWhatsAppSendConfig } from "./whatsappConfig";
import { handleWhatsAppWebhookWithAnnotatedImages } from "./whatsappAnnotatedImageWebhook";
import { toLogicalDateInTimeZone } from "../shared/timeZone";

type WhatsAppMessage = {
  id?: string;
  from?: string;
  channelPhoneNumberId?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  audio?: { id?: string };
};

type ExtractedWhatsAppMessage = WhatsAppMessage & {
  entryIndex: number;
  changeIndex: number;
  messageIndex: number;
};

type TextIntentResult = NonNullable<Awaited<ReturnType<typeof executeWhatsappTextIntent>>>;
type NutritionTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

const recentlyHandledTextIntentMessageIds = new Map<string, number>();
const pendingTextIntentContexts = new Map<number, { kind: "period_report"; expiresAt: number }>();
const TEXT_INTENT_DEDUPLICATION_TTL_MS = 24 * 60 * 60 * 1000;
const TEXT_INTENT_CONTEXT_TTL_MS = 10 * 60 * 1000;
const UNKNOWN_FOOD_REPLY = [
  "Não encontrei esse alimento no catálogo ainda.",
  "Me envie com mais detalhes, como marca, porção ou uma foto do rótulo, para eu conseguir registrar corretamente.",
  "Exemplo: 1 unidade de bisnaguinha Panco ou 30 g de queijo.",
].join("\n\n");

function extractMessages(payload: any): ExtractedWhatsAppMessage[] {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.flatMap((entry: any, entryIndex: number) =>
    Array.isArray(entry?.changes)
      ? entry.changes.flatMap((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          return messages.map((message: WhatsAppMessage, messageIndex: number) => ({
            ...message,
            entryIndex,
            changeIndex,
            messageIndex,
            channelPhoneNumberId: change?.value?.metadata?.phone_number_id,
          }));
        })
      : [],
  );
}

function isMessageForConfiguredChannel(message: WhatsAppMessage) {
  const configuredPhoneNumberId = getWhatsAppChannelConfig().phoneNumberId;
  return !message.channelPhoneNumberId || !configuredPhoneNumberId || message.channelPhoneNumberId === configuredPhoneNumberId;
}

function resolveOccurredAt(message: WhatsAppMessage) {
  const parsed = Number(message.timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) return new Date();
  return new Date(String(message.timestamp).length <= 10 ? parsed * 1000 : parsed);
}

function getTextBody(message: WhatsAppMessage) {
  return message.text?.body?.trim() || "";
}

function canInterpretTextIntent(message: WhatsAppMessage) {
  return Boolean(getTextBody(message) && !message.image?.id && !message.audio?.id);
}

function getExtractedMessageKey(message: ExtractedWhatsAppMessage) {
  return `${message.entryIndex}:${message.changeIndex}:${message.messageIndex}`;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function extractSimpleFoodCandidate(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  if (
    /[,;+\n]/.test(text)
    || /\b(e|com)\b/.test(normalized)
    || /\b(resumo|relatorio|balanco|sugestao|agua|peso|mudar|alterar|trocar|corrigir|reduzir|aumentar|adicionar|registrar|registra|registre|inclua|remover|tirar|almocei|jantei|comi|lanchei|refeicao)\b/.test(normalized)
  ) return null;

  const candidate = normalized
    .replace(/^\d+(?:[,.]\d+)?\s*/, "")
    .replace(/^(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+/, "")
    .replace(/^(?:unidades?|unid|und|porcoes?|porcao|fatias?|pedacos?|xicaras?|copos?|colheres?)\s+(?:de\s+)?/, "")
    .trim();

  if (!candidate || candidate.split(/\s+/).length < 2 || candidate.split(/\s+/).length > 5) return null;
  return candidate;
}

function catalogContainsFood(candidate: string) {
  const normalizedCandidate = normalizeText(candidate);
  return getCatalogCache().some(item => {
    const names = [item.name, ...item.aliases].map(normalizeText).filter(Boolean);
    return names.some(name => name === normalizedCandidate || normalizedCandidate.includes(name) || name.includes(normalizedCandidate));
  });
}

function buildUnknownFoodReply(text: string) {
  const candidate = extractSimpleFoodCandidate(text);
  if (!candidate || catalogContainsFood(candidate)) return null;
  return UNKNOWN_FOOD_REPLY;
}

function isBareDailySummaryRequest(text: string) {
  const normalized = normalizeText(text);
  return normalized === "resumo" || normalized === "relatorio" || normalized === "balanco";
}

function isInsidePeriod(value: number | string | Date, start: Date, end: Date) {
  const time = new Date(value).getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function sumMealItems(items: Array<{ calories?: number; protein?: number; carbs?: number; fat?: number }>): NutritionTotals {
  return items.reduce<NutritionTotals>(
    (acc, item) => ({
      calories: acc.calories + Number(item.calories || 0),
      protein: acc.protein + Number(item.protein || 0),
      carbs: acc.carbs + Number(item.carbs || 0),
      fat: acc.fat + Number(item.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function countPeriodDays(start: Date, end: Date) {
  const startDay = toLogicalDateInTimeZone(start);
  const endDay = toLogicalDateInTimeZone(end);
  return Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1);
}

async function buildExerciseAwarePeriodReportReply(userId: number, result: TextIntentResult) {
  if (result.action !== "period_report") return result.reply;

  const start = typeof result.data?.start === "string" ? new Date(result.data.start) : null;
  const end = typeof result.data?.end === "string" ? new Date(result.data.end) : null;
  const label = typeof result.data?.periodLabel === "string" ? result.data.periodLabel : "período";
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return result.reply;
  }

  const [meals, exercises, goal] = await Promise.all([
    listMeals(userId),
    listUserExercises(userId),
    getUserNutritionGoal(userId),
  ]);
  const mealsInPeriod = meals.filter(meal => isInsidePeriod(meal.occurredAt, start, end));
  const exercisesInPeriod = exercises.filter(exercise => isInsidePeriod(Number(exercise.occurredAt), start, end));
  const totals = mealsInPeriod.reduce<NutritionTotals>((acc, meal) => {
    const itemTotals = sumMealItems(meal.items ?? []);
    acc.calories += itemTotals.calories;
    acc.protein += itemTotals.protein;
    acc.carbs += itemTotals.carbs;
    acc.fat += itemTotals.fat;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const exerciseCalories = exercisesInPeriod.reduce((acc, exercise) => acc + Number(exercise.caloriesBurned || 0), 0);
  const goalCalories = Math.round(Number(goal.today?.calories || 0) * countPeriodDays(start, end));
  const adjustedGoalCalories = goalCalories + Math.round(exerciseCalories);
  const balance = adjustedGoalCalories - Math.round(totals.calories);
  const balanceLine = balance >= 0
    ? `Você está em déficit de ${formatNumber(balance)} kcal em relação à meta ajustada.`
    : `Você está em superávit de ${formatNumber(Math.abs(balance))} kcal em relação à meta ajustada.`;

  return [
    `Resumo de ${label}:`,
    "",
    `Refeições registradas: ${mealsInPeriod.length}`,
    `Total consumido: ${formatNumber(totals.calories)} kcal | Prot. ${formatNumber(totals.protein)} g | Carb. ${formatNumber(totals.carbs)} g | Gord. ${formatNumber(totals.fat)} g`,
    `Exercícios: ${formatNumber(exerciseCalories)} kcal gastas`,
    ...(goalCalories > 0 ? [`Meta estimada: ${formatNumber(goalCalories)} kcal`, `Meta ajustada: ${formatNumber(adjustedGoalCalories)} kcal`, balanceLine] : []),
  ].join("\n");
}

function pruneRecentlyHandledTextIntentMessageIds(now = Date.now()) {
  for (const [messageId, expiresAt] of recentlyHandledTextIntentMessageIds) {
    if (expiresAt <= now) recentlyHandledTextIntentMessageIds.delete(messageId);
  }
}

function wasTextIntentMessageAlreadyHandled(messageId?: string) {
  if (!messageId) return false;
  const now = Date.now();
  pruneRecentlyHandledTextIntentMessageIds(now);
  return recentlyHandledTextIntentMessageIds.has(messageId);
}

function markTextIntentMessageHandled(messageId?: string) {
  if (messageId) recentlyHandledTextIntentMessageIds.set(messageId, Date.now() + TEXT_INTENT_DEDUPLICATION_TTL_MS);
}

function getPendingTextIntentContext(userId: number) {
  const pending = pendingTextIntentContexts.get(userId);
  if (!pending) return null;
  if (pending.expiresAt <= Date.now()) {
    pendingTextIntentContexts.delete(userId);
    return null;
  }
  return pending;
}

function rememberPendingTextIntentContext(userId: number, result: TextIntentResult) {
  if (result.action === "clarification_needed" && result.detail === "Pedido de relatório sem período explícito.") {
    pendingTextIntentContexts.set(userId, { kind: "period_report", expiresAt: Date.now() + TEXT_INTENT_CONTEXT_TTL_MS });
    return;
  }
  pendingTextIntentContexts.delete(userId);
}

export function __resetWhatsAppTextIntentContextForTests() {
  pendingTextIntentContexts.clear();
  recentlyHandledTextIntentMessageIds.clear();
}

async function sendWhatsAppTextMessage(to: string, body: string) {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de resposta." };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body } }),
    });
    if (!response.ok) return { ok: false, detail: `Meta retornou ${response.status} ${response.statusText} no envio da resposta automática.` };
    return { ok: true, detail: "Resposta automática enviada com sucesso." };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar resposta automática do WhatsApp." };
  }
}

async function sendAndLogTextReply(input: { userId: number; sourcePhone: string; reply: string; eventType: string; detail: string; status: "success" | "warning" }) {
  logInferenceEvent({ userId: input.userId, origin: "whatsapp", status: input.status, eventType: input.eventType, detail: input.detail });
  const replyResult = await sendWhatsAppTextMessage(input.sourcePhone, input.reply);
  if (!replyResult.ok) {
    logInferenceEvent({ userId: input.userId, origin: "whatsapp", status: "warning", eventType: "whatsapp.reply_failed", detail: `Falha ao enviar resposta automática para ${input.sourcePhone}: ${replyResult.detail}` });
  }
}

async function tryHandleTextIntent(message: ExtractedWhatsAppMessage) {
  const sourcePhone = message.from || "unknown";
  if (!isMessageForConfiguredChannel(message) || !canInterpretTextIntent(message)) return false;
  if (wasTextIntentMessageAlreadyHandled(message.id)) return true;

  const userId = await getUserIdByWhatsappPhone(sourcePhone);
  if (!userId) return false;

  const text = getTextBody(message);
  const pendingContext = getPendingTextIntentContext(userId);
  const textForIntent = pendingContext?.kind === "period_report" ? `Resumo ${text}` : isBareDailySummaryRequest(text) ? "Resumo hoje" : text;

  const result = await executeWhatsappTextIntent(userId, { text: textForIntent, receivedAt: resolveOccurredAt(message) });
  if (!result) {
    const unknownFoodReply = buildUnknownFoodReply(text);
    if (!unknownFoodReply) return false;
    markTextIntentMessageHandled(message.id);
    pendingTextIntentContexts.delete(userId);
    await sendAndLogTextReply({ userId, sourcePhone, reply: unknownFoodReply, eventType: "whatsapp.intent.food_not_found", detail: "Alimento simples informado por texto não encontrado no catálogo antes da inferência nutricional.", status: "warning" });
    return true;
  }

  markTextIntentMessageHandled(message.id);
  rememberPendingTextIntentContext(userId, result);
  await sendAndLogTextReply({
    userId,
    sourcePhone,
    reply: await buildExerciseAwarePeriodReportReply(userId, result),
    eventType: result.eventType,
    detail: result.detail,
    status: result.action === "clarification_needed" ? "warning" : "success",
  });
  return true;
}

function clonePayloadWithoutHandledMessages(payload: any, handledMessageKeys: Set<string>) {
  const cloned = structuredClone(payload);
  const entries = Array.isArray(cloned?.entry) ? cloned.entry : [];
  cloned.entry = entries
    .map((entry: any, entryIndex: number) => {
      if (!Array.isArray(entry?.changes)) return entry;
      const changes = entry.changes
        .map((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          const pendingMessages = messages.filter((_message: WhatsAppMessage, messageIndex: number) => !handledMessageKeys.has(`${entryIndex}:${changeIndex}:${messageIndex}`));
          return { ...change, value: { ...change.value, messages: pendingMessages } };
        })
        .filter((change: any) => Array.isArray(change?.value?.messages) && change.value.messages.length > 0);
      return { ...entry, changes };
    })
    .filter((entry: any) => Array.isArray(entry?.changes) && entry.changes.length > 0);
  return cloned;
}

export async function handleWhatsAppWebhookWithTextIntent(req: Request, res: Response) {
  const messages = extractMessages(req.body);
  if (!messages.length) return handleWhatsAppWebhookWithAnnotatedImages(req, res);

  const handledMessageKeys = new Set<string>();
  for (const message of messages) {
    const handled = await tryHandleTextIntent(message);
    if (handled) handledMessageKeys.add(getExtractedMessageKey(message));
  }

  if (!handledMessageKeys.size) return handleWhatsAppWebhookWithAnnotatedImages(req, res);

  const remainingPayload = clonePayloadWithoutHandledMessages(req.body, handledMessageKeys);
  if (!Array.isArray(remainingPayload?.entry) || remainingPayload.entry.length === 0) {
    return res.status(200).json({ ok: true, processed: messages.length });
  }

  req.body = remainingPayload;
  return handleWhatsAppWebhookWithAnnotatedImages(req, res);
}
