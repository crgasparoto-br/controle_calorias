import { listMeals } from "../meals/service";
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import type { MealDraftItem } from "../../nutritionEngine";
import { buildWhatsAppMealContextLine } from "./replyMessages";
import { getWhatsAppUserTimeZone } from "./userMeasurementReplyContext";
import {
  addDaysToZonedDate,
  endOfZonedDay,
  formatReplyDate,
  getZonedParts,
  makeDateInTimeZone,
  startOfZonedDay,
} from "./intent/dateTime";
import {
  buildWhatsAppBlock,
  buildWhatsAppFoodLines,
  buildWhatsAppMealTotalLines,
  buildWhatsAppSeparator,
  buildWhatsAppTitle,
  formatWhatsAppNutritionTotalsLine,
  type WhatsAppFoodReplyItem,
  type WhatsAppNutritionTotals,
} from "./replyTemplates";


export type WhatsappMealListIntentResult = {
  action: "meal_foods_listed" | "clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

type ExistingMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  items?: MealDraftItem[];
};

type MealListIntent = {
  kind: "latest" | "by_label" | "day";
  mealLabel?: string;
  referenceDate?: Date;
};

type MealGroup = {
  label: string;
  meals: ExistingMeal[];
  items: MealDraftItem[];
};

const ptBrNumberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

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
  return ptBrNumberFormatter.format(value);
}

function resolveRelativeDate(normalized: string, receivedAt: Date, timeZone: string) {
  const referenceParts = getZonedParts(receivedAt, timeZone);
  if (/\banteontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -2), timeZone);
  }
  if (/\bontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -1), timeZone);
  }
  return receivedAt;
}

function parseMealLabel(normalized: string) {
  if (/\bcafe da manha\b/.test(normalized)) return "Café da manhã";
  if (/\balmoco\b/.test(normalized)) return "Almoço";
  if (/\bjantar\b|\bjanta\b/.test(normalized)) return "Jantar";
  if (/\blanche da tarde\b/.test(normalized)) return "Lanche da tarde";
  if (/\blanche\b/.test(normalized)) return "Lanche";
  if (/\bceia\b/.test(normalized)) return "Ceia";
  return null;
}

function asksForFoodList(normalized: string) {
  return /\b(o que comi hoje|alimentos de hoje|alimentos registrados|alimentos do dia|refeicoes registradas|registros dos alimentos)\b/.test(normalized)
    || (/\b(listar|lista|liste|mostra|mostrar|mostre|quais|qual|ver|visualizar|exibir|o que)\b/.test(normalized)
      && /\b(alimentos?|itens?|comidas?|registrad[oa]s?|refeicao|refeicoes|registros?)\b/.test(normalized));
}

function parseMealListIntent(text: string, receivedAt: Date, timeZone: string): MealListIntent | null {
  const normalized = normalizeText(text);
  if (!asksForFoodList(normalized)) {
    return null;
  }

  if (/\b(ultima|ultimo|mais recente)\b/.test(normalized)) {
    return { kind: "latest" };
  }

  const referenceDate = resolveRelativeDate(normalized, receivedAt, timeZone);
  const mealLabel = parseMealLabel(normalized);
  if (mealLabel) {
    return {
      kind: "by_label",
      mealLabel,
      referenceDate,
    };
  }

  return {
    kind: "day",
    referenceDate,
  };
}

function mealLabelMatches(candidate: string, target: string) {
  const normalizedCandidate = normalizeText(candidate);
  const normalizedTarget = normalizeText(target);
  return normalizedCandidate === normalizedTarget
    || normalizedCandidate.includes(normalizedTarget)
    || normalizedTarget.includes(normalizedCandidate);
}

function isMealInsideDay(meal: ExistingMeal, referenceDate: Date, timeZone: string) {
  const occurredAt = new Date(meal.occurredAt).getTime();
  return occurredAt >= startOfZonedDay(referenceDate, timeZone).getTime() && occurredAt <= endOfZonedDay(referenceDate, timeZone).getTime();
}

