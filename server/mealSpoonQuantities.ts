/** V1 textual spoon measures: transport a quantity decision from the canonical owner. */
import { roundNutritionValue } from "../shared/mealTotals";
import { isHouseholdSpoonUnit } from "../shared/measurementUnits";
import {
  findLocalNutritionReference,
  isCatalogFoodSemanticallyCompatible,
} from "./catalogMatching";
import { detectKnownBrand } from "./foodBrandDetection";
import { resolveCanonicalFoodQuantity } from "./foodItemResolution";
import { normalizeKnownFoodText } from "./foodTextNormalization";
import { buildItemFromMeasuredSpoonPortion } from "./mealItemBuilders";
import {
  buildPortionText,
  extractExplicitQuantityFoodSegments,
  normalizeForMatching,
  splitFoodTextSegments,
} from "./mealTextParsing";
import type { FoodQuantityResolution } from "./foodItemResolution";
import type { MealDraftItem } from "./nutritionEngineTypes";

type SpoonRequest = {
  foodName: string;
  quantity: number;
  unit: string;
};

export type SpoonDecision = SpoonRequest & {
  resolution: FoodQuantityResolution | null;
};

type SpoonRuntime = {
  resolveQuantity: typeof resolveCanonicalFoodQuantity;
};

const defaultRuntime: SpoonRuntime = { resolveQuantity: resolveCanonicalFoodQuantity };

/** No tenant context means no lookup of another user's portions or estimates. */
export async function readSpoonDecisions(
  sourceText: string,
  userId?: number,
  runtime: SpoonRuntime = defaultRuntime,
): Promise<SpoonDecision[]> {
  const requests = splitFoodTextSegments(sourceText)
    .flatMap(segment => extractExplicitQuantityFoodSegments(normalizeKnownFoodText(segment)))
    .filter(item => isHouseholdSpoonUnit(item.unit) && item.estimatedGrams === undefined);

  const scoped = Number.isSafeInteger(userId) && (userId ?? 0) > 0;
  const decisions: SpoonDecision[] = [];
  for (const request of requests) {
    // An unavailable provider/database cannot turn a missing conversion into 100 g.
    let resolution: FoodQuantityResolution | null = null;
    if (scoped) {
      try {
        resolution = await runtime.resolveQuantity({
          userId: userId!,
          foodName: request.foodName,
          brand: detectKnownBrand(request.foodName),
          quantity: request.quantity,
          unit: request.unit,
        });
      } catch {
        resolution = null;
      }
    }
    decisions.push({
      foodName: request.foodName,
      quantity: request.quantity,
      unit: request.unit,
      resolution: resolution && Number.isFinite(resolution.grams) && resolution.grams > 0
        ? resolution : null,
    });
  }
  return decisions;
}

/** Preserve the spoken measure; only nutrition and grams use the accepted conversion. */
export function applySpoonDecisions(items: MealDraftItem[], decisions: readonly SpoonDecision[]) {
  if (!decisions.length) return items;
  const updated = [...items];
  const used = new Set<number>();

  for (const decision of decisions) {
    if (!decision.resolution) return null;
    const identity = normalizeForMatching(decision.foodName).trim();
    const matches = updated.flatMap((item, index) =>
      !used.has(index) && (
        normalizeForMatching(item.foodName).trim() === identity ||
        normalizeForMatching(item.canonicalName).trim() === identity
      ) ? [index] : []
    );
    // A matched item must be unique; never assign a measured amount to a fuzzy sibling.
    if (matches.length !== 1) return null;
    const index = matches[0];
    const current = updated[index];
    if (current.resolution?.ambiguity) return null;
    used.add(index);

    const measure = decision.resolution;
    const provenance = {
      kind: measure.kind,
      grams: measure.grams,
      requestedQuantity: decision.quantity,
      requestedUnit: decision.unit,
      sourceUrls: [...measure.sourceUrls],
      evidence: measure.evidence,
      referenceCount: measure.referenceCount,
    };
    const catalog = !current.brand?.trim()
      ? findLocalNutritionReference(decision.foodName)
      : null;
    if (catalog && isCatalogFoodSemanticallyCompatible(catalog, decision.foodName)) {
      updated[index] = buildItemFromMeasuredSpoonPortion({
        food: catalog,
        foodName: decision.foodName,
        quantity: decision.quantity,
        unit: decision.unit,
        grams: measure.grams,
        measureResolution: provenance,
      }, measure.kind === "canonical_portion" || measure.kind === "researched_exact");
      continue;
    }

    // A verified *quantity* does not make unverified nutrition verified.
    const factor = current.estimatedGrams > 0 ? measure.grams / current.estimatedGrams : 0;
    if (!factor || !Number.isFinite(factor)) return null;
    updated[index] = {
      ...current,
      quantity: decision.quantity,
      unit: decision.unit,
      portionText: buildPortionText(decision.quantity, decision.unit),
      estimatedGrams: roundNutritionValue(measure.grams),
      servings: roundNutritionValue(current.servings * factor),
      calories: roundNutritionValue(current.calories * factor),
      protein: roundNutritionValue(current.protein * factor),
      carbs: roundNutritionValue(current.carbs * factor),
      fat: roundNutritionValue(current.fat * factor),
      resolution: {
        ...(current.resolution ?? {
          nutritionOrigin: "heuristic",
          nutritionVerified: false,
          ambiguity: null,
        }),
        measureResolution: {
          ...provenance,
          sourceEvidence: provenance.evidence,
          verified: measure.kind === "canonical_portion" || measure.kind === "researched_exact",
        },
      },
    };
  }
  return updated;
}
