import { roundNutritionValue } from "../../../shared/mealTotals";
import { normalizeMeasurementUnit } from "../../../shared/measurementUnits";
import { getUserNutritionGoal } from "../../db";
import { getCatalogCache } from "../../catalogRuntime";
import { listMeals, updateMeal } from "../meals/service";
import { createWaterLog } from "../water/service";
import type { MealItemInput } from "../meals/schemas";
import type { MealDraftItem } from "../../nutritionEngine";
import { parseMealCommandFromWhatsApp, type ParsedMealCommandItem } from "./mealCommandParser";

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const MAX_WATER_LOG_AMOUNT_ML = 10000;
const MIN_FOOD_GRAMS = 1;
const UNSWEETENED_COFFEE_CUP_ML = 50;
const UNSWEETENED_COFFEE_CALORIES_PER_CUP = 2;
const HEURISTIC_REPLACEMENT_NUTRITION_PER_100G = {
  calories: 150,
  protein: 6,
  carbs: 15,
  fat: 5,
};

const ptBrNumberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

type WhatsappIntentResult = {
  handled: true;
  action: "water_logged" | "meal_item_added" | "meal_item_grams_adjusted" | "meal_item_replaced" | "meal_suggestion" | "period_report" | "clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

type WhatsappIntentInput = {
  text?: string | null;
  receivedAt?: Date;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type PeriodRange = {
  label: string;
  start: Date;
  end: Date;
};

type NutritionTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type CoffeeAdditionIntent = {
  cups: number;
  mealLabel: string | null;
};

type FoodAdditionIntent = {
  mealLabel: string;
  date: Date;
  items: Array<{
    foodName: string;
    quantity: number;
    unit: string;
    brand: string | null;
  }>;
};

type FoodReplacementIntent = {
  fromFood: string;
  toFood: string;
};

type QuantityCorrectionIntent = {
  previousQuantity: number | null;
  previousUnit: string | null;
  nextQuantity: number;
  nextUnit: string;
};

type ExistingMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string;
  items?: MealDraftItem[];
};

function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeCatalogText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

function cleanCatalogFoodName(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCatalogFoodNames(food: ReturnType<typeof getCatalogCache>[number]) {
  return [food.name, ...food.aliases]
    .map(alias => normalizeCatalogText(alias))
    .filter(Boolean);
}

function findCatalogFood(foodName: string) {
  const normalized = normalizeCatalogText(cleanCatalogFoodName(foodName));
  if (!normalized) {
    return null;
  }

  const catalogSource = getCatalogCache();
  return catalogSource.find(food => getCatalogFoodNames(food).some(alias => alias === normalized))
    ?? catalogSource.find(food => getCatalogFoodNames(food).some(alias => normalized.includes(alias) || alias.includes(normalized)))
    ?? null;
}

function formatNumber(value: number) {
  return ptBrNumberFormatter.format(value);
}

function formatReplyDateTime(date: Date) {
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: SAO_PAULO_TIME_ZONE,
  });
}

function formatReplyDate(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: SAO_PAULO_TIME_ZONE,
  });
}

function getZonedParts(date: Date, timeZone = SAO_PAULO_TIME_ZONE): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const hour = Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: hour === 24 ? 0 : hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function makeDateInTimeZone(parts: ZonedParts, timeZone = SAO_PAULO_TIME_ZONE) {
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  const actualParts = getZonedParts(utcGuess, timeZone);
  const desiredUtcMinutes = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 60_000;
  const actualUtcMinutes = Date.UTC(
    actualParts.year,
    actualParts.month - 1,
    actualParts.day,
    actualParts.hour,
    actualParts.minute,
    actualParts.second,
  ) / 60_000;
  const offsetMinutes = actualUtcMinutes - desiredUtcMinutes;
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function addDaysToZonedDate(parts: ZonedParts, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function resolveRelativeOccurredAt(text: string, receivedAt: Date) {
  const normalized = normalizeIntentText(text);
  const referenceParts = getZonedParts(receivedAt);
  if (/\banteontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -2));
  }
  if (/\bontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -1));
  }
  if (/\bamanha\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, 1));
  }
  return receivedAt;
}

function startOfZonedDay(date: Date) {
  const parts = getZonedParts(date);
  return makeDateInTimeZone({ ...parts, hour: 0, minute: 0, second: 0 });
}

function endOfZonedDay(date: Date) {
  const parts = getZonedParts(date);
  return makeDateInTimeZone({ ...parts, hour: 23, minute: 59, second: 59 });
}

function startOfZonedWeek(date: Date) {
  const parts = getZonedParts(date);
  const weekday = (new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 6) % 7;
  return makeDateInTimeZone({ ...addDaysToZonedDate({ ...parts, hour: 0, minute: 0, second: 0 }, -weekday), hour: 0, minute: 0, second: 0 });
}

function startOfZonedMonth(date: Date) {
  const parts = getZonedParts(date);
  return makeDateInTimeZone({ ...parts, day: 1, hour: 0, minute: 0, second: 0 });
}

