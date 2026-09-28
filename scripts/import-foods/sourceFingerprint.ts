import { createHash } from "node:crypto";

import { normalizeSourceCode } from "./normalize_food_name.ts";
import type { ImportFood, ImportPayload } from "./types.ts";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return String(value);
}

function canonicalFood(food: ImportFood) {
  return {
    sourceFoodCode: normalizeSourceCode(food.sourceFoodCode),
    name: food.name.trim(),
    brandName: food.brandName?.trim() ?? null,
    category: food.category?.trim() ?? null,
    description: food.description?.trim() ?? null,
    caloriesKcalPer100g: food.caloriesKcalPer100g,
    proteinGramsPer100g: food.proteinGramsPer100g,
    carbsGramsPer100g: food.carbsGramsPer100g,
    fatGramsPer100g: food.fatGramsPer100g,
    fiberGramsPer100g: food.fiberGramsPer100g ?? null,
    sugarGramsPer100g: food.sugarGramsPer100g ?? null,
    sodiumMgPer100g: food.sodiumMgPer100g ?? null,
    nutrients: food.nutrients ?? null,
    aliases: [...(food.aliases ?? [])].map(alias => alias.trim()).sort(),
    portions: [...(food.portions ?? [])]
      .map(portion => ({
        label: portion.label.trim(),
        unit: portion.unit?.trim() ?? "serving",
        quantity: portion.quantity ?? 1,
        grams: portion.grams,
        isDefault: portion.isDefault ?? false,
        sourcePortionCode: portion.sourcePortionCode?.trim() ?? null,
      }))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      ),
  };
}

export function createSourceContentHash(payload: ImportPayload) {
  const material = canonicalize({
    source: {
      slug: payload.source.slug.trim().toLowerCase(),
      name: payload.source.name.trim(),
      version: payload.source.version.trim(),
      countryCode: payload.source.countryCode?.trim() ?? null,
      sourceUrl: payload.source.sourceUrl?.trim() ?? null,
      sourceReference: payload.source.sourceReference?.trim() ?? null,
    },
    foods: [...payload.foods]
      .map(canonicalFood)
      .sort((left, right) =>
        left.sourceFoodCode.localeCompare(right.sourceFoodCode)
      ),
  });

  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}
