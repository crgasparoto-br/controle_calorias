import { normalizeMeasurementUnit } from "../../../../shared/measurementUnits";
import { parseMealCommandFromWhatsApp, type ParsedMealCommandItem } from "../mealCommandParser";
import { cleanTargetFoodText, normalizeIntentText } from "./textUtils";
import type { CoffeeAdditionIntent, CoffeeLorCapsuleIntent, FoodAdditionIntent, FoodReplacementIntent, GramsAdjustmentItem, GramsIncrementItem, QuantityCorrectionIntent } from "./types";

const MAX_WATER_LOG_AMOUNT_ML = 10000;

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

export function parseWaterIntent(text: string) {
  if (!looksLikeWaterIntent(text)) {
    return null;
  }

  const amountMl = parseWaterAmountMl(text);
  if (!amountMl || amountMl <= 0 || amountMl > MAX_WATER_LOG_AMOUNT_ML) {
    return { kind: "clarification" as const };
  }

  return { kind: "water" as const, amountMl };
}

export function parseMealItemGramsReplacement(text: string) {
  const normalized = normalizeIntentText(text);
  const match = normalized.match(/\b(?:mudar|alterar|ajustar|trocar|corrigir)\b\s+(.+?)\s+(?:para|por)\s+(\d+(?:[,.]\d+)?)\s*(?:g|gramas?)\b/);
  if (!match) {
    return null;
  }

  const nextGrams = Number(match[2].replace(",", "."));
  if (!Number.isFinite(nextGrams) || nextGrams < 1) {
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

export function parseMealItemGramsAdjustmentMulti(text: string): GramsAdjustmentItem[] | null {
  const normalized = normalizeIntentText(text);

  // Must have a decrease verb somewhere in the message
  if (!/\b(?:diminuir|diminui|diminuia|reduzir|reduz|reduza|tirar|remover)\b/.test(normalized)) {
    return null;
  }

  // Each pair: <number> <unit> [do/da/de <food>]
  // The food name stops before the next numeric pair, 'e <number>', or a comma/semicolon followed by a number.
  const pairPattern = /(\d+(?:[,.]\d+)?)\s*(?:g|gramas?|ml|mililitros?)\b(?:\s+(?:do|da|de)\s+((?:(?!\d|\be\b\s*\d|[,;]\s*\d)\S+\s*)+))?/gi;
  const results: GramsAdjustmentItem[] = [];
  let pairMatch: RegExpExecArray | null;

  while ((pairMatch = pairPattern.exec(normalized)) !== null) {
    const gramsDelta = Number(pairMatch[1].replace(",", "."));
    if (!Number.isFinite(gramsDelta) || gramsDelta <= 0) {
      continue;
    }

    const targetFoodRaw = pairMatch[2]?.trim() ?? null;

    results.push({
      gramsDelta,
      targetFood: cleanTargetFoodText(targetFoodRaw ?? undefined),
    });
  }

  return results.length > 0 ? results : null;
}

export function parseMealItemGramsIncrementMulti(text: string): GramsIncrementItem[] | null {
  const normalized = normalizeIntentText(text);

  // Must have an increment verb somewhere in the message
  if (!/\b(?:somar|soma|some|adicionar|adiciona|adicione|acrescentar|acrescenta|acrescente|colocar\s+mais|coloca\s+mais|coloque\s+mais|aumentar|aumenta|aumente)\b/.test(normalized)) {
    return null;
  }

  // Must look like a grams-adjustment (not food-addition intent which has mealType)
  // Reject if it looks like a full food-addition command (has meal-type words)
  const mealTypePattern = /\b(?:cafe da manha|cafe da manha|almoco|jantar|lanche da tarde|lanche|ceia)\b/;
  if (mealTypePattern.test(normalized)) {
    return null;
  }

  // Each pair: <number> <unit> [ao/no/na/do/da/de <food>]
  // The food name stops before the next numeric pair, 'e <number>', or a comma/semicolon followed by a number.
  const pairPattern = /(\d+(?:[,.]\d+)?)\s*(?:g|gramas?|ml|mililitros?)\b(?:\s+(?:ao|no|na|do|da|de)\s+((?:(?!\d|\be\b\s*\d|[,;]\s*\d)\S+\s*)+))?/gi;
  const results: GramsIncrementItem[] = [];
  let pairMatch: RegExpExecArray | null;

  while ((pairMatch = pairPattern.exec(normalized)) !== null) {
    const gramsDelta = Number(pairMatch[1].replace(",", "."));
    if (!Number.isFinite(gramsDelta) || gramsDelta <= 0) {
      continue;
    }

    const targetFoodRaw = pairMatch[2]?.trim() ?? null;
    results.push({
      gramsDelta,
      targetFood: cleanTargetFoodText(targetFoodRaw ?? undefined),
    });
  }

  return results.length > 0 ? results : null;
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

export function parseFoodReplacementIntents(text: string): FoodReplacementIntent[] | null {
  const segments = text.split(/\s*[,;]\s*(?=n[aã]o\b)|\s+e\s+(?=n[aã]o\b)/i);
  const results: FoodReplacementIntent[] = [];
  for (const segment of segments) {
    const intent = parseFoodReplacementIntent(segment.trim());
    if (intent) {
      results.push(intent);
    }
  }
  return results.length > 0 ? results : null;
}

export function parseCoffeeAdditionIntent(text: string): CoffeeAdditionIntent | null {
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

export function parseCoffeeLorCapsuleIntent(text: string): CoffeeLorCapsuleIntent | null {
  const normalized = normalizeIntentText(text);
  const match = normalized.match(
    /(?:(?:adicionar?|adiciona|inclui|incluir|registrar?|registra)\s+)?(\d+(?:[,.]\d+)?)\s*(?:capsulas?\s+de\s+)?cafe\s+(?:em\s+capsula\s+)?l['’]?or\b/,
  );
  if (!match) {
    return null;
  }
  const quantity = Number(match[1].replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  const restText = normalized.slice((match.index ?? 0) + match[0].length).trim();
  const mealFromRest = restText.match(/^(?:ao?|na?s?|para|a)\s+(?:refeicao\s+)?(.+?)(?:\s+de\s+(?:hoje|ontem|amanha))?$/);
  const mealLabel = mealFromRest?.[1]?.trim() || null;
  return { quantity, mealLabel };
}

function formatFoodNameWithBrand(item: ParsedMealCommandItem) {
  return [item.foodName, item.brand].filter(Boolean).join(" ").trim();
}

function normalizeAdditionUnit(unit: string | null) {
  return unit ? normalizeMeasurementUnit(unit) : "g";
}

export function parseFoodAdditionIntent(text: string, receivedAt: Date): FoodAdditionIntent | null {
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

export function parseQuantityCorrectionIntent(text: string, receivedAt: Date): QuantityCorrectionIntent | null {
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

export function parseSnackSuggestionIntent(text: string) {
  const normalized = normalizeIntentText(text);
  if (!/\b(sugestao|sugira|sugerir|dica|ideia|indica|indique)\b/.test(normalized)) {
    return false;
  }

  return /\blanche\b/.test(normalized) || /\blanche da tarde\b/.test(normalized);
}
