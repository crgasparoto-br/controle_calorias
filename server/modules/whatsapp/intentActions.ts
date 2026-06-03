import { getUserNutritionGoal } from "../../db";
import { listMeals, updateMeal } from "../meals/service";
import { createWaterLog } from "../water/service";
import type { MealItemInput } from "../meals/schemas";

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const MAX_WATER_LOG_AMOUNT_ML = 10000;
const MIN_FOOD_GRAMS = 1;

type WhatsappIntentResult = {
  handled: true;
  action: "water_logged" | "meal_item_grams_adjusted" | "meal_suggestion" | "period_report" | "clarification_needed";
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

function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
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
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
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
  const rawTargetFood = targetMatch?.[1]
    ?.replace(/\b(?:ontem|hoje|agora|por favor|pfv)\b/g, "")
    .trim();

  return {
    gramsDelta,
    targetFood: rawTargetFood || null,
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

function scaleMealItem(item: MealItemInput, nextGrams: number): MealItemInput {
  const previousGrams = Number(item.estimatedGrams || 0);
  const ratio = previousGrams > 0 ? nextGrams / previousGrams : 1;
  return {
    ...item,
    estimatedGrams: nextGrams,
    portionText: `${formatNumber(nextGrams)} g`,
    servings: Math.max(Number(item.servings || 1) * ratio, 0.1),
    calories: Number((Number(item.calories || 0) * ratio).toFixed(1)),
    protein: Number((Number(item.protein || 0) * ratio).toFixed(1)),
    carbs: Number((Number(item.carbs || 0) * ratio).toFixed(1)),
    fat: Number((Number(item.fat || 0) * ratio).toFixed(1)),
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

async function handleMealItemAdjustment(userId: number, adjustment: NonNullable<ReturnType<typeof parseMealItemGramsAdjustment>>): Promise<WhatsappIntentResult> {
  const latestMeal = (await listMeals(userId))[0];
  if (!latestMeal?.items?.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei uma refeição recente para ajustar. Me diga o alimento e a quantidade atualizada.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem refeição recente disponível.",
    };
  }

  const target = findTargetMealItem(latestMeal.items, adjustment.targetFood);
  if (!target) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei esse alimento na última refeição. Me diga qual item devo ajustar.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de ajuste de gramas sem alimento compatível na última refeição.",
    };
  }

  const previousGrams = Number(target.item.estimatedGrams || 0);
  const nextGrams = Math.max(previousGrams - adjustment.gramsDelta, MIN_FOOD_GRAMS);
  const nextItems = latestMeal.items.map((item, index) => index === target.index ? scaleMealItem(item, nextGrams) : item);
  const updatedMeal = await updateMeal(userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: nextItems,
  });

  return {
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: `Ajustei ${target.item.foodName}: de ${formatNumber(previousGrams)} g para ${formatNumber(nextGrams)} g na última refeição.`,
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: `Último item compatível ajustado em ${formatNumber(adjustment.gramsDelta)} g via WhatsApp.`,
    data: {
      mealId: updatedMeal.id,
      foodName: target.item.foodName,
      previousGrams,
      nextGrams,
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
      const itemTotals = sumMealItems(meal.items ?? []);
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
  const goalLine = goalCalories > 0
    ? diff > 0
      ? `Você passou ${formatNumber(diff)} kcal da meta estimada do período.`
      : `Faltaram ${formatNumber(Math.abs(diff))} kcal para a meta estimada do período.`
    : null;

  const reply = mealsInPeriod.length
    ? [
        `Resumo de ${period.label}:`,
        "",
        `Refeições registradas: ${mealsInPeriod.length}`,
        `Total consumido: ${formatTotalsLine(totals)}`,
        ...(goalLine ? [`Meta estimada: ${formatNumber(goalCalories)} kcal`, goalLine] : []),
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

  const gramsAdjustment = parseMealItemGramsAdjustment(text);
  if (gramsAdjustment) {
    return handleMealItemAdjustment(userId, gramsAdjustment);
  }

  if (parseSnackSuggestionIntent(text)) {
    return handleSnackSuggestionIntent();
  }

  const reportPeriod = parseReportPeriod(text, receivedAt);
  if (reportPeriod && "kind" in reportPeriod && reportPeriod.kind === "clarification") {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Posso montar um resumo. Me diga o período, por exemplo: hoje, ontem, semana, mês ou 01/06 a 03/06.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de relatório sem período explícito.",
    };
  }
  if (reportPeriod) {
    return handlePeriodReportIntent(userId, reportPeriod);
  }

  return null;
}