function endOfZonedMonth(date: Date) {
  const parts = getZonedParts(date);
  return makeDateInTimeZone({ ...parts, month: parts.month + 1, day: 0, hour: 23, minute: 59, second: 59 });
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

function looksLikeWaterIntent(text: string) {
  const normalized = normalizeIntentText(text);
  return /\baguas?\b/.test(normalized) || /\bhidratacao\b/.test(normalized);
}

function parseWaterIntent(text: string) {
  if (!looksLikeWaterIntent(text)) {
    return null;
  }

  const amountMl = parseWaterAmountMl(text);
  if (!amountMl || amountMl <= 0 || amountMl > MAX_WATER_LOG_AMOUNT_ML) {
    return { kind: "clarification" as const };
  }

  return { kind: "water" as const, amountMl };
}

function cleanTargetFoodText(value?: string) {
  return value
    ?.replace(/\b(?:ontem|hoje|agora|por favor|pfv)\b/gi, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/^\b(?:o|a|os|as|do|da|de|dos|das)\b\s+/i, "")
    .trim() || null;
}

function parseMealItemGramsReplacement(text: string) {
  const normalized = normalizeIntentText(text);
  const match = normalized.match(/\b(?:mudar|alterar|ajustar|trocar|corrigir)\b\s+(.+?)\s+(?:para|por)\s+(\d+(?:[,.]\d+)?)\s*(?:g|gramas?)\b/);
  if (!match) {
    return null;
  }

  const nextGrams = Number(match[2].replace(",", "."));
  if (!Number.isFinite(nextGrams) || nextGrams < MIN_FOOD_GRAMS) {
    return null;
  }

  const targetFood = cleanTargetFoodText(match[1]);
  if (!targetFood) {
    return null;
  }

  return {
    nextGrams,
    targetFood,
  };
}

function parseMealItemGramsAdjustment(text: string) {
  const normalized = normalizeIntentText(text);
  const match = normalized.match(/\b(?:diminuir|diminui|diminuia|reduzir|reduz|reduza|tirar|remover)\b[^\d]*(\d+(?:[,.]\d+)?)\s*(?:g|gramas?)\b/);
  if (!match) {
    return null;
  }

  const gramsDelta = Number(match[1].replace(",", "."));
  if (!Number.isFinite(gramsDelta) || gramsDelta <= 0) {
    return null;
  }

  const afterAmount = normalized.slice((match.index ?? 0) + match[0].length);
  const targetMatch = afterAmount.match(/(?:\bdo\b|\bda\b|\bde\b)\s+(.+)/);

  return {
    gramsDelta,
    targetFood: cleanTargetFoodText(targetMatch?.[1]),
  };
}

function parseMealItemGramsIncrement(text: string) {
  const normalized = normalizeIntentText(text);
  const match = normalized.match(/\b(?:somar|soma|some|adicionar|adiciona|adicione|acrescentar|acrescenta|acrescente|colocar\s+mais|coloca\s+mais|coloque\s+mais|aumentar|aumenta|aumente)\b[^\d]*(\d+(?:[,.]\d+)?)\s*(?:g|gramas?)\b/);
  if (!match) {
    return null;
  }

  const gramsDelta = Number(match[1].replace(",", "."));
  if (!Number.isFinite(gramsDelta) || gramsDelta <= 0) {
    return null;
  }

  const afterAmount = normalized.slice((match.index ?? 0) + match[0].length);
  const targetMatch = afterAmount.match(/(?:\bao\b|\bno\b|\bna\b|\bdo\b|\bda\b|\bde\b)\s+(.+)/);

  return {
    gramsDelta,
    targetFood: cleanTargetFoodText(targetMatch?.[1]),
  };
}

function parseFoodReplacementIntent(text: string): FoodReplacementIntent | null {
  const correctionMatch = text.match(/\b(?:n[aã]o)\s+(?:é|e|era)\s+(.+?)\s+(?:é|e|era)\s+(.+)$/i);
  const swapMatch = text.match(/\b(?:trocar|troque|troca|mudar|alterar|corrigir)\b\s+(.+?)\s+(?:por|para)\s+(.+)$/i);
  const match = correctionMatch || swapMatch;
  if (!match) {
    return null;
  }

  const fromFood = cleanTargetFoodText(match[1]);
  const toFood = cleanTargetFoodText(match[2]);
  if (!fromFood || !toFood || /\d/.test(toFood)) {
    return null;
  }

  return { fromFood, toFood };
}

function parseCoffeeAdditionIntent(text: string): CoffeeAdditionIntent | null {
  const normalized = normalizeIntentText(text);
  if (!/\b(adicionar|adiciona|inclui|incluir|registrar|registra)\b/.test(normalized)) {
    return null;
  }
  if (!/\bcafe\b/.test(normalized) || !/\bsem acucar\b/.test(normalized)) {
    return null;
  }

  const amountMatch = normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:xicaras?|xicara?s?|copos?)\b/);
  if (!amountMatch) {
    return { cups: 0, mealLabel: null };
  }

  const cups = Number(amountMatch[1].replace(",", "."));
  if (!Number.isFinite(cups) || cups <= 0) {
    return { cups: 0, mealLabel: null };
  }

  const mealMatch = normalized.match(/\brefeicao\s+(.+)$/);
  const mealLabel = mealMatch?.[1]
    ?.replace(/\b(?:hoje|ontem|agora|por favor|pfv)\b/g, "")
    .trim() || null;

  return { cups, mealLabel };
}

function formatFoodNameWithBrand(item: ParsedMealCommandItem) {
  return [item.foodName, item.brand].filter(Boolean).join(" ").trim();
}

function normalizeAdditionUnit(unit: string | null) {
  return unit ? normalizeMeasurementUnit(unit) : "g";
}

function quantityToEstimatedGrams(quantity: number, unit: string) {
  switch (normalizeAdditionUnit(unit)) {
    case "kg":
      return quantity * 1000;
    case "mg":
      return quantity / 1000;
    case "g":
    case "ml":
      return quantity;
    case "l":
      return quantity * 1000;
    default:
      return quantity;
  }
}

