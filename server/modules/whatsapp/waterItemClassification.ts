import { normalizeText } from "../../mealTextParsing";
import type { MealDraftItem } from "../../nutritionEngineTypes";

const CORE_WATER_TOKENS = new Set([
  "agua",
  "aguas",
  "mineral",
  "com",
  "sem",
  "gas",
  "gaseificada",
  "gaseificado",
  "garrafa",
  "de",
  "natural",
  "pura",
  "puro",
  "potavel",
]);

const PURE_WATER_ANCHOR_TOKENS = new Set([
  "mineral",
  "gas",
  "gaseificada",
  "gaseificado",
  "garrafa",
  "natural",
  "pura",
  "puro",
  "potavel",
]);

const WATER_EXCLUSION_TOKENS = new Set([
  "coco",
  "tonica",
  "sabor",
  "saborizada",
  "saborizado",
  "aroma",
  "aromatizada",
  "aromatizado",
]);

function normalizeWaterTokens(value: string) {
  return normalizeText(value)
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function isWaterMeasurementToken(token: string) {
  return token === "ml" || token === "l" || /^\d+(?:ml|l)?$/.test(token);
}

export function isPureWaterItem(item: { foodName: string; canonicalName?: string; brand?: string | null }) {
  const brandTokens = new Set(item.brand ? normalizeWaterTokens(item.brand) : []);
  const candidateNames = [item.canonicalName, item.foodName].filter((name): name is string => Boolean(name));
  const candidates = candidateNames.map(normalizeWaterTokens);

  if (candidates.some(tokens => tokens.some(token => WATER_EXCLUSION_TOKENS.has(token)))) {
    return false;
  }

  return candidates.some(tokens => {
    if (!tokens.length || !tokens.includes("agua")) {
      return false;
    }

    const unknownTokens = tokens.filter(token => (
      !CORE_WATER_TOKENS.has(token)
      && !brandTokens.has(token)
      && !isWaterMeasurementToken(token)
    ));

    if (!unknownTokens.length) {
      return true;
    }

    // Marcas e qualificadores podem vir embutidos em foodName/canonicalName sem
    // preencher `brand`. Só relaxamos tokens desconhecidos quando a descrição
    // ainda traz um marcador inequívoco de água potável, evitando transformar
    // qualquer expressão que apenas contenha "água" em hidratação.
    return tokens.some(token => PURE_WATER_ANCHOR_TOKENS.has(token));
  });
}

function parseVolumeMlFromPortionText(portionText?: string) {
  if (!portionText) {
    return null;
  }
  const match = portionText.match(/(\d+(?:[.,]\d+)?)\s*(ml|l)\b/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return match[2].toLowerCase() === "l" ? value * 1000 : value;
}

export function resolveWaterVolumeMl(item: Pick<MealDraftItem, "quantity" | "unit" | "portionText">) {
  if (typeof item.quantity === "number" && item.quantity > 0 && item.unit) {
    const unit = item.unit.trim().toLowerCase();
    if (unit === "ml") {
      return item.quantity;
    }
    if (unit === "l") {
      return item.quantity * 1000;
    }
  }

  return parseVolumeMlFromPortionText(item.portionText);
}

export type WaterHydrationSplit = {
  waterVolumeMl: number;
  remainingItems: MealDraftItem[];
  hasWaterWithoutVolume: boolean;
};

export function splitMealItemsForWaterHydration(items: MealDraftItem[]): WaterHydrationSplit {
  let waterVolumeMl = 0;
  let hasWaterWithoutVolume = false;
  const remainingItems: MealDraftItem[] = [];

  for (const item of items) {
    if (!isPureWaterItem(item)) {
      remainingItems.push(item);
      continue;
    }

    const volumeMl = resolveWaterVolumeMl(item);
    if (volumeMl == null) {
      hasWaterWithoutVolume = true;
      continue;
    }

    waterVolumeMl += volumeMl;
  }

  return { waterVolumeMl, remainingItems, hasWaterWithoutVolume };
}
