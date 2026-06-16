import { z } from "zod";

export const NUTRITION_SOURCE_SELECTION_VERSION = "nutrition-source-selection-v1";

export const nutritionSourceSchema = z.object({
  type: z.enum([
    "branded_product_exact",
    "curated_catalog",
    "official_database",
    "generic_catalog_approximation",
    "documented_estimate",
    "ai_inferred",
    "pending_review",
  ]),
  origin: z.string().trim().min(1).max(120),
  sourceName: z.string().trim().min(1).max(160).optional(),
  sourceVersion: z.string().trim().min(1).max(80).optional(),
  foodCode: z.string().trim().min(1).max(80).optional(),
  confidence: z.number().min(0).max(1),
  isEstimated: z.boolean(),
  matchedBy: z.string().trim().min(1).max(120),
  selectedAt: z.string().datetime(),
  selectionVersion: z.literal(NUTRITION_SOURCE_SELECTION_VERSION),
  notes: z.string().trim().min(1).max(300).optional(),
});

export type NutritionSourceSelection = z.infer<typeof nutritionSourceSchema>;

type CatalogFoodSource = {
  id?: number;
  slug?: string | null;
  name?: string | null;
  version?: string | null;
  foodCode?: string | null;
};

type CatalogFoodLike = {
  id?: number;
  scope?: string;
  name?: string;
  brandName?: string | null;
  source?: CatalogFoodSource | null;
};

type MealItemSourceLike = {
  source?: "catalog" | "hybrid" | "heuristic";
  confidence?: number;
  brand?: string | null;
  foodId?: number;
  nutritionSource?: NutritionSourceSelection;
};

function clampConfidence(value: number | null | undefined, fallback: number) {
  if (!Number.isFinite(value ?? NaN)) return fallback;
  return Math.min(Math.max(Number(value), 0), 1);
}

function nowIso() {
  return new Date().toISOString();
}

export function buildCatalogNutritionSource(params: {
  food: CatalogFoodLike;
  confidence?: number;
  matchedBy?: string;
  notes?: string;
}): NutritionSourceSelection {
  const { food } = params;
  const source = food.source ?? null;
  const isBranded = Boolean(food.brandName?.trim());
  const sourceSlug = source?.slug ?? "catalog";
  const type: NutritionSourceSelection["type"] = isBranded
    ? "branded_product_exact"
    : sourceSlug.includes("taco") || sourceSlug.includes("tbca")
      ? "official_database"
      : "curated_catalog";

  return {
    type,
    origin: sourceSlug,
    sourceName: source?.name ?? (food.scope ? `${food.scope} catalog` : "Catalogo nutricional"),
    sourceVersion: source?.version ?? undefined,
    foodCode: source?.foodCode ?? (food.id ? String(food.id) : undefined),
    confidence: clampConfidence(params.confidence, isBranded ? 0.9 : 0.82),
    isEstimated: false,
    matchedBy: params.matchedBy ?? (isBranded ? "brand_product_catalog_match" : "catalog_food_match"),
    selectedAt: nowIso(),
    selectionVersion: NUTRITION_SOURCE_SELECTION_VERSION,
    notes: params.notes,
  };
}

export function buildEstimatedNutritionSource(params: {
  confidence?: number;
  matchedBy?: string;
  notes?: string;
  origin?: string;
} = {}): NutritionSourceSelection {
  return {
    type: "documented_estimate",
    origin: params.origin ?? "documented_estimate_rule",
    sourceName: "Regra interna de estimativa nutricional",
    sourceVersion: NUTRITION_SOURCE_SELECTION_VERSION,
    confidence: clampConfidence(params.confidence, 0.55),
    isEstimated: true,
    matchedBy: params.matchedBy ?? "no_reliable_catalog_source",
    selectedAt: nowIso(),
    selectionVersion: NUTRITION_SOURCE_SELECTION_VERSION,
    notes: params.notes ?? "Valores calculados por estimativa revisavel quando uma fonte nutricional especifica nao esta disponivel.",
  };
}

export function buildAiInferredNutritionSource(params: {
  confidence?: number;
  notes?: string;
} = {}): NutritionSourceSelection {
  return {
    type: "ai_inferred",
    origin: "ai_meal_extraction",
    sourceName: "Inferencia de IA revisavel",
    sourceVersion: NUTRITION_SOURCE_SELECTION_VERSION,
    confidence: clampConfidence(params.confidence, 0.5),
    isEstimated: true,
    matchedBy: "llm_nutrition_inference",
    selectedAt: nowIso(),
    selectionVersion: NUTRITION_SOURCE_SELECTION_VERSION,
    notes: params.notes ?? "Valores inferidos pela IA e sujeitos a confirmacao ou revisao.",
  };
}

export function deriveNutritionSourceForMealItem(
  item: MealItemSourceLike,
  catalogFood?: CatalogFoodLike | null,
): NutritionSourceSelection {
  if (item.nutritionSource) {
    return item.nutritionSource;
  }

  if (catalogFood) {
    return buildCatalogNutritionSource({
      food: catalogFood,
      confidence: item.confidence,
      matchedBy: item.brand ? "brand_or_catalog_food_id" : "catalog_food_id",
    });
  }

  if (item.source === "hybrid") {
    return buildAiInferredNutritionSource({ confidence: item.confidence });
  }

  return buildEstimatedNutritionSource({
    confidence: item.confidence,
    matchedBy: item.source === "catalog" ? "catalog_without_snapshot" : "heuristic_fallback",
  });
}