function deriveQuantityFromPortionText(portionText: string) {
  const match = portionText.trim().match(/^(\d+(?:[,.]\d+)?)/u);
  if (!match) {
    return null;
  }

  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function deriveUnitFromPortionText(portionText: string) {
  const normalized = portionText
    .trim()
    .replace(/^\d+(?:[,.]\d+)?\s*/u, "")
    .trim();

  return normalized || "porção";
}

function toMealItemInput(item: MealDraftItem): MealItemInput {
  const quantityUnit = item as MealDraftItem & Partial<Pick<MealItemInput, "quantity" | "unit" | "brand">>;

  return {
    ...item,
    ...(quantityUnit.brand ? { brand: quantityUnit.brand } : {}),
    quantity: quantityUnit.quantity ?? deriveQuantityFromPortionText(item.portionText) ?? item.servings,
    unit: quantityUnit.unit?.trim() || deriveUnitFromPortionText(item.portionText),
  };
}

function toMealItemInputs(items: MealDraftItem[] | undefined): MealItemInput[] {
  return (items ?? []).map(toMealItemInput);
}

function parseFoodAdditionIntent(text: string, receivedAt: Date): FoodAdditionIntent | null {
  const parsed = parseMealCommandFromWhatsApp(text, { referenceDate: receivedAt });
  if (parsed.intent !== "add_items_to_meal" || !parsed.mealType || !parsed.date || !parsed.items.length) {
    return null;
  }

  const items = parsed.items.flatMap(item => {
    const foodName = formatFoodNameWithBrand(item);
    if (!foodName || !item.quantity || item.quantity <= 0) {
      return [];
    }

    return [{
      foodName,
      quantity: item.quantity,
      unit: normalizeAdditionUnit(item.unit),
      brand: item.brand,
    }];
  });

  if (!items.length || items.length !== parsed.items.length) {
    return null;
  }

  return {
    mealLabel: parsed.mealType,
    date: parsed.date,
    items,
  };
}

function parseQuantityCorrectionIntent(text: string, receivedAt: Date): QuantityCorrectionIntent | null {
  const parsed = parseMealCommandFromWhatsApp(text, { referenceDate: receivedAt });
  if (parsed.intent !== "replace_quantity" && parsed.intent !== "correct_quantity") {
    return null;
  }
  if (!parsed.nextQuantity || !parsed.nextUnit || parsed.nextQuantity <= 0) {
    return null;
  }

  return {
    previousQuantity: parsed.previousQuantity ?? null,
    previousUnit: parsed.previousUnit ? normalizeAdditionUnit(parsed.previousUnit) : null,
    nextQuantity: parsed.nextQuantity,
    nextUnit: normalizeAdditionUnit(parsed.nextUnit),
  };
}

function parseItemQuantity(item: MealItemInput) {
  if (item.quantity && item.unit) {
    return {
      quantity: item.quantity,
      unit: normalizeAdditionUnit(item.unit),
    };
  }

  const match = item.portionText?.match(/(\d+(?:[,.]\d+)?)\s*(g|gramas?|ml|mililitros?|l|litros?)\b/i);
  if (!match) {
    return null;
  }

  return {
    quantity: Number(match[1].replace(",", ".")),
    unit: normalizeAdditionUnit(normalizeIntentText(match[2])),
  };
}

function itemMatchesQuantity(item: MealItemInput, quantity: number, unit: string | null) {
  const normalizedUnit = normalizeAdditionUnit(unit);
  const parsedPortion = parseItemQuantity(item);
  if (parsedPortion?.quantity === quantity && (!unit || parsedPortion.unit === normalizedUnit)) {
    return true;
  }

  const estimatedTarget = quantityToEstimatedGrams(quantity, normalizedUnit);
  return Number(item.estimatedGrams || 0) === estimatedTarget;
}

function findQuantityCorrectionTargets(items: MealItemInput[], correction: QuantityCorrectionIntent) {
  if (correction.previousQuantity) {
    return items
      .map((item, index) => ({ item, index }))
      .filter(candidate => itemMatchesQuantity(candidate.item, correction.previousQuantity!, correction.previousUnit));
  }

  const lastItemIndex = items.length - 1;
  return lastItemIndex >= 0 ? [{ item: items[lastItemIndex], index: lastItemIndex }] : [];
}

function scaleMealItemQuantity(item: MealItemInput, nextQuantity: number, nextUnit: string): MealItemInput {
  const normalizedUnit = normalizeAdditionUnit(nextUnit);
  const nextEstimatedGrams = quantityToEstimatedGrams(nextQuantity, normalizedUnit);
  return {
    ...scaleMealItem(item, nextEstimatedGrams),
    quantity: nextQuantity,
    unit: normalizedUnit,
    portionText: `${formatNumber(nextQuantity)} ${normalizedUnit}`,
  };
}

function formatCorrectionOptions(targets: Array<{ item: MealItemInput }>) {
  return targets
    .map((target, index) => `${index + 1}. ${target.item.foodName}`)
    .join(" ");
}

async function handleQuantityCorrectionIntent(userId: number, correction: QuantityCorrectionIntent): Promise<WhatsappIntentResult> {
  const latestMeal = (await listMeals(userId))[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei um item recente para corrigir. Qual item devo corrigir?",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de correção de quantidade sem item recente disponível.",
    };
  }

  const latestItems = toMealItemInputs(latestMeal.items);
  const targets = findQuantityCorrectionTargets(latestItems, correction);
  if (!targets.length) {
    const previous = correction.previousQuantity && correction.previousUnit
      ? `${formatNumber(correction.previousQuantity)}${correction.previousUnit}`
      : "essa quantidade";
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei um item recente com ${previous}. Qual item devo corrigir?`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de correção de quantidade sem item compatível na refeição recente.",
    };
  }

  if (targets.length > 1) {
    const previous = correction.previousQuantity && correction.previousUnit
      ? `${formatNumber(correction.previousQuantity)}${correction.previousUnit}`
      : "essa quantidade";
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Encontrei mais de um item com ${previous}. Qual deseja alterar? ${formatCorrectionOptions(targets)}`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de correção de quantidade com mais de um item compatível.",
    };
  }

  const target = targets[0];
  const nextItems = latestMeal.items.map((item, index) => index === target.index
    ? scaleMealItemQuantity(toMealItemInput(item), correction.nextQuantity, correction.nextUnit)
    : item);
  const updatedMeal = await updateMeal(userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: nextItems as MealItemInput[],
  });

  const previous = correction.previousQuantity && correction.previousUnit
    ? `${formatNumber(correction.previousQuantity)}${correction.previousUnit}`
    : target.item.portionText;
  const next = `${formatNumber(correction.nextQuantity)}${correction.nextUnit}`;
  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: `Atualizei de ${previous} para ${next}.`,
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `Quantidade de ${target.item.foodName} corrigida por contexto curto via WhatsApp.`,
    data: {
      mealId: updatedMeal.id,
      foodName: target.item.foodName,
      previousQuantity: correction.previousQuantity,
      previousUnit: correction.previousUnit,
      nextQuantity: correction.nextQuantity,
      nextUnit: correction.nextUnit,
    },
  };
}

