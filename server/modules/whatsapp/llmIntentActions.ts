import { createHash } from "node:crypto";
import { roundNutritionValue } from "../../../shared/mealTotals";
import { convertFoodQuantityForRegistration, normalizeMeasurementUnit } from "../../../shared/measurementUnits";
import type { MealDraftItem } from "../../nutritionEngine";
import { createManualMeal, listMeals, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { buildWhatsappAiToolTrace, runWhatsappAiTool, type WhatsappAiToolTrace } from "./aiToolContract";
import { learnWhatsappIntentAliasFromConfirmation } from "./intentAliasLearning";
import { recordWhatsappIntentAuditLog } from "./intentAuditLog";
import { buildWhatsappIntentContext } from "./intentContext";
import { interpretWhatsappMessageWithDiagnostics, type WhatsappMessageInterpretation } from "./intentInterpreter";
import { WHATSAPP_INTENT_CONFIDENCE, type WhatsappIntentFoodItem, type WhatsappIntentName, type WhatsappInterpretedIntent } from "./intentSchema";
import { validateWhatsappRuntimeIntentForPersistence, type WhatsappBackendValidationResult } from "./intentValidation";

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const HEURISTIC_NUTRITION_PER_100G = {
  calories: 150,
  protein: 6,
  carbs: 15,
  fat: 5,
};
const PERSISTENT_INTENTS = ["add_foods_to_meal", "replace_food_in_meal", "edit_food_quantity"] as const satisfies readonly WhatsappIntentName[];

type WhatsappLlmIntentResult = {
  handled: true;
  action:
    | "llm_intent_add_foods_to_meal"
    | "llm_intent_replace_food_in_meal"
    | "llm_intent_list_meal_records"
    | "llm_intent_daily_summary"
    | "llm_intent_open_records_link"
    | "llm_intent_help"
    | "clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  toolTrace?: WhatsappAiToolTrace[];
};

type WhatsappLlmIntentInput = {
  text?: string | null;
  receivedAt?: Date;
  messageId?: string | null;
};

type ExistingMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string;
  items?: MealDraftItem[];
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
}

function formatReplyDate(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: SAO_PAULO_TIME_ZONE,
  });
}

function startOfSaoPauloDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00-03:00`);
}

function endOfSaoPauloDay(date: Date) {
  return new Date(startOfSaoPauloDay(date).getTime() + 86_400_000 - 1);
}

function isMealInsideDay(meal: ExistingMeal, date: Date) {
  const occurredAt = new Date(meal.occurredAt).getTime();
  return occurredAt >= startOfSaoPauloDay(date).getTime() && occurredAt <= endOfSaoPauloDay(date).getTime();
}

function normalizeMealLabel(value: string) {
  const normalized = normalizeText(value);
  if (/(^|\s)(cafe|manha|desjejum)(\s|$)/.test(normalized)) return "Café da manhã";
  if (/\balmoco\b/.test(normalized)) return "Almoço";
  if (/\bjantar\b|\bjanta\b/.test(normalized)) return "Jantar";
  if (/\bceia\b/.test(normalized)) return "Ceia";
  if (/\blanche\b/.test(normalized)) return "Lanche";
  return value.trim();
}

function resolveIntentDate(intent: WhatsappInterpretedIntent, receivedAt: Date) {
  if (!intent.date) {
    return receivedAt;
  }
  const normalized = normalizeText(intent.date);
  if (normalized === "hoje") return receivedAt;
  if (normalized === "ontem") return new Date(receivedAt.getTime() - 86_400_000);
  const parsed = new Date(intent.date);
  return Number.isNaN(parsed.getTime()) ? receivedAt : parsed;
}

function findMealByLabel(
  meals: ExistingMeal[],
  label: string,
  date: Date,
  options: { allowCrossDayFallback?: boolean } = {},
) {
  const normalizedLabel = normalizeText(normalizeMealLabel(label));
  return meals.find(meal => normalizeText(meal.mealLabel) === normalizedLabel && isMealInsideDay(meal, date))
    ?? (options.allowCrossDayFallback ? meals.find(meal => normalizeText(meal.mealLabel) === normalizedLabel) : null)
    ?? null;
}

type ResolvedFoodMeasurement = {
  quantity: number;
  unit: string;
  estimatedGrams: number;
  portionText: string;
  conversionNote: string | null;
};

function quantityToEstimatedGrams(quantity: number, unit: string) {
  if (unit === "kg" || /\bkg\b/i.test(unit)) return quantity * 1000;
  if (unit === "l") return quantity * 1000;
  if (unit === "mg") return quantity / 1000;
  if (unit === "ml" || unit === "g") return quantity;
  if (/fatias?/i.test(unit)) return quantity * 25;
  if (/x[ií]caras?|copos?/i.test(unit)) return quantity * 50;
  return quantity * 100;
}

function resolveFoodMeasurement(item: WhatsappIntentFoodItem, foodName: string): ResolvedFoodMeasurement {
  const quantity = item.quantity ?? 1;
  const unit = normalizeMeasurementUnit(item.unit ?? "porção");
  const converted = convertFoodQuantityForRegistration({ foodName, quantity, unit });
  if (converted) {
    return converted;
  }

  return {
    quantity,
    unit,
    estimatedGrams: quantityToEstimatedGrams(quantity, unit),
    portionText: item.quantity && item.unit ? `${formatNumber(quantity)} ${unit}` : "1 porção estimada",
    conversionNote: null,
  };
}

function buildMealItem(item: WhatsappIntentFoodItem): MealItemInput {
  const foodName = [item.foodName, item.preparation].filter(Boolean).join(" ").trim();
  const measurement = resolveFoodMeasurement(item, foodName);
  const estimatedGrams = Math.max(measurement.estimatedGrams, 1);
  const factor = estimatedGrams / 100;

  return {
    foodName,
    canonicalName: foodName,
    brand: item.brand ?? undefined,
    quantity: measurement.quantity,
    unit: measurement.unit,
    portionText: measurement.portionText,
    servings: Math.max(factor, 0.1),
    estimatedGrams: roundNutritionValue(estimatedGrams),
    calories: roundNutritionValue(HEURISTIC_NUTRITION_PER_100G.calories * factor),
    protein: roundNutritionValue(HEURISTIC_NUTRITION_PER_100G.protein * factor),
    carbs: roundNutritionValue(HEURISTIC_NUTRITION_PER_100G.carbs * factor),
    fat: roundNutritionValue(HEURISTIC_NUTRITION_PER_100G.fat * factor),
    confidence: item.quantity && item.unit ? 0.65 : 0.45,
    source: "heuristic",
  };
}

function toMealItemInput(item: MealDraftItem): MealItemInput {
  const quantityUnit = item as MealDraftItem & Partial<Pick<MealItemInput, "quantity" | "unit" | "brand">>;
  return {
    ...item,
    ...(quantityUnit.brand ? { brand: quantityUnit.brand } : {}),
    quantity: quantityUnit.quantity ?? item.servings,
    unit: quantityUnit.unit?.trim() || "porção",
  };
}

function itemMatchScore(item: MealItemInput, targetFood: string) {
  const target = normalizeText(targetFood);
  const foodName = normalizeText(item.foodName);
  const canonicalName = normalizeText(item.canonicalName);
  if (foodName === target || canonicalName === target) return 3;
  if (foodName.includes(target) || canonicalName.includes(target) || target.includes(foodName)) return 2;
  const targetWords = new Set(target.split(" ").filter(Boolean));
  const itemWords = new Set(`${foodName} ${canonicalName}`.split(" ").filter(Boolean));
  const overlap = [...targetWords].filter(word => itemWords.has(word)).length;
  return overlap >= Math.max(1, Math.min(2, targetWords.size)) ? 1 : 0;
}

function findReplacementTarget(items: MealItemInput[], sourceFood: string) {
  const candidates = items
    .map((item, index) => ({ item, index, score: itemMatchScore(item, sourceFood) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return "ambiguous" as const;
  return candidates[0];
}

function replaceMealItemFood(item: MealItemInput, targetFood: string): MealItemInput {
  const estimatedGrams = Math.max(Number(item.estimatedGrams || 0), 1);
  const factor = estimatedGrams / 100;
  return {
    ...item,
    foodName: targetFood,
    canonicalName: targetFood,
    calories: roundNutritionValue(HEURISTIC_NUTRITION_PER_100G.calories * factor),
    protein: roundNutritionValue(HEURISTIC_NUTRITION_PER_100G.protein * factor),
    carbs: roundNutritionValue(HEURISTIC_NUTRITION_PER_100G.carbs * factor),
    fat: roundNutritionValue(HEURISTIC_NUTRITION_PER_100G.fat * factor),
    confidence: Math.min(Number(item.confidence || 0.7), 0.7),
    source: "heuristic",
  };
}

function sumMealItems(items: MealItemInput[]) {
  return items.reduce(
    (acc, item) => ({
      calories: acc.calories + Number(item.calories || 0),
      protein: acc.protein + Number(item.protein || 0),
      carbs: acc.carbs + Number(item.carbs || 0),
      fat: acc.fat + Number(item.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function formatTotalsLine(totals: { calories: number; protein: number; carbs: number; fat: number }) {
  return `${formatNumber(totals.calories)} kcal | Prot. ${formatNumber(totals.protein)} g | Carb. ${formatNumber(totals.carbs)} g | Gord. ${formatNumber(totals.fat)} g`;
}

function formatMealItemLine(item: MealItemInput) {
  const portionText = item.portionText?.trim() || "1 porção";
  return `  - ${portionText} de ${item.foodName}: ${formatTotalsLine(item)}`;
}

function hasLikelyMealRegistrationSignal(text: string) {
  const normalized = normalizeText(text);
  return /\b(almocei|jantei|comi|lanchei|ceei|tomei|bebi|caf[eé]|almoco|jantar|lanche|refeicao)\b/.test(normalized)
    || /\b\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|ml|l|un|unidades?|fatias?|xicaras?|copos?|colheres?|porcoes?|porcao)\b/i.test(text);
}

function shouldLetNutritionFallbackHandle(text: string, intent: WhatsappInterpretedIntent) {
  return intent.intent === "unknown" && hasLikelyMealRegistrationSignal(text);
}

function buildIdempotencyKey(userId: number, text: string, receivedAt: Date, messageId?: string | null) {
  const source = messageId?.trim() || `${userId}:${receivedAt.toISOString()}:${normalizeText(text)}`;
  return createHash("sha256").update(source).digest("hex");
}

function buildToolFallbackResult(toolTrace: WhatsappAiToolTrace[], detail: string): WhatsappLlmIntentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: "Nao consegui concluir essa acao com seguranca agora. Tente novamente em instantes ou envie mais detalhes.",
    eventType: "whatsapp.llm_intent.clarification_needed",
    detail,
    toolTrace,
  };
}

function buildClarificationToolTrace(intent: WhatsappInterpretedIntent): WhatsappAiToolTrace {
  return buildWhatsappAiToolTrace({
    toolId: "clarification_request",
    intent: intent.intent,
    outcome: "success",
    parameterSummary: {
      intent: intent.intent,
      confidence: Number(intent.confidence.toFixed(2)),
      possibleIntentCount: intent.possibleIntents.length,
    },
  });
}

function buildBackendValidationClarification(
  intent: WhatsappInterpretedIntent,
  validation: WhatsappBackendValidationResult,
): WhatsappLlmIntentResult {
  const firstIssue = validation.issues[0];
  return {
    handled: true,
    action: "clarification_needed",
    reply: firstIssue?.message
      ?? "Preciso confirmar alguns detalhes antes de salvar essa informacao com seguranca.",
    eventType: "whatsapp.llm_intent.clarification_needed",
    detail: "Validacao de backend bloqueou acao persistente antes de chamar ferramentas.",
    data: {
      intent: intent.intent,
      intentConfidence: intent.confidence,
      validationStatus: validation.status,
      errorCode: validation.errorCode ?? null,
      autonomyOutcome: validation.autonomyDecision?.outcome ?? null,
      issueCodes: validation.issues.map(issue => issue.code),
    },
    toolTrace: [buildClarificationToolTrace(intent)],
  };
}

function recordIntentAudit(input: {
  userId: number;
  text: string;
  interpretation: WhatsappMessageInterpretation;
  result: WhatsappLlmIntentResult | null;
  fallbackReason?: string;
  errorCode?: string;
}) {
  const resultAction = input.result?.action ?? "fallback_to_nutrition";
  const replyKind = input.result?.action === "clarification_needed"
    ? "clarification"
    : input.result
      ? "executed"
      : "fallback";
  const fallbackReason = input.fallbackReason ?? input.interpretation.fallbackReason;
  recordWhatsappIntentAuditLog({
    userId: input.userId,
    messageText: input.text,
    intent: input.interpretation.intent,
    validationStatus: input.interpretation.validationStatus,
    action: resultAction,
    replyKind,
    operationalTrace: {
      ...input.interpretation.operationalTrace,
      ...(fallbackReason ? { fallbackReason } : {}),
    },
    toolTrace: input.result?.toolTrace ?? [],
    fallbackReason,
    errorCode: input.errorCode ?? input.interpretation.errorCode,
  });
}

async function handleAddFoodsToMeal(
  userId: number,
  intent: WhatsappInterpretedIntent,
  receivedAt: Date,
  idempotencyKey: string,
): Promise<WhatsappLlmIntentResult | null> {
  if (!intent.meal?.label || !intent.items.length) {
    return null;
  }
  const toolTrace: WhatsappAiToolTrace[] = [];
  const targetDate = resolveIntentDate(intent, receivedAt);
  const mealLabel = normalizeMealLabel(intent.meal.label);
  const mealsResult = await runWhatsappAiTool({
    toolId: "meal_records_list",
    intent: "add_foods_to_meal",
    outcome: "success",
    parameterSummary: { dateWindow: intent.date ?? "received_day", mealLabel },
  }, () => listMeals(userId));
  toolTrace.push(mealsResult.trace);
  if (!mealsResult.result) {
    return buildToolFallbackResult(toolTrace, "Falha ao consultar refeicoes antes de escrita.");
  }

  const meals = mealsResult.result;
  const existingMeal = findMealByLabel(meals, mealLabel, targetDate, { allowCrossDayFallback: !intent.date });
  if (!existingMeal && !intent.meal.createIfMissing) {
    return null;
  }

  const addedItems = intent.items.map(buildMealItem);
  toolTrace.push(buildWhatsappAiToolTrace({
    toolId: "meal_item_nutrition_simulate",
    intent: "add_foods_to_meal",
    backendValidated: true,
    outcome: "success",
    parameterSummary: {
      itemCount: addedItems.length,
      hasQuantity: intent.items.every(item => Boolean(item.quantity)),
      hasUnit: intent.items.every(item => Boolean(item.unit)),
    },
  }));

  const mealResult = existingMeal
    ? await runWhatsappAiTool({
        toolId: "meal_record_update",
        intent: "add_foods_to_meal",
        backendValidated: true,
        idempotencyKey,
        outcome: "success",
        parameterSummary: { mealId: existingMeal.id, itemCount: addedItems.length },
      }, () => updateMeal(userId, {
        mealId: existingMeal.id,
        mealLabel: existingMeal.mealLabel,
        occurredAt: new Date(existingMeal.occurredAt).toISOString(),
        notes: existingMeal.notes,
        items: [...(existingMeal.items ?? []), ...addedItems] as MealItemInput[],
      }))
    : await runWhatsappAiTool({
        toolId: "meal_record_create",
        intent: "add_foods_to_meal",
        backendValidated: true,
        idempotencyKey,
        outcome: "success",
        parameterSummary: { mealLabel, itemCount: addedItems.length, occurredAt: targetDate.toISOString() },
      }, () => createManualMeal(userId, {
        mealLabel,
        occurredAt: targetDate.toISOString(),
        notes: "Criada automaticamente pelo interpretador estruturado do WhatsApp.",
        items: addedItems,
      }));
  toolTrace.push(mealResult.trace);
  if (!mealResult.result) {
    return buildToolFallbackResult(toolTrace, "Falha ao persistir refeicao validada.");
  }

  const meal = mealResult.result;
  return {
    handled: true,
    action: "llm_intent_add_foods_to_meal",
    reply: `Registrei ${addedItems.length} item(ns) em ${meal.mealLabel} de ${formatReplyDate(new Date(meal.occurredAt))}: ${addedItems.map(item => `${item.portionText} de ${item.foodName}`).join(", ")}.`,
    eventType: "whatsapp.llm_intent.add_foods_to_meal",
    detail: existingMeal
      ? "Alimentos adicionados a refeição existente por intenção estruturada."
      : "Refeição criada automaticamente por intenção estruturada com createIfMissing.",
    data: {
      mealId: meal.id,
      mealLabel: meal.mealLabel,
      createdMeal: !existingMeal,
      itemCount: addedItems.length,
      intentConfidence: intent.confidence,
    },
    toolTrace,
  };
}

async function handleReplaceFoodInMeal(userId: number, intent: WhatsappInterpretedIntent, idempotencyKey: string): Promise<WhatsappLlmIntentResult | null> {
  if (!intent.sourceFood || !intent.targetFood) {
    return null;
  }
  const toolTrace: WhatsappAiToolTrace[] = [];
  const mealsResult = await runWhatsappAiTool({
    toolId: "meal_records_list",
    intent: "replace_food_in_meal",
    outcome: "success",
    parameterSummary: { dateWindow: "latest", sourceFoodProvided: true },
  }, () => listMeals(userId));
  toolTrace.push(mealsResult.trace);
  if (!mealsResult.result) {
    return buildToolFallbackResult(toolTrace, "Falha ao consultar refeicao recente antes de correcao.");
  }

  const latestMeal = mealsResult.result[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Nao encontrei uma refeicao recente para corrigir. Me diga qual alimento devo trocar.",
      eventType: "whatsapp.llm_intent.clarification_needed",
      detail: "Intencao estruturada de troca sem refeicao recente.",
      toolTrace: [...toolTrace, buildClarificationToolTrace(intent)],
    };
  }

  const latestItems = latestMeal.items.map(toMealItemInput);
  const target = findReplacementTarget(latestItems, intent.sourceFood);
  if (!target || target === "ambiguous") {
    const options = latestItems.map((item, index) => `${index + 1}. ${item.foodName}`).join(" ");
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Nao encontrei uma correspondencia segura para ${intent.sourceFood}. Qual item devo trocar? ${options}`,
      eventType: "whatsapp.llm_intent.clarification_needed",
      detail: target === "ambiguous"
        ? "Intencao estruturada de troca com correspondencia ambigua."
        : "Intencao estruturada de troca sem item compativel.",
      toolTrace: [...toolTrace, buildClarificationToolTrace(intent)],
    };
  }

  const nextItems = latestItems.map((item, index) => index === target.index
    ? replaceMealItemFood(item, intent.targetFood!)
    : item);
  toolTrace.push(buildWhatsappAiToolTrace({
    toolId: "meal_item_nutrition_simulate",
    intent: "replace_food_in_meal",
    backendValidated: true,
    outcome: "success",
    parameterSummary: { itemCount: 1, hasQuantity: true, hasUnit: true },
  }));
  const updatedMealResult = await runWhatsappAiTool({
    toolId: "meal_record_update",
    intent: "replace_food_in_meal",
    backendValidated: true,
    idempotencyKey,
    outcome: "success",
    parameterSummary: { mealId: latestMeal.id, itemCount: nextItems.length },
  }, () => updateMeal(userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: nextItems,
  }));
  toolTrace.push(updatedMealResult.trace);
  if (!updatedMealResult.result) {
    return buildToolFallbackResult(toolTrace, "Falha ao persistir correcao validada.");
  }

  const replacedItem = nextItems[target.index];
  return {
    handled: true,
    action: "llm_intent_replace_food_in_meal",
    reply: `Troquei ${target.item.foodName} por ${intent.targetFood} na ultima refeicao e mantive ${formatNumber(replacedItem.estimatedGrams)} g. Estimativa: ${formatTotalsLine(replacedItem)}.`,
    eventType: "whatsapp.llm_intent.replace_food_in_meal",
    detail: "Alimento substituido por intencao estruturada validada.",
    data: {
      mealId: updatedMealResult.result.id,
      previousFoodName: target.item.foodName,
      nextFoodName: intent.targetFood,
      intentConfidence: intent.confidence,
    },
    toolTrace,
  };
}

