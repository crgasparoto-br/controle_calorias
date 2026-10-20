/** Helpers de validação da pendência V2; sem efeitos ou estado. */
import { isValidIsoInstant } from "./schemaShared";
import type { PendingOperationEffect } from "./pendingOperation";

export function isNonEmpty(value: unknown, max = 200): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}

/** IDs sao opacos: rejeitar whitespace externo, jamais normalizar em silencio. */
export function isOpaqueIdentifier(value: unknown, max = 200): value is string {
  return isNonEmpty(value, max) && value === value.trim();
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
    isOpaqueIdentifier(effect.effectId) &&
    isValidIsoInstant(effect.appliedAt) &&
    isOpaqueIdentifier(effect.mealItemId)
  );
}

