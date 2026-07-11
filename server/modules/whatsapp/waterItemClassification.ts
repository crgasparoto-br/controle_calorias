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

const WATER_EXCLUSION_TOKENS = new Set([
  "coco",
  "tonica",
  "saborizada",
  "saborizado",
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

export function isPureWaterItem(item: { foodName: string; canonicalName?: string; brand?: string | null }) {
  const brandTokens = new Set(item.brand ? normalizeWaterTokens(item.brand) : []);
  const candidateNames = [item.canonicalName, item.foodName].filter((name): name is string => Boolean(name));

  return candidateNames.some(name => {
    const tokens = normalizeWaterTokens(name);
    if (!tokens.length || !tokens.includes("agua")) {
      return false;
    }
    if (tokens.some(token => WATER_EXCLUSION_TOKENS.has(token))) {
      return false;
    }
    return tokens.every(token => CORE_WATER_TOKENS.has(token) || brandTokens.has(token));
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