function parseSnackSuggestionIntent(text: string) {
  const normalized = normalizeIntentText(text);
  if (!/\b(sugestao|sugira|sugerir|dica|ideia|indica|indique)\b/.test(normalized)) {
    return false;
  }

  return /\blanche\b/.test(normalized) || /\blanche da tarde\b/.test(normalized);
}

function buildDateFromMatch(day: string, month: string, year: string | undefined, reference: Date, endOfDay = false) {
  const referenceParts = getZonedParts(reference);
  const parsedYear = year
    ? Number(year.length === 2 ? `20${year}` : year)
    : referenceParts.year;
  return makeDateInTimeZone({
    year: parsedYear,
    month: Number(month),
    day: Number(day),
    hour: endOfDay ? 23 : 0,
    minute: endOfDay ? 59 : 0,
    second: endOfDay ? 59 : 0,
  });
}

function parseExplicitPeriodRange(normalized: string, receivedAt: Date): PeriodRange | null {
  const match = normalized.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\s*(?:a|ate)\s*(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);
  if (!match) {
    return null;
  }

  const start = buildDateFromMatch(match[1], match[2], match[3], receivedAt);
  const end = buildDateFromMatch(match[4], match[5], match[6] ?? match[3], receivedAt, true);
  if (start.getTime() > end.getTime()) {
    return null;
  }

  return {
    label: `${formatReplyDate(start)} a ${formatReplyDate(end)}`,
    start,
    end,
  };
}

function parseReportPeriod(text: string, receivedAt: Date) {
  const normalized = normalizeIntentText(text);
  if (!/\b(resumo|relatorio|balanco)\b/.test(normalized)) {
    return null;
  }

  const explicitRange = parseExplicitPeriodRange(normalized, receivedAt);
  if (explicitRange) {
    return explicitRange;
  }

  if (/\bhoje\b/.test(normalized)) {
    return { label: "hoje", start: startOfZonedDay(receivedAt), end: endOfZonedDay(receivedAt) };
  }

  if (/\bontem\b/.test(normalized)) {
    const yesterday = makeDateInTimeZone(addDaysToZonedDate(getZonedParts(receivedAt), -1));
    return { label: "ontem", start: startOfZonedDay(yesterday), end: endOfZonedDay(yesterday) };
  }

  if (/\b(ultimos 7 dias|ultimos sete dias)\b/.test(normalized)) {
    const start = startOfZonedDay(makeDateInTimeZone(addDaysToZonedDate(getZonedParts(receivedAt), -6)));
    return { label: "últimos 7 dias", start, end: endOfZonedDay(receivedAt) };
  }

  if (/\bsemana\b/.test(normalized)) {
    const start = startOfZonedWeek(receivedAt);
    const end = endOfZonedDay(makeDateInTimeZone(addDaysToZonedDate(getZonedParts(start), 6)));
    return { label: "semana", start, end };
  }

  if (/\bmes\b/.test(normalized)) {
    return { label: "mês", start: startOfZonedMonth(receivedAt), end: endOfZonedMonth(receivedAt) };
  }

  return { kind: "clarification" as const };
}

function findTargetMealItem(items: MealItemInput[], targetFood: string | null) {
  if (!items.length) {
    return null;
  }

  if (!targetFood) {
    return { item: items[items.length - 1], index: items.length - 1 };
  }

  const normalizedTarget = normalizeIntentText(targetFood);
  const index = items.findIndex(item => {
    const foodName = normalizeIntentText(item.foodName);
    const canonicalName = normalizeIntentText(item.canonicalName);
    return foodName.includes(normalizedTarget) || canonicalName.includes(normalizedTarget) || normalizedTarget.includes(foodName);
  });

  if (index < 0) {
    return null;
  }

  return { item: items[index], index };
}

