import { logInferenceEvent } from "./db";

export type MealInferenceFallbackReason =
  | "ai_unavailable_or_error"
  | "ai_empty_items"
  | "ai_items_rejected"
  | "catalog_miss"
  | "generic_nutrition_fallback";

const FALLBACK_STAGE: Record<MealInferenceFallbackReason, "ai_extraction" | "catalog_resolution" | "nutrition_estimation"> = {
  ai_unavailable_or_error: "ai_extraction",
  ai_empty_items: "ai_extraction",
  ai_items_rejected: "ai_extraction",
  catalog_miss: "catalog_resolution",
  generic_nutrition_fallback: "nutrition_estimation",
};

export function logMealInferenceFallback(reason: MealInferenceFallbackReason, count: number) {
  try {
    logInferenceEvent({
      origin: "admin",
      status: "warning",
      eventType: "meal.inference_fallback",
      detail: JSON.stringify({
        schemaVersion: 1,
        reason,
        stage: FALLBACK_STAGE[reason],
        count: Math.max(1, Math.trunc(count)),
      }),
    });
  } catch {
    // Observability is best-effort and must never alter nutrition processing.
  }
}
