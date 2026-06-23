import { listMeals } from "../meals/service";
import type { MealDraftItem } from "../../nutritionEngine";

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

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

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
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

function formatReplyDate(date: Date) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: SAO_PAULO_TIME_ZONE,
  });
}

function formatReplyTime(date: Date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
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

function startOfZonedDay(date: Date) {
  const parts = getZonedParts(date);
  return makeDateInTimeZone({ ...parts, hour: 0, minute: 0, second: 0 });
}

function endOfZonedDay(date: Date) {
  const parts = getZonedParts(date);
  return makeDateInTimeZone({ ...parts, hour: 23, minute: 59, second: 59 });
}

function resolveRelativeDate(normalized: string, receivedAt: Date) {
  const referenceParts = getZonedParts(receivedAt);
  if (/\banteontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -2));
  }
  if (/\bontem\b/.test(normalized)) {
    return makeDateInTimeZone(addDaysToZonedDate(referenceParts, -1));
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

function parseMealListIntent(text: string, receivedAt: Date): MealListIntent | null {
  const normalized = normalizeText(text);
  if (!asksForFoodList(normalized)) {
    return null;
  }

  if (/\b(ultima|ultimo|mais recente)\b/.test(normalized)) {
    return { kind: "latest" };
  }

  const referenceDate = resolveRelativeDate(normalized, receivedAt);
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

function isMealInsideDay(meal: ExistingMeal, referenceDate: Date) {
  const occurredAt = new Date(meal.occurredAt).getTime();
  return occurredAt >= startOfZonedDay(referenceDate).getTime() && occurredAt <= endOfZonedDay(referenceDate).getTime();
}

function findMealByLabelAndDate(meals: ExistingMeal[], mealLabel: string, referenceDate: Date) {
  return meals.find(meal => mealLabelMatches(meal.mealLabel, mealLabel) && isMealInsideDay(meal, referenceDate)) ?? null;
}

function formatItemLine(item: MealDraftItem) {
  const portion = item.portionText?.trim() || (item.estimatedGrams ? `${formatNumber(item.estimatedGrams)} g` : "porção registrada");
  return `• ${portion} de ${item.foodName} - ${formatNumber(item.calories)} kcal | Prot. ${formatNumber(item.protein)} g | Carb. ${formatNumber(item.carbs)} g | Gord. ${formatNumber(item.fat)} g`;
}

function sumMealItems(items: MealDraftItem[]) {
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

function formatTotals(totals: ReturnType<typeof sumMealItems>) {
  return `${formatNumber(totals.calories)} kcal | Prot. ${formatNumber(totals.protein)} g | Carb. ${formatNumber(totals.carbs)} g | Gord. ${formatNumber(totals.fat)} g`;
}

function formatMealListReply(meal: ExistingMeal, isLatest: boolean) {
  const items = meal.items ?? [];
  const mealDate = new Date(meal.occurredAt);
  const title = isLatest
    ? `Alimentos da última refeição (${meal.mealLabel} às ${formatReplyTime(mealDate)}):`
    : `Alimentos de ${meal.mealLabel} em ${formatReplyDate(mealDate)}:`;

  if (!items.length) {
    return `${title}\n\nEncontrei a refeição, mas ela não tem alimentos registrados.`;
  }

  return [
    title,
    "",
    ...items.map(formatItemLine),
    "",
    `Total: ${formatTotals(sumMealItems(items))}`,
  ].join("\n");
}

function formatDayMealListReply(meals: ExistingMeal[], referenceDate: Date) {
  const mealsInDay = meals.filter(meal => isMealInsideDay(meal, referenceDate));
  const dateLabel = formatReplyDate(referenceDate);
  if (!mealsInDay.length) {
    return `Não encontrei alimentos registrados em ${dateLabel}.`;
  }

  const lines = mealsInDay.flatMap((meal, index) => {
    const items = meal.items ?? [];
    const mealLines = [
      `${meal.mealLabel} às ${formatReplyTime(new Date(meal.occurredAt))}:`,
      ...(items.length ? items.map(formatItemLine) : ["• Sem alimentos detalhados." ]),
    ];
    return index === mealsInDay.length - 1 ? mealLines : [...mealLines, ""];
  });
  const allItems = mealsInDay.flatMap(meal => meal.items ?? []);

  return [
    `Alimentos registrados em ${dateLabel}:`,
    "",
    ...lines,
    "",
    `Total do dia: ${formatTotals(sumMealItems(allItems))}`,
  ].join("\n");
}

export async function executeWhatsappMealListIntent(userId: number, input: { text?: string | null; receivedAt?: Date }): Promise<WhatsappMealListIntentResult | null> {
  const text = input.text?.trim();
  if (!text) return null;

  const receivedAt = input.receivedAt ?? new Date();
  const intent = parseMealListIntent(text, receivedAt);
  if (!intent) return null;

  const meals = await listMeals(userId);
  if (intent.kind === "day") {
    const referenceDate = intent.referenceDate ?? receivedAt;
    const mealsInDay = meals.filter(meal => isMealInsideDay(meal, referenceDate));
    return {
      action: "meal_foods_listed",
      reply: formatDayMealListReply(meals, referenceDate),
      eventType: "whatsapp.intent.meal_foods_listed",
      detail: `Lista de alimentos enviada para ${formatReplyDate(referenceDate)} com ${mealsInDay.length} refeição(ões).`,
      data: {
        referenceDate: referenceDate.toISOString(),
        mealCount: mealsInDay.length,
        itemCount: mealsInDay.reduce((count, meal) => count + (meal.items?.length ?? 0), 0),
      },
    };
  }

  const targetMeal = intent.kind === "latest"
    ? meals.find(meal => (meal.items?.length ?? 0) > 0) ?? meals[0] ?? null
    : findMealByLabelAndDate(meals, intent.mealLabel!, intent.referenceDate!);

  if (!targetMeal) {
    const missingLabel = intent.kind === "latest"
      ? "a última refeição"
      : `a refeição ${intent.mealLabel} em ${formatReplyDate(intent.referenceDate!)}`;
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
    reply: formatMealListReply(targetMeal, intent.kind === "latest"),
    eventType: "whatsapp.intent.meal_foods_listed",
    detail: `Lista de alimentos enviada para a refeição ${targetMeal.mealLabel} (${targetMeal.id}).`,
    data: {
      mealId: targetMeal.id,
      mealLabel: targetMeal.mealLabel,
      itemCount: targetMeal.items?.length ?? 0,
    },
  };
}