function findMealByLabel(meals: ExistingMeal[], mealLabel: string, referenceDate: Date) {
  const normalizedLabel = normalizeIntentText(mealLabel);
  const dayStart = startOfZonedDay(referenceDate).getTime();
  const dayEnd = endOfZonedDay(referenceDate).getTime();
  const matches = meals.filter(meal => {
    const candidate = normalizeIntentText(meal.mealLabel);
    return candidate === normalizedLabel || candidate.includes(normalizedLabel) || normalizedLabel.includes(candidate);
  });

  return matches.find(meal => {
    const occurredAt = new Date(meal.occurredAt).getTime();
    return occurredAt >= dayStart && occurredAt <= dayEnd;
  }) ?? matches[0] ?? null;
}

function scaleMealItem(item: MealItemInput, nextGrams: number): MealItemInput {
  const previousGrams = Number(item.estimatedGrams || 0);
  const ratio = previousGrams > 0 ? nextGrams / previousGrams : 1;
  return {
    ...item,
    estimatedGrams: nextGrams,
    portionText: `${formatNumber(nextGrams)} g`,
    quantity: nextGrams,
    unit: "g",
    servings: Math.max(Number(item.servings || 1) * ratio, 0.1),
    calories: Number((Number(item.calories || 0) * ratio).toFixed(1)),
    protein: Number((Number(item.protein || 0) * ratio).toFixed(1)),
    carbs: Number((Number(item.carbs || 0) * ratio).toFixed(1)),
    fat: Number((Number(item.fat || 0) * ratio).toFixed(1)),
  };
}

function buildCatalogMealItem(item: MealItemInput, nextFoodName: string, nextGrams: number, catalogFood: ReturnType<typeof getCatalogCache>[number]): MealItemInput {
  const factor = nextGrams / catalogFood.gramsPerServing;
  return {
    ...item,
    foodName: nextFoodName,
    canonicalName: catalogFood.name,
    estimatedGrams: nextGrams,
    portionText: item.portionText || `${formatNumber(nextGrams)} g`,
    quantity: item.quantity ?? nextGrams,
    unit: item.unit ?? "g",
    servings: Math.max(nextGrams / catalogFood.gramsPerServing, 0.1),
    calories: roundNutritionValue(catalogFood.calories * factor),
    protein: roundNutritionValue(catalogFood.protein * factor),
    carbs: roundNutritionValue(catalogFood.carbs * factor),
    fat: roundNutritionValue(catalogFood.fat * factor),
    confidence: Math.min(Math.max(Number(item.confidence || 0.8), 0.1), 0.95),
    source: "catalog",
  };
}

function buildHeuristicReplacementItem(item: MealItemInput, nextFoodName: string, nextGrams: number): MealItemInput {
  const factor = nextGrams / 100;
  return {
    ...item,
    foodName: nextFoodName,
    canonicalName: nextFoodName,
    estimatedGrams: nextGrams,
    portionText: item.portionText || `${formatNumber(nextGrams)} g`,
    quantity: item.quantity ?? nextGrams,
    unit: item.unit ?? "g",
    servings: Math.max(Number(item.servings || 1), 0.1),
    calories: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.calories * factor),
    protein: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.protein * factor),
    carbs: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.carbs * factor),
    fat: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.fat * factor),
    confidence: Math.min(Number(item.confidence || 0.8), 0.7),
    source: "heuristic",
  };
}

function replaceMealItemFood(item: MealItemInput, nextFoodName: string): MealItemInput {
  const nextGrams = Math.max(Number(item.estimatedGrams || 0), MIN_FOOD_GRAMS);
  const catalogFood = findCatalogFood(nextFoodName);
  if (catalogFood) {
    return buildCatalogMealItem(item, nextFoodName, nextGrams, catalogFood);
  }

  return buildHeuristicReplacementItem(item, nextFoodName, nextGrams);
}

function buildFoodAdditionItem(foodName: string, quantity: number, unit = "g"): MealItemInput {
  const normalizedUnit = normalizeAdditionUnit(unit);
  const estimatedGrams = quantityToEstimatedGrams(quantity, normalizedUnit);
  const catalogFood = findCatalogFood(foodName);
  const item = catalogFood
    ? buildCatalogMealItem({ quantity, unit: normalizedUnit } as MealItemInput, foodName, estimatedGrams, catalogFood)
    : buildHeuristicReplacementItem({ quantity, unit: normalizedUnit } as MealItemInput, foodName, estimatedGrams);

  return {
    ...item,
    quantity,
    unit: normalizedUnit,
    portionText: `${formatNumber(quantity)} ${normalizedUnit}`,
  };
}

function buildUnsweetenedCoffeeItem(cups: number): MealItemInput {
  const volumeMl = Math.round(cups * UNSWEETENED_COFFEE_CUP_ML);
  const calories = Math.round(cups * UNSWEETENED_COFFEE_CALORIES_PER_CUP);
  const cupLabel = cups === 1 ? "xícara" : "xícaras";

  return {
    foodName: "Café sem açúcar",
    canonicalName: "Café preto sem açúcar",
    quantity: cups,
    unit: "xícara",
    portionText: `${formatNumber(cups)} ${cupLabel} (${formatNumber(volumeMl)} ml)`,
    servings: Math.max(cups, 0.1),
    estimatedGrams: volumeMl,
    calories,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 0.8,
    source: "heuristic",
  };
}

