import type { CatalogFood } from "./nutritionEngine";
import {
  selectNutritionSource,
  type NutritionSourceCandidate,
  type NutritionSourceQuery,
  type NutritionSourceSelection,
} from "./nutritionSourceSelection";

export type NutritionSourceMetadata = NutritionSourceSelection & {
  selectedAt: string;
};

function normalizeText(value: string | null | undefined) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[\s_-]+/g, " ")
    .trim() ?? "";
}

function inferBrandName(food: CatalogFood, query: NutritionSourceQuery) {
  const queryBrand = query.brandName?.trim();
  if (queryBrand) return queryBrand;

  const text = normalizeText(`${food.name} ${food.aliases.join(" ")}`);
  const brandTerms = ["coca cola", "molico", "nestle", "panco", "polenghi", "wickbold"];
  return brandTerms.find(brand => text.includes(brand)) ?? null;
}

function inferSourceType(food: CatalogFood): NutritionSourceCandidate["sourceType"] {
  const text = normalizeText(`${food.slug} ${food.name} ${food.aliases.join(" ")}`);
  const hasKnownBrand = ["coca cola", "molico", "nestle", "panco", "polenghi", "wickbold"].some(brand => text.includes(brand));
  if (hasKnownBrand) return "curated_catalog";
  if (food.slug.includes("estimate")) return "generic_estimate";
  return "internal_catalog";
}

export function buildCatalogNutritionSourceCandidate(
  food: CatalogFood,
  query: NutritionSourceQuery,
): NutritionSourceCandidate {
  return {
    id: food.slug,
    name: food.name,
    brandName: inferBrandName(food, query),
    sourceType: inferSourceType(food),
    sourceName: "Catálogo interno",
    sourceVersion: "static-reference",
    confidence: food.slug.includes("estimate") ? 0.55 : 0.86,
    servingUnit: food.servingLabel.split(/\s+/).at(-1) ?? null,
    aliases: food.aliases,
  };
}

export function buildEstimatedNutritionSourceCandidate(
  foodName: string,
  sourceType: "generic_estimate" | "llm_estimate" = "generic_estimate",
): NutritionSourceCandidate {
  return {
    id: `${sourceType}:${normalizeText(foodName).replace(/\s+/g, "-") || "unknown"}`,
    name: foodName || "Alimento estimado",
    sourceType,
    sourceName: sourceType === "llm_estimate" ? "Estimativa da IA" : "Estimativa por regra interna",
    confidence: sourceType === "llm_estimate" ? 0.45 : 0.55,
  };
}

export function selectCatalogNutritionSource(params: {
  query: NutritionSourceQuery;
  food: CatalogFood;
  selectedAt?: Date;
}): NutritionSourceMetadata {
  const selection = selectNutritionSource(params.query, [
    buildCatalogNutritionSourceCandidate(params.food, params.query),
  ]);

  return {
    ...selection,
    selectedAt: (params.selectedAt ?? new Date()).toISOString(),
  };
}

export function selectEstimatedNutritionSource(params: {
  query: NutritionSourceQuery;
  foodName: string;
  sourceType?: "generic_estimate" | "llm_estimate";
  selectedAt?: Date;
}): NutritionSourceMetadata {
  const selection = selectNutritionSource(params.query, [
    buildEstimatedNutritionSourceCandidate(params.foodName, params.sourceType),
  ]);

  return {
    ...selection,
    selectedAt: (params.selectedAt ?? new Date()).toISOString(),
  };
}