function findMealByLabelAndDate(meals: ExistingMeal[], mealLabel: string, referenceDate: Date, timeZone: string) {
  return meals.find(meal => mealLabelMatches(meal.mealLabel, mealLabel) && isMealInsideDay(meal, referenceDate, timeZone)) ?? null;
}

/** Converte um item de refeição (domínio) para o bloco de item central (issue #781/#783). */
function toReplyItem(item: MealDraftItem): WhatsAppFoodReplyItem {
  return {
    foodName: item.foodName,
    canonicalName: item.canonicalName,
    category: (item as { category?: unknown }).category,
    classification: (item as { classification?: unknown }).classification,
    tags: (item as { tags?: unknown }).tags,
    portionText: item.portionText?.trim() || (item.estimatedGrams ? `${formatNumber(item.estimatedGrams)} g` : "porção registrada"),
    estimatedGrams: item.estimatedGrams ?? 0,
    source: item.source,
    calories: Number(item.calories || 0),
    protein: Number(item.protein || 0),
    carbs: Number(item.carbs || 0),
    fat: Number(item.fat || 0),
  };
}

function buildItemBlockLines(items: MealDraftItem[]) {
  return items.flatMap((item, index) => [
    ...buildWhatsAppFoodLines(toReplyItem(item)),
    ...(index < items.length - 1 ? [buildWhatsAppSeparator()] : []),
  ]);
}

