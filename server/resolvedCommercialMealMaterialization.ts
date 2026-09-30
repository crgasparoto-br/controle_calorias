import { calculateMealTotals } from "../shared/mealTotals";
import { resolveMealLabel } from "./mealLabelResolver";
import {
  buildItemFromResolvedCatalogFood,
  clampConfidence,
} from "./mealItemBuilders";
import { buildMealSemanticContract } from "./mealSemanticContract";
import type {
  CatalogFood,
  MealProcessingInput,
  MealProcessingResult,
} from "./nutritionEngineTypes";
import type { CountableFoodResolvedMeasure } from "./countableFoodQuantity";

/**
 * Domain boundary for a countable segment already resolved by the nutrition
 * engine. The channel only supplies the structured decision; it does not
 * re-infer identity, portion or nutrition from registrationText.
 */
export function materializeResolvedCountableMeal(input: {
  resolved: CountableFoodResolvedMeasure;
  food: CatalogFood;
  occurredAt?: Date;
  userTimezone: string;
}): MealProcessingResult {
  const food = input.food;
  const request = input.resolved.request;
  const measure = input.resolved.resolution;
  const grams = measure.grams;

  if (
    !Number.isFinite(grams)
    || grams <= 0
    || !Number.isFinite(food.gramsPerServing)
    || food.gramsPerServing <= 0
  ) {
    throw new Error("Resolved countable measure is incomplete.");
  }

  const item = buildItemFromResolvedCatalogFood({
    food,
    foodName: request.foodName,
    brand: request.brand ?? food.brandName ?? null,
    quantity: request.count,
    unit: request.requestedUnit,
    grams,
    measureResolution: {
      kind: measure.kind,
      requestedQuantity: "requestedQuantity" in measure
        ? measure.requestedQuantity
        : request.count,
      requestedUnit: "requestedUnit" in measure
        ? measure.requestedUnit
        : request.requestedUnit,
      sourceUrls: "sourceUrls" in measure ? measure.sourceUrls : [],
      evidence: "evidence" in measure ? measure.evidence : null,
      referenceCount: "referenceCount" in measure ? measure.referenceCount : 1,
    },
  });
  const processingInput: MealProcessingInput = {
    text: request.segment,
    occurredAt: input.occurredAt,
    timeZone: input.userTimezone,
  };
  const confidence = clampConfidence(item.confidence);
  const semanticContract = buildMealSemanticContract({
    processingInput,
    sourceText: request.segment,
    items: [item],
  });

  return {
    detectedMealLabel: resolveMealLabel(processingInput, request.segment),
    sourceText: request.segment,
    confidence,
    needsConfirmation: false,
    reasoning:
      "Identidade comercial, porção e nutrição reutilizadas da resolução canônica já comprovada.",
    items: [item],
    totals: calculateMealTotals([item]),
    semanticContract,
  };
}

export function materializeResolvedCommercialMeal(input: {
  resolved: CountableFoodResolvedMeasure;
  occurredAt?: Date;
  userTimezone: string;
}): MealProcessingResult {
  const food = input.resolved.commercialFood;
  if (!food || !input.resolved.request.brand) {
    throw new Error("Resolved commercial countable measure is incomplete.");
  }

  return materializeResolvedCountableMeal({ ...input, food });
}
