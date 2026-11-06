import type { WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { getPendingOperationDispatchStatus } from "../../repositories/whatsappPendingOperationTypes";

export function buildPendingOperationRecoveryResult(
  pending: WhatsAppPendingOperationRecord
) {
  const reviewRequired =
    getPendingOperationDispatchStatus(pending.state) === "review_required";
  const interactionId =
    pending.target &&
    typeof pending.target === "object" &&
    "interactionId" in pending.target
      ? (pending.target as { interactionId?: unknown }).interactionId
      : null;
  return {
    handled: true as const,
    action: "clarification_needed",
    reply: reviewRequired
      ? "O resultado da seleção anterior pode ter sido aplicado. Confira a refeição antes de repetir; não farei uma nova tentativa automática."
      : "Essa seleção ainda está sendo processada. Aguarde; se não houver confirmação, confira a refeição antes de repetir.",
    eventType: reviewRequired
      ? "whatsapp.interaction.pending_review_required"
      : "whatsapp.interaction.claim_unavailable",
    detail: reviewRequired
      ? "Uma lease abandonada foi encerrada para revisão; replay e fallback permanecem bloqueados."
      : "A resposta compatível perdeu o claim versionado; replay e fallback foram bloqueados para evitar execução duplicada.",
    data: {
      pendingOperationId: pending.id,
      pendingType: pending.type,
      ...(typeof interactionId === "string" ? { interactionId } : {}),
      fallbackBlocked: true,
      fallbackBlockReason: reviewRequired
        ? "pending_operation_review_required"
        : "pending_interaction_claim_unavailable",
      interactionLifecycle: "blocked",
      noReplay: true,
    },
  };
}

export function buildStaleInteractionReply(
  latest: WhatsAppPendingOperationRecord | null,
  isCompatibleSelectionReply: boolean
) {
  if (
    !latest ||
    !isCompatibleSelectionReply ||
    getPendingOperationDispatchStatus(latest.state) === "ready" ||
    latest.type !== "meal_item_selection"
  )
    return null;
  return {
    handled: true as const,
    action: "clarification_needed",
    reply:
      "Essa seleção não está mais disponível. Confira o estado da refeição e, se necessário, envie um novo comando completo.",
    eventType: "whatsapp.intent.meal_item_selection_unavailable",
    detail:
      "Resposta curta para seleção consumida, expirada ou em revisão bloqueada antes do fallback genérico.",
    data: {
      pendingOperationId: latest.id,
      fallbackBlocked: true,
      fallbackBlockReason: "stale_meal_item_selection",
      interactionLifecycle: "blocked",
    },
  };
}