function sumMealItems(items: MealItemInput[]): NutritionTotals {
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

function isMealInsidePeriod(meal: { occurredAt: number | string | Date }, period: PeriodRange) {
  const occurredAt = new Date(meal.occurredAt).getTime();
  return occurredAt >= period.start.getTime() && occurredAt <= period.end.getTime();
}

function countPeriodDays(period: PeriodRange) {
  const start = startOfZonedDay(period.start).getTime();
  const end = startOfZonedDay(period.end).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function formatTotalsLine(totals: NutritionTotals) {
  return `${formatNumber(totals.calories)} kcal | Prot. ${formatNumber(totals.protein)} g | Carb. ${formatNumber(totals.carbs)} g | Gord. ${formatNumber(totals.fat)} g`;
}

function buildPeriodGoalSummaryLines(goalCalories: number, diff: number) {
  if (goalCalories <= 0) {
    return [];
  }

  const balanceLabel = diff > 0 ? "Superávit" : "Déficit";
  const balanceDetail = diff > 0 ? "da meta estimada do período" : "para a meta estimada do período";

  return [
    "*Meta do resumo:*",
    `• Meta estimada: ${formatNumber(goalCalories)} kcal`,
    `• ${balanceLabel}: ${formatNumber(Math.abs(diff))} kcal ${balanceDetail}`,
  ];
}

function formatAddedItemsList(items: MealItemInput[]) {
  const labels = items.map(item => `${item.portionText} de ${item.foodName}`);
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }

  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

async function handleWaterIntent(userId: number, text: string, receivedAt: Date, amountMl: number): Promise<WhatsappIntentResult> {
  const occurredAt = resolveRelativeOccurredAt(text, receivedAt);
  const created = await createWaterLog(userId, {
    amountMl,
    occurredAt: occurredAt.toISOString(),
  });

  return {
    handled: true,
    action: "water_logged",
    reply: `Registrei ${formatNumber(amountMl)} ml de água em ${formatReplyDateTime(occurredAt)}.`,
    eventType: "whatsapp.intent.water_logged",
    detail: `Consumo de ${amountMl} ml de água registrado após interpretação de data relativa pelo WhatsApp.`,
    data: {
      waterLogId: created.id,
      amountMl,
      occurredAt: occurredAt.toISOString(),
    },
  };
}

async function updateLatestMealItemGrams(input: {
  userId: number;
  targetFood: string | null;
  resolveNextGrams: (previousGrams: number) => number;
  detail: string;
}) {
  const latestMeal = (await listMeals(input.userId))[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem refeição recente disponível.",
    } satisfies WhatsappIntentResult;
  }

  const latestItems = toMealItemInputs(latestMeal.items);
  const target = findTargetMealItem(latestItems, input.targetFood);
  if (!target) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei esse alimento na última refeição. Me diga qual item devo ajustar.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem alimento compatível na última refeição.",
    } satisfies WhatsappIntentResult;
  }

  const previousGrams = Number(target.item.estimatedGrams || 0);
  const nextGrams = Math.max(input.resolveNextGrams(previousGrams), MIN_FOOD_GRAMS);
  const nextItems = latestMeal.items.map((item, index) => index === target.index ? scaleMealItem(toMealItemInput(item), nextGrams) : item);
  const updatedMeal = await updateMeal(input.userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: nextItems as MealItemInput[],
  });

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: `Ajustei ${target.item.foodName}: de ${formatNumber(previousGrams)} g para ${formatNumber(nextGrams)} g na última refeição e recalculei os macros.`,
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: input.detail,
    data: {
      mealId: updatedMeal.id,
      foodName: target.item.foodName,
      previousGrams,
      nextGrams,
    },
  } satisfies WhatsappIntentResult;
}

async function handleMealItemAdjustment(userId: number, adjustment: NonNullable<ReturnType<typeof parseMealItemGramsAdjustment>>): Promise<WhatsappIntentResult> {
  return updateLatestMealItemGrams({
    userId,
    targetFood: adjustment.targetFood,
    resolveNextGrams: previousGrams => previousGrams - adjustment.gramsDelta,
    detail: `Último item compatível ajustado em ${formatNumber(adjustment.gramsDelta)} g via WhatsApp.`,
  });
}

async function handleMealItemIncrement(userId: number, increment: NonNullable<ReturnType<typeof parseMealItemGramsIncrement>>): Promise<WhatsappIntentResult> {
  return updateLatestMealItemGrams({
    userId,
    targetFood: increment.targetFood,
    resolveNextGrams: previousGrams => previousGrams + increment.gramsDelta,
    detail: `Último item compatível incrementado em ${formatNumber(increment.gramsDelta)} g via WhatsApp.`,
  });
}

async function handleMealItemReplacement(userId: number, replacement: NonNullable<ReturnType<typeof parseMealItemGramsReplacement>>): Promise<WhatsappIntentResult> {
  return updateLatestMealItemGrams({
    userId,
    targetFood: replacement.targetFood,
    resolveNextGrams: () => replacement.nextGrams,
    detail: `Quantidade de ${replacement.targetFood} substituída para ${formatNumber(replacement.nextGrams)} g via WhatsApp.`,
  });
}