async function handleListMeals(userId: number, intent: WhatsappInterpretedIntent, receivedAt: Date, mode: "list" | "summary" = "list"): Promise<WhatsappLlmIntentResult> {
  const mealsResult = await runWhatsappAiTool({
    toolId: "meal_records_list",
    intent: intent.intent,
    outcome: "success",
    parameterSummary: { dateWindow: "received_day", mode },
  }, () => listMeals(userId));
  const toolTrace = [mealsResult.trace];
  if (!mealsResult.result) {
    return buildToolFallbackResult(toolTrace, "Falha ao consultar refeicoes para resposta contextual.");
  }

  const filteredMeals = mealsResult.result.filter(meal => isMealInsideDay(meal, receivedAt));
  if (!filteredMeals.length) {
    return {
      handled: true,
      action: mode === "list" ? "llm_intent_list_meal_records" : "llm_intent_daily_summary",
      reply: "Nao encontrei refeicoes registradas hoje.",
      eventType: mode === "list" ? "whatsapp.llm_intent.list_meal_records" : "whatsapp.llm_intent.daily_summary",
      detail: "Consulta estruturada de refeicoes sem registros encontrados.",
      data: { mealCount: 0 },
      toolTrace,
    };
  }

  const lines = filteredMeals.flatMap(meal => {
    const items = (meal.items ?? []).map(toMealItemInput);
    const totals = sumMealItems(items);
    const header = `• ${meal.mealLabel}: ${formatTotalsLine(totals)}`;
    if (mode === "summary") {
      return [header];
    }
    if (!items.length) {
      return [header, "  - Sem alimentos detalhados."];
    }
    return [header, ...items.map(formatMealItemLine)];
  });

  return {
    handled: true,
    action: mode === "list" ? "llm_intent_list_meal_records" : "llm_intent_daily_summary",
    reply: [mode === "list" ? "Alimentos registrados hoje:" : "Refeicoes registradas hoje:", "", ...lines].join("\n"),
    eventType: mode === "list" ? "whatsapp.llm_intent.list_meal_records" : "whatsapp.llm_intent.daily_summary",
    detail: "Consulta estruturada de refeicoes respondida pelo WhatsApp.",
    data: { mealCount: filteredMeals.length },
    toolTrace,
  };
}

