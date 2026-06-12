import { Request, Response } from "express";
import { getCatalogCache } from "./catalogRuntime";
import { executeWhatsAppFoodAssistantIntent } from "./modules/whatsapp/foodAssistant";
import { executeWhatsappTextIntent } from "./modules/whatsapp/intentActions";
import { executeWhatsappLlmIntent } from "./modules/whatsapp/llmIntentActions";
import { getWhatsAppIntentLogStatus, type WhatsAppIntentLogStatus } from "./modules/whatsapp/intentResult";
import { splitWhatsAppWaterAndFoodText } from "./modules/whatsapp/waterFoodText";
import { getUserIdByWhatsappPhone, getUserNutritionGoal, listUserExercises, logInferenceEvent } from "./db";
import { listMeals } from "./modules/meals/service";
import { processProfessionalAccessWhatsappResponse } from "./modules/professionals/service";
import {
  extractWhatsAppWebhookMessages,
  getExtractedWhatsAppMessageKey,
  isWhatsAppMessageForConfiguredChannel,
  resolveWhatsAppMessageOccurredAt,
  sendWhatsAppTextMessage,
  type ExtractedWhatsAppWebhookMessage,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";
import { handleWhatsAppWebhookWithAnnotatedImages } from "./whatsappAnnotatedImageWebhook";
import { toLogicalDateInTimeZone } from "../shared/timeZone";

type TextIntentResult = NonNullable<Awaited<ReturnType<typeof executeWhatsappTextIntent>>> | NonNullable<Awaited<ReturnType<typeof executeWhatsappLlmIntent>>> | NonNullable<ReturnType<typeof executeWhatsAppFoodAssistantIntent>>;
type TextIntentHandlingResult = boolean | { passthroughText: string };
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
const SIMPLE_FOOD_QUANTITY_UNIT_PATTERN = "g|gr|gramas?|kg|quilos?|mg|ml|m\\s*l|mililitros?|l|litros?|un|unidades?|fatias?|pedacos?|xicaras?|copos?|colheres?|doses?|scoops?|long\\s*neck|longneck|latas?|garrafas?|porcoes?|porcao";
const UNKNOWN_FOOD_REPLY = [
  "Não encontrei esse alimento no catálogo ainda.",
  "Me envie com mais detalhes, como marca, porção ou uma foto do rótulo, para eu conseguir registrar corretamente.",
  "Exemplo: 1 unidade de bisnaguinha Panco ou 30 g de queijo.",
].join("\n\n");

function getTextBody(message: WhatsAppWebhookMessage) {
  return message.text?.body?.trim() || "";
}

function canInterpretTextIntent(message: WhatsAppWebhookMessage) {
  return Boolean(getTextBody(message) && !message.image?.id && !message.audio?.id);
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

function normalizeTextPreservingQuantities(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function hasExplicitFoodQuantity(text: string) {
  const normalized = normalizeTextPreservingQuantities(text);
  return new RegExp(`\\b\\d+(?:[,.]\\d+)?\\s*(?:${SIMPLE_FOOD_QUANTITY_UNIT_PATTERN})\\b`, "i").test(normalized);
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
  if (hasExplicitFoodQuantity(text)) return null;

  const candidate = extractSimpleFoodCandidate(text);
  if (!candidate || catalogContainsFood(candidate)) return null;
  return UNKNOWN_FOOD_REPLY;
}

function isBareDailySummaryRequest(text: string) {
  const normalized = normalizeText(text);
  return normalized === "resumo" || normalized === "relatorio" || normalized === "balanco";
}

function shouldTryContextualLlmIntent(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (hasExplicitFoodQuantity(text)) return false;
  if (/\b(almocei|jantei|comi|lanchei|ceei|tomei|bebi)\b/.test(normalized)) return false;
  return /\b(refeicoes?|registrad[ao]s?|registrei|registro|consultar|consulta|listar|mostra|mostrar|ver|resumo do dia|total de hoje|calorias de hoje|corrigir|correcao|trocar|substituir|ajuda|comandos)\b/.test(normalized);
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

function buildMealBreakdownLines(meals: Array<{ mealLabel?: string | null; items?: Array<{ calories?: number; protein?: number; carbs?: number; fat?: number }> }>) {
  const groups = new Map<string, NutritionTotals>();
  for (const meal of [...meals].reverse()) {
    const label = meal.mealLabel?.trim() || "Refeição";
    const itemTotals = sumMealItems(meal.items ?? []);
    const existing = groups.get(label) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
    groups.set(label, {
      calories: existing.calories + itemTotals.calories,
      protein: existing.protein + itemTotals.protein,
      carbs: existing.carbs + itemTotals.carbs,
      fat: existing.fat + itemTotals.fat,
    });
  }
  const lines: string[] = [];
  for (const [label, totals] of groups) {
    if (lines.length > 0) lines.push("");
    lines.push(`${label}: ${formatNumber(totals.calories)} kcal`);
    lines.push(`* Prot. ${formatNumber(totals.protein)} g | Carb. ${formatNumber(totals.carbs)} g | Gord. ${formatNumber(totals.fat)} g`);
  }
  return lines;
}

function buildPeriodGoalSummaryLines(input: { goalCalories: number; adjustedGoalCalories: number; exerciseCalories: number; consumedCalories: number; balanceCalories: number }) {
  if (input.goalCalories <= 0) return [];

  const balanceLabel = input.balanceCalories >= 0 ? "Déficit" : "Superávit";
  const pct = input.adjustedGoalCalories > 0
    ? Math.round((Math.abs(input.balanceCalories) / input.adjustedGoalCalories) * 100)
    : 0;
  const pctStr = input.balanceCalories >= 0 ? `(-${pct}%)` : `(+${pct}%)`;

  return [
    "Meta do *resumo:*",
    `* Meta estimada: ${formatNumber(input.goalCalories)} kcal`,
    ...(input.exerciseCalories > 0 ? [`* Exercícios: ${formatNumber(input.exerciseCalories)} kcal`] : []),
    `* Meta ajustada: ${formatNumber(input.adjustedGoalCalories)} kcal`,
    `* Consumo: ${formatNumber(input.consumedCalories)} kcal`,
    `* ${balanceLabel}: ${formatNumber(Math.abs(input.balanceCalories))} kcal ${pctStr}`,
  ];
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
  const consumedCalories = Math.round(totals.calories);
  const exerciseCalories = Math.round(exercisesInPeriod.reduce((acc, exercise) => acc + Number(exercise.caloriesBurned || 0), 0));
  const goalCalories = Math.round(Number(goal.today?.calories || 0) * countPeriodDays(start, end));
  const adjustedGoalCalories = goalCalories + exerciseCalories;
  const balanceCalories = adjustedGoalCalories - consumedCalories;
  const goalSummaryLines = buildPeriodGoalSummaryLines({
    goalCalories,
    adjustedGoalCalories,
    exerciseCalories,
    consumedCalories,
    balanceCalories,
  });

  return [
    `*Resumo de ${label}:*`,
    "",
    `Refeições registradas: ${mealsInPeriod.length}`,
    "",
    ...buildMealBreakdownLines(mealsInPeriod),
    ...(goalSummaryLines.length ? ["", ...goalSummaryLines] : []),
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

async function sendAndLogTextReply(input: { userId: number; sourcePhone: string; reply: string; eventType: string; detail: string; status: WhatsAppIntentLogStatus }) {
  logInferenceEvent({ userId: input.userId, origin: "whatsapp", status: input.status, eventType: input.eventType, detail: input.detail });
  const replyResult = await sendWhatsAppTextMessage(input.sourcePhone, input.reply);
  if (!replyResult.ok) {
    logInferenceEvent({ userId: input.userId, origin: "whatsapp", status: "warning", eventType: "whatsapp.reply_failed", detail: `Falha ao enviar resposta automática para ${input.sourcePhone}: ${replyResult.detail}` });
  }
}

function buildMixedWaterReply(waterResults: TextIntentResult[]) {
  const waterLines = waterResults
    .map((result) => typeof result.data?.amountMl === "number" ? `* ${formatNumber(result.data.amountMl)} ml de água` : null)
    .filter((line): line is string => Boolean(line));

  return [
    "Hidratação registrada:",
    ...waterLines,
    "",
    "Vou processar os alimentos da mesma mensagem separadamente.",
  ].join("\n");
}

async function tryHandleTextIntent(message: ExtractedWhatsAppWebhookMessage): Promise<TextIntentHandlingResult> {
  const sourcePhone = message.from || "unknown";
  if (!isWhatsAppMessageForConfiguredChannel(message) || !canInterpretTextIntent(message)) return false;
  if (wasTextIntentMessageAlreadyHandled(message.id)) return true;

  const userId = await getUserIdByWhatsappPhone(sourcePhone);
  if (!userId) return false;

  const text = getTextBody(message);
  const professionalAccessResponse = await processProfessionalAccessWhatsappResponse(userId, text);
  if (professionalAccessResponse) {
    markTextIntentMessageHandled(message.id);
    pendingTextIntentContexts.delete(userId);
    await sendAndLogTextReply({
      userId,
      sourcePhone,
      reply: professionalAccessResponse.reply,
      eventType: professionalAccessResponse.eventType,
      detail: professionalAccessResponse.detail,
      status: professionalAccessResponse.action === "professional_access_decision_ambiguous" ? "warning" : "success",
    });
    return true;
  }

  const mixedWaterFood = splitWhatsAppWaterAndFoodText(text);
  if (mixedWaterFood) {
    const waterResults: TextIntentResult[] = [];
    for (const waterLine of mixedWaterFood.waterLines) {
      const result = await executeWhatsappTextIntent(userId, { text: waterLine.text, receivedAt: resolveWhatsAppMessageOccurredAt(message) });
      if (!result || result.action !== "water_logged") {
        await sendAndLogTextReply({
          userId,
          sourcePhone,
          reply: `Não consegui registrar a hidratação em "${waterLine.text}". Reenvie a água e os alimentos em mensagens separadas para evitar registro parcial.`,
          eventType: "whatsapp.intent.water_food_multiline_failed",
          detail: "Falha ao registrar hidratação em mensagem multi-linha com alimentos.",
          status: "warning",
        });
        markTextIntentMessageHandled(message.id);
        return true;
      }
      waterResults.push(result);
    }

    await sendAndLogTextReply({
      userId,
      sourcePhone,
      reply: buildMixedWaterReply(waterResults),
      eventType: "whatsapp.intent.water_food_multiline_split",
      detail: "Hidratação registrada e alimentos encaminhados ao fluxo nutricional após separar mensagem multi-linha.",
      status: "success",
    });
    return { passthroughText: mixedWaterFood.foodText };
  }

  const pendingContext = getPendingTextIntentContext(userId);
  const textForIntent = pendingContext?.kind === "period_report" ? `Resumo ${text}` : isBareDailySummaryRequest(text) ? "Resumo hoje" : text;

  let result: TextIntentResult | null = await executeWhatsappTextIntent(userId, { text: textForIntent, receivedAt: resolveWhatsAppMessageOccurredAt(message) });
  if (!result && shouldTryContextualLlmIntent(textForIntent)) {
    result = await executeWhatsappLlmIntent(userId, { text: textForIntent, receivedAt: resolveWhatsAppMessageOccurredAt(message) });
  }
  result ??= executeWhatsAppFoodAssistantIntent(text);

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
    status: getWhatsAppIntentLogStatus(result.action),
  });
  return true;
}

function clonePayloadWithoutHandledMessages(payload: any, handledMessageKeys: Set<string>, textOverrides = new Map<string, string>()) {
  const cloned = structuredClone(payload);
  const entries = Array.isArray(cloned?.entry) ? cloned.entry : [];
  cloned.entry = entries
    .map((entry: any, entryIndex: number) => {
      if (!Array.isArray(entry?.changes)) return entry;
      const changes = entry.changes
        .map((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          const pendingMessages = messages
            .map((message: WhatsAppWebhookMessage, messageIndex: number) => {
              const key = `${entryIndex}:${changeIndex}:${messageIndex}`;
              if (handledMessageKeys.has(key)) return null;

              const overrideText = textOverrides.get(key);
              if (overrideText && message.text?.body) {
                return {
                  ...message,
                  text: {
                    ...message.text,
                    body: overrideText,
                  },
                };
              }

              return message;
            })
            .filter(Boolean);
          return { ...change, value: { ...change.value, messages: pendingMessages } };
        })
        .filter((change: any) => Array.isArray(change?.value?.messages) && change.value.messages.length > 0);
      return { ...entry, changes };
    })
    .filter((entry: any) => Array.isArray(entry?.changes) && entry.changes.length > 0);
  return cloned;
}

export async function handleWhatsAppWebhookWithTextIntent(req: Request, res: Response) {
  const messages = extractWhatsAppWebhookMessages(req.body);
  if (!messages.length) return handleWhatsAppWebhookWithAnnotatedImages(req, res);

  const handledMessageKeys = new Set<string>();
  const textOverrides = new Map<string, string>();
  for (const message of messages) {
    const handled = await tryHandleTextIntent(message);
    const key = getExtractedWhatsAppMessageKey(message);
    if (handled === true) {
      handledMessageKeys.add(key);
    } else if (handled && typeof handled === "object") {
      textOverrides.set(key, handled.passthroughText);
    }
  }

  if (!handledMessageKeys.size && !textOverrides.size) return handleWhatsAppWebhookWithAnnotatedImages(req, res);

  const remainingPayload = clonePayloadWithoutHandledMessages(req.body, handledMessageKeys, textOverrides);
  if (!Array.isArray(remainingPayload?.entry) || remainingPayload.entry.length === 0) {
    return res.status(200).json({ ok: true, processed: messages.length });
  }

  req.body = remainingPayload;
  return handleWhatsAppWebhookWithAnnotatedImages(req, res);
}