async function handleFoodReplacementIntent(userId: number, replacement: FoodReplacementIntent): Promise<WhatsappIntentResult> {
  const latestMeal = (await listMeals(userId))[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para corrigir. Me diga qual alimento devo trocar.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição de alimento sem refeição recente disponível.",
    };
  }

  const latestItems = toMealItemInputs(latestMeal.items);
  const target = findTargetMealItem(latestItems, replacement.fromFood);
  if (!target) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei ${replacement.fromFood} na última refeição. Me diga qual alimento devo trocar.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de substituição de alimento sem item compatível na última refeição.",
    };
  }

  const nextItems = latestMeal.items.map((item, index) => index === target.index ? replaceMealItemFood(toMealItemInput(item), replacement.toFood) : item);
  const replacedItem = nextItems[target.index];
  const recalculationSource = replacedItem.source === "catalog" ? "com base no catálogo" : "por estimativa";
  const updatedMeal = await updateMeal(userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: nextItems as MealItemInput[],
  });

  return {
    handled: true,
    action: "meal_item_replaced",
    reply: `Troquei ${target.item.foodName} por ${replacement.toFood} na última refeição e recalculei os macros ${recalculationSource}. Quantidade mantida: ${formatNumber(replacedItem.estimatedGrams)} g. Estimativa: ${formatTotalsLine(replacedItem)}.`,
    eventType: "whatsapp.intent.meal_item_replaced",
    detail: `Alimento ${target.item.foodName} substituído por ${replacement.toFood} via WhatsApp com macros recalculados.`,
    data: {
      mealId: updatedMeal.id,
      previousFoodName: target.item.foodName,
      nextFoodName: replacement.toFood,
      estimatedGrams: replacedItem.estimatedGrams,
      calories: replacedItem.calories,
      protein: replacedItem.protein,
      carbs: replacedItem.carbs,
      fat: replacedItem.fat,
      nutritionSource: replacedItem.source,
    },
  };
}

async function handleFoodAdditionIntent(userId: number, addition: FoodAdditionIntent): Promise<WhatsappIntentResult> {
  const meals = await listMeals(userId);
  const targetMeal = findMealByLabel(meals, addition.mealLabel, addition.date);
  if (!targetMeal) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei a refeição ${addition.mealLabel} em ${formatReplyDate(addition.date)}. Me diga em qual refeição devo adicionar ${addition.items[0]?.foodName ?? "o alimento"}.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido para adicionar alimento sem refeição compatível no dia indicado.",
    };
  }

  const addedItems = addition.items.map(item => buildFoodAdditionItem(item.foodName, item.quantity, item.unit));
  const updatedMeal = await updateMeal(userId, {
    mealId: targetMeal.id,
    mealLabel: targetMeal.mealLabel,
    occurredAt: new Date(targetMeal.occurredAt).toISOString(),
    notes: targetMeal.notes,
    items: [...(targetMeal.items ?? []), ...addedItems] as MealItemInput[],
  });

  if (addedItems.length === 1) {
    const addedItem = addedItems[0];
    const recalculationSource = addedItem.source === "catalog" ? "com base no catálogo" : "por estimativa";
    return {
      handled: true,
      action: "meal_item_added",
      reply: `Adicionei ${addedItem.portionText} de ${addedItem.foodName} à refeição ${targetMeal.mealLabel} de ${formatReplyDate(new Date(targetMeal.occurredAt))}. Estimativa ${recalculationSource}: ${formatTotalsLine(addedItem)}.`,
      eventType: "whatsapp.intent.meal_item_added",
      detail: `Alimento ${addedItem.foodName} adicionado à refeição ${targetMeal.mealLabel} via WhatsApp com data relativa interpretada.`,
      data: {
        mealId: updatedMeal.id,
        mealLabel: targetMeal.mealLabel,
        foodName: addedItem.foodName,
        quantity: addedItem.quantity,
        unit: addedItem.unit,
        estimatedGrams: addedItem.estimatedGrams,
        calories: addedItem.calories,
        protein: addedItem.protein,
        carbs: addedItem.carbs,
        fat: addedItem.fat,
        nutritionSource: addedItem.source,
      },
    };
  }

  return {
    handled: true,
    action: "meal_item_added",
    reply: `Adicionado à refeição ${targetMeal.mealLabel} de ${formatReplyDate(new Date(targetMeal.occurredAt))}: ${formatAddedItemsList(addedItems)}.`,
    eventType: "whatsapp.intent.meal_item_added",
    detail: `${addedItems.length} alimentos adicionados à refeição ${targetMeal.mealLabel} via WhatsApp com data relativa interpretada.`,
    data: {
      mealId: updatedMeal.id,
      mealLabel: targetMeal.mealLabel,
      itemCount: addedItems.length,
      items: addedItems.map(item => ({
        foodName: item.foodName,
        quantity: item.quantity,
        unit: item.unit,
        estimatedGrams: item.estimatedGrams,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        nutritionSource: item.source,
      })),
    },
  };
}

