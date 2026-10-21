/** Helpers de validação da pendência V2; sem efeitos ou estado. */
import { isValidIsoInstant } from "./schemaShared";
import type { PendingOperation, PendingOperationEffect } from "./pendingOperation";

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


// Uma gravação concorrente/obsoleta não pode mudar a identidade da operação,
// trocar de resolvedor ou apagar/substituir um efeito previamente confirmado.
export function assertMonotonicPendingSave(
  previous: PendingOperation,
  next: PendingOperation
): void {
  const before = previous.versionTag;
  const after = next.versionTag;
  const sameVersions = before === null
    ? after === null
    : after !== null && after !== undefined &&
      before.contractVersion === after.contractVersion &&
      before.resolverVersion === after.resolverVersion &&
      before.policyVersion === after.policyVersion &&
      before.lexiconRevision === after.lexiconRevision &&
      before.knowledgeRevision === after.knowledgeRevision;
  const sameObservations = Array.isArray(next.observationIds) &&
    previous.observationIds.length === next.observationIds.length &&
    previous.observationIds.every((id, index) => id === next.observationIds[index]);
  const sameTarget = next.target !== null && next.target !== undefined &&
    previous.target.mealLabel === next.target.mealLabel &&
    previous.target.date === next.target.date;
  const sameQuestion = previous.question === null
    ? next.question === null
    : next.question !== null && next.question !== undefined &&
      previous.question.code === next.question.code &&
      previous.question.ref === next.question.ref;

  if (previous.operationKey !== next.operationKey ||
      previous.ownerUserId !== next.ownerUserId ||
      previous.createdAt !== next.createdAt ||
      previous.expiresAt !== next.expiresAt ||
      !sameVersions || !sameObservations || !sameTarget || !sameQuestion) {
    throw new Error("Pendência existente não permite trocar proprietário, fatos, alvo ou versões fixadas.");
  }

  if (previous.effect !== null &&
      (next.effect === null || next.effect === undefined ||
        previous.effect.effectId !== next.effect.effectId ||
        previous.effect.appliedAt !== next.effect.appliedAt ||
        previous.effect.mealItemId !== next.effect.mealItemId)) {
    throw new Error("Efeito já aplicado é imutável: gravação obsoleta ou conflitante recusada.");
  }
}