function sumMealItems(items: MealDraftItem[]): WhatsAppNutritionTotals {
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

function groupMealsByLabel(meals: ExistingMeal[]) {
  const groups = new Map<string, MealGroup>();
  for (const meal of meals) {
    const label = meal.mealLabel?.trim() || "Refeição";
    const key = normalizeText(label) || label;
    const group = groups.get(key) ?? { label, meals: [], items: [] };
    group.meals.push(meal);
    group.items.push(...(meal.items ?? []));
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Consulta de uma refeição e seus alimentos usando os mesmos blocos de contexto/item/total do registro (issue #783). */
export function formatMealListReply(meal: ExistingMeal, isLatest: boolean, timeZone = DEFAULT_APP_TIME_ZONE) {
  const items = meal.items ?? [];
  const mealDate = new Date(meal.occurredAt);
  const title = isLatest
    ? `Alimentos da última refeição (${meal.mealLabel})`
    : `Alimentos de ${meal.mealLabel} em ${formatReplyDate(mealDate, timeZone)}`;
  const contextLine = buildWhatsAppMealContextLine(meal.mealLabel, meal.occurredAt);

  if (!items.length) {
    return buildWhatsAppBlock([
      buildWhatsAppTitle(title, { bold: true }),
      buildWhatsAppSeparator(),
      contextLine,
      buildWhatsAppSeparator(),
      "Encontrei a refeição, mas ela não tem alimentos registrados.",
    ]);
  }

  return buildWhatsAppBlock([
    buildWhatsAppTitle(title, { bold: true }),
    buildWhatsAppSeparator(),
    contextLine,
    buildWhatsAppSeparator(),
    ...buildItemBlockLines(items),
    buildWhatsAppSeparator(),
    ...buildWhatsAppMealTotalLines(sumMealItems(items)),
  ]);
}

function formatDayMealGroupLines(group: MealGroup) {
  const contextLine = buildWhatsAppMealContextLine(group.label);
  if (!group.items.length) {
    return [contextLine, "Sem alimentos detalhados."];
  }
  return [
    contextLine,
    ...buildItemBlockLines(group.items),
    buildWhatsAppSeparator(),
    ...buildWhatsAppMealTotalLines(sumMealItems(group.items)),
  ];
}

export function formatDayMealListReply(meals: ExistingMeal[], referenceDate: Date, timeZone = DEFAULT_APP_TIME_ZONE, now: Date = new Date()) {
  const mealsInDay = meals.filter(meal => isMealInsideDay(meal, referenceDate, timeZone));
  const dateLabel = formatReplyDate(referenceDate, timeZone);
  // "hoje" é relativo ao timestamp da mensagem no timezone do usuário (#784).
  const titleLabel = dateLabel === formatReplyDate(now, timeZone)
    ? "Alimentos registrados hoje"
    : `Alimentos registrados em ${dateLabel}`;
  if (!mealsInDay.length) {
    return buildWhatsAppBlock([
      buildWhatsAppTitle(titleLabel, { bold: true }),
      buildWhatsAppSeparator(),
      "Não encontrei alimentos registrados nessa data.",
    ]);
  }

  const groups = groupMealsByLabel(mealsInDay);
  const lines = groups.flatMap((group, index) => {
    const groupLines = formatDayMealGroupLines(group);
    return index === groups.length - 1 ? groupLines : [...groupLines, buildWhatsAppSeparator()];
  });
  const allItems = groups.flatMap(group => group.items);

  return buildWhatsAppBlock([
    buildWhatsAppTitle(titleLabel, { bold: true }),
    buildWhatsAppSeparator(),
    ...lines,
    buildWhatsAppSeparator(),
    "Total do dia:",
    formatWhatsAppNutritionTotalsLine(sumMealItems(allItems)),
  ]);
}

export async function executeWhatsappMealListIntent(userId: number, input: { text?: string | null; receivedAt?: Date }): Promise<WhatsappMealListIntentResult | null> {
  const text = input.text?.trim();
  if (!text) return null;

  const receivedAt = input.receivedAt ?? new Date();
  const timeZone = await getWhatsAppUserTimeZone(userId);
  const intent = parseMealListIntent(text, receivedAt, timeZone);
  if (!intent) return null;

  const meals = await listMeals(userId);
  if (intent.kind === "day") {
    const referenceDate = intent.referenceDate ?? receivedAt;
    const mealsInDay = meals.filter(meal => isMealInsideDay(meal, referenceDate, timeZone));
    return {
      action: "meal_foods_listed",
      reply: formatDayMealListReply(meals, referenceDate, timeZone, receivedAt),
      eventType: "whatsapp.intent.meal_foods_listed",
      detail: `Lista de alimentos enviada para ${formatReplyDate(referenceDate, timeZone)} com ${mealsInDay.length} refeição(ões).`,
      data: {
        referenceDate: referenceDate.toISOString(),
        mealCount: mealsInDay.length,
        itemCount: mealsInDay.reduce((count, meal) => count + (meal.items?.length ?? 0), 0),
      },
    };
  }

  const targetMeal = intent.kind === "latest"
    ? meals.find(meal => (meal.items?.length ?? 0) > 0) ?? meals[0] ?? null
    : findMealByLabelAndDate(meals, intent.mealLabel!, intent.referenceDate!, timeZone);

  if (!targetMeal) {
    const missingLabel = intent.kind === "latest"
      ? "a última refeição"
      : `a refeição ${intent.mealLabel} em ${formatReplyDate(intent.referenceDate!, timeZone)}`;
    return {
      action: "clarification_needed",
      reply: `Não encontrei ${missingLabel}. Confira se ela já foi registrada ou me diga outra refeição/data.`,
      eventType: "whatsapp.intent.meal_foods_not_found",
      detail: `Consulta de alimentos sem refeição compatível: ${missingLabel}.`,
      data: {
        requestedMealLabel: intent.kind === "by_label" ? intent.mealLabel : undefined,
      },
    };
  }

  return {
    action: "meal_foods_listed",
    reply: formatMealListReply(targetMeal, intent.kind === "latest", timeZone),
    eventType: "whatsapp.intent.meal_foods_listed",
    detail: `Lista de alimentos enviada para a refeição ${targetMeal.mealLabel} (${targetMeal.id}).`,
    data: {
      mealId: targetMeal.id,
      mealLabel: targetMeal.mealLabel,
      itemCount: targetMeal.items?.length ?? 0,
    },
  };
}

export const contextUsage: import("./intentContext").IntentContextUsage = {
  usesRecentWindow: false,
  usesSummary: false,
  usesPendingOperation: false,
  usesLongTermMemory: false,
  requiresFreshDbQuery: true,
};
