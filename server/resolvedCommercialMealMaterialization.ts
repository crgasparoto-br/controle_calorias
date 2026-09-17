import { calculateMealTotals } from "../shared/mealTotals";
import { resolveMealLabel } from "./mealLabelResolver";
import {
  buildItemFromResolvedCommercialFood,
  clampConfidence,
} from "./mealItemBuilders";
import { buildMealSemanticContract } from "./mealSemanticContract";
import type {
  MealProcessingInput,
  MealProcessingResult,
} from "./nutritionEngineTypes";
import type { CountableFoodResolvedMeasure } from "./countableFoodQuantity";

/**
 * Domain boundary for a countable commercial segment already resolved by the
 * nutrition engine. The channel only supplies the structured decision; it does
 * not re-infer identity, portion or nutrition from registrationText.
 */
export function materializeResolvedCommercialMeal(input: {
  resolved: CountableFoodResolvedMeasure;
  occurredAt?: Date;
  userTimezone: string;
}): MealProcessingResult {
  const food = input.resolved.commercialFood;
  const request = input.resolved.request;
  const measure = input.resolved.resolution;
  const grams = measure.grams;

  if (
    !food
    || !request.brand
    || !Number.isFinite(grams)
    || grams <= 0
    || !Number.isFinite(food.gramsPerServing)
    || food.gramsPerServing <= 0
  ) {
    throw new Error("Resolved commercial countable measure is incomplete.");
  }

  const item = buildItemFromResolvedCommercialFood({
    food,
    foodName: request.foodName,
    brand: request.brand,
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