async function handleCoffeeAdditionIntent(userId: number, text: string, addition: CoffeeAdditionIntent, receivedAt: Date): Promise<WhatsappIntentResult> {
  if (!addition.cups || !addition.mealLabel) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Entendi que você quer adicionar café sem açúcar. Me diga a quantidade e a refeição. Exemplo: adicionar 3 xícaras de café sem açúcar à refeição café da manhã.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido para adicionar café sem açúcar sem quantidade ou refeição explícita.",
    };
  }

  const targetDate = resolveRelativeOccurredAt(text, receivedAt);
  const meals = await listMeals(userId);
  const targetMeal = findMealByLabel(meals, addition.mealLabel, targetDate);
  if (!targetMeal) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Não encontrei a refeição ${addition.mealLabel}. Me diga em qual refeição devo adicionar o café.`,
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido para adicionar café sem açúcar sem refeição compatível.",
    };
  }

  const coffeeItem = buildUnsweetenedCoffeeItem(addition.cups);
  const updatedMeal = await updateMeal(userId, {
    mealId: targetMeal.id,
    mealLabel: targetMeal.mealLabel,
    occurredAt: new Date(targetMeal.occurredAt).toISOString(),
    notes: targetMeal.notes,
    items: [...(targetMeal.items ?? []), coffeeItem] as MealItemInput[],
  });

  return {
    handled: true,
    action: "meal_item_added",
    reply: `Adicionei ${coffeeItem.portionText} de café sem açúcar à refeição ${targetMeal.mealLabel}. Estimativa: ${formatTotalsLine(coffeeItem)}.`,
    eventType: "whatsapp.intent.meal_item_added",
    detail: `Café sem açúcar adicionado à refeição ${targetMeal.mealLabel} via WhatsApp.`,
    data: {
      mealId: updatedMeal.id,
      mealLabel: targetMeal.mealLabel,
      foodName: coffeeItem.foodName,
      cups: addition.cups,
      quantity: coffeeItem.quantity,
      unit: coffeeItem.unit,
      calories: coffeeItem.calories,
    },
  };
}

function buildSnackSuggestionReply() {
  return [
    "Sugestão para o lanche da tarde:",
    "",
    "• Iogurte natural com banana e aveia",
    "  Aproximadamente 280 kcal | boa proteína e energia para a tarde",
    "",
    "Outra opção:",
    "• Pão integral com queijo branco e tomate",
    "  Aproximadamente 300 kcal | simples, saciante e fácil de montar",
    "",
    "Se quiser, envie o que você tem em casa que eu sugiro uma opção mais certeira.",
  ].join("\n");
}

async function handleSnackSuggestionIntent(): Promise<WhatsappIntentResult> {
  return {
    handled: true,
    action: "meal_suggestion",
    reply: buildSnackSuggestionReply(),
    eventType: "whatsapp.intent.meal_suggestion",
    detail: "Sugestão de lanche da tarde enviada pelo WhatsApp.",
  };
}

async function handlePeriodReportIntent(userId: number, period: PeriodRange): Promise<WhatsappIntentResult> {
  const [meals, goal] = await Promise.all([
    listMeals(userId),
    getUserNutritionGoal(userId),
  ]);
  const mealsInPeriod = meals.filter(meal => isMealInsidePeriod(meal, period));
  const totals = mealsInPeriod.reduce(
    (acc, meal) => {
      const itemTotals = sumMealItems(toMealItemInputs(meal.items));
      acc.calories += itemTotals.calories;
      acc.protein += itemTotals.protein;
      acc.carbs += itemTotals.carbs;
      acc.fat += itemTotals.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const periodDays = countPeriodDays(period);
  const goalCalories = Math.round((goal.today?.calories ?? 0) * periodDays);
  const diff = Math.round(totals.calories - goalCalories);
  const goalSummaryLines = buildPeriodGoalSummaryLines(goalCalories, diff);

  const reply = mealsInPeriod.length
    ? [
        `Resumo de ${period.label}:`,
        "",
        `Refeições registradas: ${mealsInPeriod.length}`,
        `Total consumido: ${formatTotalsLine(totals)}`,
        ...(goalSummaryLines.length ? ["", ...goalSummaryLines] : []),
      ].join("\n")
    : [
        `Resumo de ${period.label}:`,
        "",
        "Não encontrei refeições registradas nesse período.",
      ].join("\n");

  return {
    handled: true,
    action: "period_report",
    reply,
    eventType: "whatsapp.intent.period_report",
    detail: `Relatório de ${period.label} enviado pelo WhatsApp com ${mealsInPeriod.length} refeição(ões).`,
    data: {
      periodLabel: period.label,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      mealCount: mealsInPeriod.length,
    },
  };
}

export async function executeWhatsappTextIntent(userId: number, input: WhatsappIntentInput): Promise<WhatsappIntentResult | null> {
  const text = input.text?.trim();
  if (!text) {
    return null;
  }

  const receivedAt = input.receivedAt ?? new Date();
  const waterIntent = parseWaterIntent(text);
  if (waterIntent?.kind === "clarification") {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Entendi que você quer registrar água, mas preciso da quantidade. Exemplo: 500 ml de água ontem.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de água sem quantidade explícita.",
    };
  }
  if (waterIntent?.kind === "water") {
    return handleWaterIntent(userId, text, receivedAt, waterIntent.amountMl);
  }

  const quantityCorrection = parseQuantityCorrectionIntent(text, receivedAt);
  if (quantityCorrection) {
    return handleQuantityCorrectionIntent(userId, quantityCorrection);
  }

  const gramsReplacement = parseMealItemGramsReplacement(text);
  if (gramsReplacement) {
    return handleMealItemReplacement(userId, gramsReplacement);
  }

  const coffeeAddition = parseCoffeeAdditionIntent(text);
  if (coffeeAddition) {
    return handleCoffeeAdditionIntent(userId, text, coffeeAddition, receivedAt);
  }

  const foodAddition = parseFoodAdditionIntent(text, receivedAt);
  if (foodAddition) {
    return handleFoodAdditionIntent(userId, foodAddition);
  }

  const gramsIncrement = parseMealItemGramsIncrement(text);
  if (gramsIncrement) {
    return handleMealItemIncrement(userId, gramsIncrement);
  }

  const gramsAdjustment = parseMealItemGramsAdjustment(text);
  if (gramsAdjustment) {
    return handleMealItemAdjustment(userId, gramsAdjustment);
  }

  const foodReplacement = parseFoodReplacementIntent(text);
  if (foodReplacement) {
    return handleFoodReplacementIntent(userId, foodReplacement);
  }

  if (parseSnackSuggestionIntent(text)) {
    return handleSnackSuggestionIntent();
  }

  const reportPeriod = parseReportPeriod(text, receivedAt);
  if (!reportPeriod) {
    return null;
  }
  if ("kind" in reportPeriod) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Posso montar um resumo. Me diga o período, por exemplo: hoje, ontem, semana, mês ou 01/06 a 03/06.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de relatório sem período explícito.",
    };
  }

  return handlePeriodReportIntent(userId, reportPeriod);
}
