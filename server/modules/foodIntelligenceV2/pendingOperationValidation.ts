/** Helpers de validação da pendência V2; sem efeitos ou estado. */
import { isValidIsoInstant } from "./schemaShared";
import type { PendingOperationEffect } from "./pendingOperation";

export function isNonEmpty(value: unknown, max = 200): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isValidPendingOperationEffect(
  value: unknown
): value is PendingOperationEffect {
  if (!value || typeof value !== "object") return false;
  const effect = value as Partial<PendingOperationEffect>;
  return (
    isNonEmpty(effect.effectId) &&
    isValidIsoInstant(effect.appliedAt) &&
    isNonEmpty(effect.mealItemId)
  );
}

