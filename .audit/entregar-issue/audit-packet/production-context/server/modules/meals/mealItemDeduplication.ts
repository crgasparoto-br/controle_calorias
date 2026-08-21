import { roundNutritionValue } from "../../../shared/mealTotals";
import type { MealItemInput } from "./schemas";

type MealItemWithOptionalBrand = MealItemInput & {
  brand?: string | null;
};

const KNOWN_BRANDS = [
  "Budweiser",
  "Heineken",
  "Elma Chips",
  "Coca-Cola",
];

function normalizeIdentityPart(value: string | null | undefined) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim() || "";
}

function detectBrandFromText(value: string) {
  const normalized = normalizeIdentityPart(value);
  return KNOWN_BRANDS.find(brand => normalized.includes(normalizeIdentityPart(brand))) ?? null;
}

function removeBrandFromFoodName(foodName: string, brand: string | null) {
  if (!brand) {
    return foodName;
  }

  return foodName
    .replace(new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();
}

function getItemBrand(item: MealItemWithOptionalBrand) {
  return item.brand?.trim() || detectBrandFromText(item.foodName) || detectBrandFromText(item.canonicalName);
}

function getProductFoodName(item: MealItemWithOptionalBrand) {
  return removeBrandFromFoodName(item.foodName || item.canonicalName, getItemBrand(item));
}

function getPortionUnit(item: MealItemWithOptionalBrand) {
  const match = item.portionText.match(/\b(g|gramas?|ml|mililitros?|l|litros?)\b/i);
  if (!match) {
    return "g";
  }

  const normalized = normalizeIdentityPart(match[1]);
  if (normalized.startsWith("mililitro")) return "ml";
  if (normalized.startsWith("litro")) return "l";
  if (normalized.startsWith("gram")) return "g";
  return normalized;
}

function parsePortionQuantity(item: MealItemWithOptionalBrand) {
  const match = item.portionText.match(/(\d+(?:[,.]\d+)?)\s*(g|gramas?|ml|mililitros?|l|litros?)\b/i);
  if (!match) {
    return null;
  }

  return Number(match[1].replace(",", "."));
}

function buildProductIdentityKey(item: MealItemWithOptionalBrand) {
  return [
    normalizeIdentityPart(getProductFoodName(item)),
    normalizeIdentityPart(getItemBrand(item)),
    getPortionUnit(item),
  ].join("::");
}

function mergeMealItems(base: MealItemWithOptionalBrand, next: MealItemWithOptionalBrand): MealItemInput {
  const unit = getPortionUnit(base);
  const baseQuantity = parsePortionQuantity(base);
  const nextQuantity = parsePortionQuantity(next);
  const nextEstimatedGrams = roundNutritionValue(Number(base.estimatedGrams || 0) + Number(next.estimatedGrams || 0));
  const mergedQuantity = baseQuantity !== null && nextQuantity !== null
    ? roundNutritionValue(baseQuantity + nextQuantity)
    : nextEstimatedGrams;

  return {
    ...base,
    portionText: `${mergedQuantity} ${unit}`,
    servings: Math.max(roundNutritionValue(Number(base.servings || 0) + Number(next.servings || 0)), 0.1),
    estimatedGrams: nextEstimatedGrams,
    calories: roundNutritionValue(Number(base.calories || 0) + Number(next.calories || 0)),
    protein: roundNutritionValue(Number(base.protein || 0) + Number(next.protein || 0)),
    carbs: roundNutritionValue(Number(base.carbs || 0) + Number(next.carbs || 0)),
    fat: roundNutritionValue(Number(base.fat || 0) + Number(next.fat || 0)),
    confidence: Math.min(Number(base.confidence || 0.8), Number(next.confidence || 0.8)),
    source: base.source === next.source ? base.source : "hybrid",
  };
}

export function dedupeMealItemsByProductIdentity(items: MealItemInput[]): MealItemInput[] {
  const mergedItems: MealItemInput[] = [];
  const indexByIdentity = new Map<string, number>();

  for (const item of items as MealItemWithOptionalBrand[]) {
    const identity = buildProductIdentityKey(item);
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, mergedItems.length);
      mergedItems.push({ ...item });
      continue;
    }

    mergedItems[existingIndex] = mergeMealItems(mergedItems[existingIndex] as MealItemWithOptionalBrand, item);
  }

  return mergedItems;
}