function buildHelpReply() {
  return [
    "Posso ajudar pelo WhatsApp com:",
    "",
    "• registrar alimentos em uma refeicao",
    "• corrigir ou trocar um alimento da ultima refeicao",
    "• listar refeicoes registradas hoje",
    "• mostrar resumo do dia",
    "• registrar agua com quantidade",
  ].join("\n");
}

function buildClarification(intent: WhatsappInterpretedIntent): WhatsappLlmIntentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: intent.clarificationQuestion
      ?? "Nao entendi com seguranca. Voce quer registrar alimento, corrigir uma refeicao ou consultar seus registros?",
    eventType: "whatsapp.llm_intent.clarification_needed",
    detail: `Intencao ${intent.intent} exige esclarecimento antes de executar.`,
    data: {
      intent: intent.intent,
      intentConfidence: intent.confidence,
      possibleIntents: intent.possibleIntents,
    },
    toolTrace: [buildClarificationToolTrace(intent)],
  };
}

function isPersistentIntent(intentName: WhatsappIntentName) {
  return PERSISTENT_INTENTS.includes(intentName as (typeof PERSISTENT_INTENTS)[number]);
}

export async function executeWhatsappLlmIntent(userId: number, input: WhatsappLlmIntentInput): Promise<WhatsappLlmIntentResult | null> {
  const text = input.text?.trim();
  if (!text) {
    return null;
  }

  const receivedAt = input.receivedAt ?? new Date();
  const idempotencyKey = buildIdempotencyKey(userId, text, receivedAt, input.messageId);
  const context = await buildWhatsappIntentContext(userId, { receivedAt });
  const interpretation = await interpretWhatsappMessageWithDiagnostics(text, context);
  const intent = interpretation.intent;
  learnWhatsappIntentAliasFromConfirmation({ userId, text, intent, receivedAt });

  const finish = (result: WhatsappLlmIntentResult | null, fallbackReason?: string, errorCode?: string) => {
    recordIntentAudit({ userId, text, interpretation, result, fallbackReason, errorCode });
    return result;
  };

  try {
    if (shouldLetNutritionFallbackHandle(text, intent)) {
      return finish(null, "nutrition_fallback");
    }

    if (intent.requiresConfirmation || intent.confidence < WHATSAPP_INTENT_CONFIDENCE.clarify) {
      const clarificationFallbackReason = intent.confidence < WHATSAPP_INTENT_CONFIDENCE.clarify
        ? interpretation.fallbackReason ?? "low_confidence"
        : interpretation.fallbackReason;
      return finish(buildClarification(intent), clarificationFallbackReason);
    }

    if (intent.confidence < WHATSAPP_INTENT_CONFIDENCE.execute && intent.intent !== "ambiguous") {
      return finish(null, interpretation.fallbackReason ?? "low_confidence");
    }

    if (isPersistentIntent(intent.intent)) {
      const validation = validateWhatsappRuntimeIntentForPersistence({
        intent,
        validationStatus: interpretation.validationStatus,
      });
      if (!validation.valid) {
        return finish(
          buildBackendValidationClarification(intent, validation),
          validation.fallbackReason,
          validation.errorCode,
        );
      }
    }

    switch (intent.intent) {
      case "add_foods_to_meal":
        return finish(await handleAddFoodsToMeal(userId, intent, receivedAt, idempotencyKey));
      case "replace_food_in_meal":
        return finish(await handleReplaceFoodInMeal(userId, intent, idempotencyKey));
      case "list_meal_records":
        return finish(await handleListMeals(userId, intent, receivedAt, "list"));
      case "daily_summary":
        return finish(await handleListMeals(userId, intent, receivedAt, "summary"));
      case "open_records_link":
        return finish({
          handled: true,
          action: "llm_intent_open_records_link",
          reply: "Voce pode revisar seus registros na tela de refeicoes do app.",
          eventType: "whatsapp.llm_intent.open_records_link",
          detail: "Pedido estruturado para abrir registros respondido sem criar refeicao.",
          toolTrace: [buildWhatsappAiToolTrace({
            toolId: "records_link_suggest",
            intent: "open_records_link",
            outcome: "success",
            parameterSummary: { destination: "meal_records" },
          })],
        });
      case "help":
        return finish({
          handled: true,
          action: "llm_intent_help",
          reply: buildHelpReply(),
          eventType: "whatsapp.llm_intent.help",
          detail: "Ajuda de comandos enviada por intencao estruturada.",
          toolTrace: [buildWhatsappAiToolTrace({
            toolId: "records_link_suggest",
            intent: "help",
            outcome: "success",
            parameterSummary: { destination: "help" },
          })],
        });
      case "ambiguous":
      case "unknown":
        return finish(buildClarification(intent), interpretation.fallbackReason);
      default:
        return finish(null, interpretation.fallbackReason ?? "unsupported_intent");
    }
  } catch (error) {
    recordIntentAudit({
      userId,
      text,
      interpretation,
      result: buildToolFallbackResult([], "Erro inesperado no executor de ferramentas."),
      fallbackReason: "executor_error",
      errorCode: error instanceof Error ? error.name : "executor_error",
    });
    return buildToolFallbackResult([], "Erro inesperado no executor de ferramentas.");
  }
}
