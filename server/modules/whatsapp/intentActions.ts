import { listMeals, updateMeal } from "../meals/service";
import { createWaterLog } from "../water/service";
import type { MealItemInput } from "../meals/schemas";

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";
const MAX_WATER_LOG_AMOUNT_ML = 10000;
const MIN_FOOD_GRAMS = 1;

type WhatsappIntentResult = {
  handled: true;
  action: "water_logged" | "meal_item_grams_adjusted" | "clarification_needed";
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

  return null;
}
